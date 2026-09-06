import { eq } from 'drizzle-orm';
import type { Config } from '../config';
import type { SourceName } from '../db/types';
import type {
  AssessmentInput,
  ReputationSource,
  SourceVerdict
} from '../reputation/types';
import * as repo from '../db/repo';
import { appendAudit } from '../audit/log';
import { publish } from '../events';
import { evaluateDomain } from '../pipeline/evaluate';
import { now } from '../time';
import {
  afterCall,
  canCall,
  initialRow,
  refill,
  rolloverCounters,
  type RateRow
} from './rate-state';

export function makeDrainer(deps: {
  db: any;
  schema: any;
  cfg: Config;
  pacedSources: ReputationSource[];
  eligibleSourceNames: SourceName[];
  enrich: (domain: string) => Promise<AssessmentInput['enrichment']>;
  curatedHits: (domain: string) => string[];
}) {
  const { db, schema } = deps;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  // Infinity is not storable; persist a large sentinel (treated as "has token").
  const sanitize = (r: RateRow) => ({
    ...r,
    tokens: Number.isFinite(r.tokens) ? r.tokens : 1_000_000
  });

  async function loadRow(source: string, nowMs: number): Promise<RateRow> {
    const [row] = await db
      .select()
      .from(schema.sourceRateState)
      .where(eq(schema.sourceRateState.source, source));
    if (row) return row as RateRow;
    const fresh = initialRow(source, nowMs);
    await db
      .insert(schema.sourceRateState)
      .values(sanitize(fresh))
      .onConflictDoNothing();
    return fresh;
  }

  async function saveRow(r: RateRow): Promise<void> {
    await db
      .update(schema.sourceRateState)
      .set(sanitize(r))
      .where(eq(schema.sourceRateState.source, r.source));
  }

  async function tick(nowMs = now()): Promise<{ calls: number }> {
    let calls = 0;
    for (const source of deps.pacedSources) {
      let state = await loadRow(source.name, nowMs);
      state = rolloverCounters(refill(state, source.limits, nowMs), nowMs);

      const gate = canCall(state, source.limits, nowMs);
      if (!gate.ok) {
        await saveRow(state);
        continue;
      }

      const [domain] = await repo.listQueuedDomains(db, schema, source.name, 1);
      if (!domain) {
        await saveRow(state);
        continue;
      }

      publish({
        type: 'assess.start',
        source: source.name,
        domain: domain.domain
      });

      const input: AssessmentInput = {
        domain: domain.domain,
        hitCount: domain.hitCount,
        distinctClientCount: 0,
        curatedListHits: deps.curatedHits(domain.domain),
        enrichment: await deps.enrich(domain.domain)
      };

      let v: SourceVerdict | null = null;
      try {
        v = await source.assess(input);
      } catch (e) {
        const msg = (e as Error).message;
        await repo.upsertVerdict(db, schema, {
          domainId: domain.id,
          source: source.name,
          verdict: 'error',
          confidence: 0,
          category: null,
          detail: msg,
          raw: { error: msg },
          assessedAt: now()
        });
        publish({
          type: 'verdict',
          domain: domain.domain,
          source: source.name,
          verdict: 'error',
          confidence: 0,
          category: null
        });
        await appendAudit(db, schema, {
          actor: source.name,
          event: 'assess.error',
          domainId: domain.id,
          data: { msg }
        });
      }

      if (v) {
        await repo.upsertVerdict(db, schema, {
          domainId: domain.id,
          source: source.name,
          verdict: v.verdict,
          confidence: v.confidence,
          category: v.category,
          detail: v.detail,
          raw: v.raw,
          assessedAt: now(),
          inputTokens: v.usage?.inputTokens ?? null,
          outputTokens: v.usage?.outputTokens ?? null,
          costUsd: v.usage?.costUsd ?? null
        });
        publish({
          type: 'verdict',
          domain: domain.domain,
          source: source.name,
          verdict: v.verdict,
          confidence: v.confidence,
          category: v.category
        });
      }

      state = afterCall(state, source.limits, nowMs);
      publish({
        type: 'assess.done',
        source: source.name,
        domain: domain.domain
      });
      await saveRow(state);
      await evaluateDomain(
        db,
        schema,
        domain.id,
        deps.eligibleSourceNames,
        deps.cfg
      );
      calls++;
    }
    return { calls };
  }

  return {
    tick,
    start() {
      if (!timer)
        timer = setInterval(() => {
          if (running) return; // a slow tick must not overlap the next — over-quota race
          running = true;
          void tick()
            .catch(() => {})
            .finally(() => {
              running = false;
            });
        }, 5_000);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
  };
}

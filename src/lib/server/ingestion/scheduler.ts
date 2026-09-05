import type { Config } from '../config';
import type { SourceName } from '../db/types';
import type { GatekeeperAdapter } from '../adapters/gatekeeper/types';
import type { ReputationSource } from '../reputation/types';
import * as repo from '../db/repo';
import { appendAudit } from '../audit/log';
import { evaluateDomain } from '../pipeline/evaluate';
import { now } from '../time';

export interface IngestionDeps {
  db: any;
  schema: any;
  cfg: Config;
  adapter: GatekeeperAdapter;
  curated: { assess: ReputationSource['assess']; has: (d: string) => boolean };
  eligibleSourceNames: SourceName[];
}

export interface IngestionEngine {
  runOnce(): Promise<{ newCount: number; pages: number }>;
  start(): void;
  stop(): void;
}

export function makeIngestion(deps: IngestionDeps): IngestionEngine {
  const { db, schema, cfg } = deps;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function runOnce(): Promise<{ newCount: number; pages: number }> {
    const state = await repo.getIngestState(db, schema);
    const until = now();
    const since = state.lastIngestAt ?? until - cfg.firstRunLookbackMs;
    let cursor: string | undefined = state.cursor ?? undefined;
    const cap = state.firstRunDone ? Infinity : cfg.firstRunCap;

    let newCount = 0;
    let pages = 0;
    let gapAudited = false;

    while (true) {
      const page = await deps.adapter.listResolvedDomains({
        since,
        until,
        cursor,
        limit: 500
      });
      pages++;

      if (page.gapBefore != null && !gapAudited) {
        await appendAudit(db, schema, {
          actor: 'system',
          event: 'ingest.gap',
          data: { since, gapBefore: page.gapBefore }
        });
        gapAudited = true;
      }

      for (const entry of page.entries) {
        if (entry.disposition !== 'allowed') continue;
        if (await repo.isAllowlisted(db, schema, entry.domain)) continue;

        const { domainId, created } = await repo.upsertObservedDomain(
          db,
          schema,
          {
            domain: entry.domain,
            clientId: entry.client.id,
            at: entry.at
          }
        );
        if (created) newCount++;

        const cv = await deps.curated.assess({
          domain: entry.domain,
          hitCount: 0,
          distinctClientCount: 0,
          curatedListHits: deps.curated.has(entry.domain) ? ['curated'] : [],
          enrichment: { dns: null }
        });

        if (cv.verdict === 'block') {
          await repo.upsertVerdict(db, schema, {
            domainId,
            source: 'curated_list',
            verdict: 'block',
            confidence: cv.confidence,
            category: cv.category,
            detail: cv.detail,
            raw: cv.raw,
            assessedAt: now()
          });
        }

        await evaluateDomain(
          db,
          schema,
          domainId,
          deps.eligibleSourceNames,
          cfg
        );
      }

      cursor = page.nextCursor ?? undefined;
      if (page.nextCursor == null || newCount >= cap) break;
    }

    await repo.setIngestState(db, schema, {
      cursor: cursor ?? null,
      lastIngestAt: until,
      firstRunDone: true
    });

    return { newCount, pages };
  }

  return {
    runOnce,
    start() {
      if (timer) return;
      const tick = () => {
        if (running) return;
        running = true;
        void runOnce()
          .catch((err) => {
            console.error('[ingestion] Scheduled run failed:', err);
          })
          .finally(() => {
            running = false;
          });
      };
      tick();
      timer = setInterval(tick, cfg.ingestIntervalMs);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
  };
}

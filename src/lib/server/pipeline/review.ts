import { asc, eq } from 'drizzle-orm';
import type { DomainState, SourceName, VerdictValue } from '../db/types';
import * as repo from '../db/repo';
import type { VerdictRow } from '../db/repo';
import { appendAudit } from '../audit/log';
import { publish } from '../events';
import { now } from '../time';

export interface ReviewListItem {
  domain: string;
  score: number | null;
  hitCount: number;
  distinctClientCount: number;
  firstSeen: number;
  lastSeen: number;
  verdicts: {
    source: SourceName;
    verdict: VerdictValue;
    confidence: number;
    category: string | null;
    detail: string | null;
  }[];
}

export interface ReviewDetail extends ReviewListItem {
  firstSeen: number;
  lastSeen: number;
  state: DomainState;
  verdictsFull: VerdictRow[];
  audit: {
    id: number;
    at: number;
    actor: string;
    event: string;
    data: unknown;
  }[];
  allowlist: { reason: string; addedAt: number } | null;
  rawBySource: Record<string, unknown>;
}

const summarize = (vs: VerdictRow[]) =>
  vs.map((v) => ({
    source: v.source as SourceName,
    verdict: v.verdict as VerdictValue,
    confidence: v.confidence,
    category: v.category,
    detail: v.detail
  }));

export async function listReview(
  db: any,
  schema: any,
  limit: number,
  offset: number
): Promise<ReviewListItem[]> {
  const domains = await repo.listPendingReview(db, schema, limit, offset);
  const out: ReviewListItem[] = [];
  for (const d of domains) {
    const vs = await repo.listVerdictsForDomain(db, schema, d.id);
    out.push({
      domain: d.domain,
      score: d.score,
      hitCount: d.hitCount,
      distinctClientCount: (d as any).distinctClientCount ?? 0,
      firstSeen: d.firstSeen,
      lastSeen: d.lastSeen,
      verdicts: summarize(vs)
    });
  }
  return out;
}

export async function getReviewDetail(
  db: any,
  schema: any,
  domain: string
): Promise<ReviewDetail | null> {
  const d = await repo.getDomainByName(db, schema, domain);
  if (!d) return null;
  const vs = await repo.listVerdictsForDomain(db, schema, d.id);
  const allow = await repo.getAllowlistRow(db, schema, domain);
  const audit = await db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.domainId, d.id))
    .orderBy(asc(schema.auditLog.at));
  return {
    domain: d.domain,
    score: d.score,
    hitCount: d.hitCount,
    distinctClientCount: (d as any).distinctClientCount ?? 0,
    verdicts: summarize(vs),
    firstSeen: d.firstSeen,
    lastSeen: d.lastSeen,
    state: d.state as DomainState,
    verdictsFull: vs,
    audit: audit.map((a: any) => ({
      id: a.id,
      at: a.at,
      actor: a.actor,
      event: a.event,
      data: a.data
    })),
    allowlist: allow ? { reason: allow.reason, addedAt: allow.addedAt } : null,
    rawBySource: Object.fromEntries(vs.map((v) => [v.source, v.raw]))
  };
}

export async function decide(
  db: any,
  schema: any,
  domain: string,
  decision: 'approve' | 'reject',
  note: string | null
): Promise<{ ok: true } | { ok: false; code: 404 | 409; message: string }> {
  const d = await repo.getDomainByName(db, schema, domain);
  if (!d) return { ok: false, code: 404, message: 'unknown domain' };
  if (d.state !== 'pending_review')
    return {
      ok: false,
      code: 409,
      message: `domain is ${d.state}, not pending_review`
    };

  const at = now();
  await repo.decideDomain(db, schema, d.id, decision, note, at);
  publish({ type: 'decision', domain, decision });
  if (decision === 'reject')
    await repo.addAllowlist(db, schema, domain, 'rejected by user', at);
  await appendAudit(db, schema, {
    actor: 'user',
    event: `decision.${decision}`,
    domainId: d.id,
    data: { note }
  });
  return { ok: true };
}

export async function undoDecision(db: any, schema: any, domain: string) {
  const d = await repo.getDomainByName(db, schema, domain);
  if (!d || !['approved', 'rejected'].includes(d.state))
    return { ok: false as const, code: 409 as const, message: 'decision cannot be undone' };
  await repo.setDomainScoreAndState(db, schema, d.id, d.score, 'pending_review');
  if (d.state === 'rejected') await repo.removeAllowlist(db, schema, domain);
  await appendAudit(db, schema, { actor: 'user', event: 'decision.undo', domainId: d.id, data: { previous: d.state } });
  publish({ type: 'domain.state', domain, state: 'pending_review', score: d.score });
  return { ok: true as const };
}

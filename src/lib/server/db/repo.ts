import { and, asc, desc, eq, inArray, notInArray } from 'drizzle-orm';
import type { DomainState, SourceName } from './types';

export type { DomainRow, VerdictRow, IngestStateRow } from './types';
import type { DomainRow, VerdictRow, IngestStateRow } from './types';

/** Fields a caller supplies when recording a verdict; the rest are optional/derived. */
export type NewVerdict = Omit<
  VerdictRow,
  'id' | 'category' | 'detail' | 'inputTokens' | 'outputTokens' | 'costUsd'
> &
  Partial<
    Pick<
      VerdictRow,
      'category' | 'detail' | 'inputTokens' | 'outputTokens' | 'costUsd'
    >
  >;

const QUEUE_STATES: DomainState[] = ['observed', 'assessing'];

export async function upsertObservedDomain(
  db: any,
  schema: any,
  args: { domain: string; clientId: string; at: number }
): Promise<{ domainId: number; created: boolean }> {
  // args.clientId is accepted for caller compatibility but intentionally unused —
  // ponytail: no per-client tracking; hit_count is the only priority signal.
  const [existing] = await db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.domain, args.domain))
    .limit(1);

  let domainId: number;
  let created: boolean;
  let hitCount: number;
  let lastSeen: number;

  if (!existing) {
    const [row] = await db
      .insert(schema.domains)
      .values({
        domain: args.domain,
        firstSeen: args.at,
        lastSeen: args.at,
        hitCount: 0
      })
      .returning();
    domainId = row.id;
    created = true;
    hitCount = 0;
    lastSeen = args.at;
  } else {
    domainId = existing.id;
    created = false;
    hitCount = existing.hitCount;
    lastSeen = existing.lastSeen;
  }

  await db
    .update(schema.domains)
    .set({ hitCount: hitCount + 1, lastSeen: Math.max(lastSeen, args.at) })
    .where(eq(schema.domains.id, domainId));

  return { domainId, created };
}

export async function getDomainByName(
  db: any,
  schema: any,
  domain: string
): Promise<DomainRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.domain, domain))
    .limit(1);
  return row;
}

export async function getDomainById(
  db: any,
  schema: any,
  id: number
): Promise<DomainRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.id, id))
    .limit(1);
  return row;
}

export async function setDomainScoreAndState(
  db: any,
  schema: any,
  id: number,
  score: number | null,
  state: DomainState
): Promise<void> {
  await db
    .update(schema.domains)
    .set({ score, state })
    .where(eq(schema.domains.id, id));
}

export async function decideDomain(
  db: any,
  schema: any,
  id: number,
  decision: 'approve' | 'reject',
  note: string | null,
  at: number
): Promise<void> {
  await db
    .update(schema.domains)
    .set({
      state: decision === 'approve' ? 'approved' : 'rejected',
      decidedAt: at,
      decisionNote: note
    })
    .where(eq(schema.domains.id, id));
}

export async function listQueuedDomains(
  db: any,
  schema: any,
  sourceNotYetRun: SourceName,
  limit: number
): Promise<DomainRow[]> {
  const done = db
    .select({ id: schema.verdicts.domainId })
    .from(schema.verdicts)
    .where(eq(schema.verdicts.source, sourceNotYetRun));
  return db
    .select()
    .from(schema.domains)
    .where(
      and(
        inArray(schema.domains.state, QUEUE_STATES),
        notInArray(schema.domains.id, done)
      )
    )
    .orderBy(desc(schema.domains.hitCount), asc(schema.domains.firstSeen))
    .limit(limit);
}

export async function listPendingReview(
  db: any,
  schema: any,
  limit: number,
  offset: number
): Promise<DomainRow[]> {
  return db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.state, 'pending_review'))
    .orderBy(desc(schema.domains.hitCount), asc(schema.domains.firstSeen))
    .limit(limit)
    .offset(offset);
}

export async function listApprovedDomains(
  db: any,
  schema: any
): Promise<string[]> {
  const rows = await db
    .select({ domain: schema.domains.domain })
    .from(schema.domains)
    .where(eq(schema.domains.state, 'approved'))
    .orderBy(asc(schema.domains.domain));
  return rows.map((r: { domain: string }) => r.domain);
}

export async function upsertVerdict(
  db: any,
  schema: any,
  v: NewVerdict
): Promise<void> {
  const values = {
    domainId: v.domainId,
    source: v.source,
    verdict: v.verdict,
    confidence: v.confidence,
    category: v.category ?? null,
    detail: v.detail ?? null,
    raw: v.raw,
    assessedAt: v.assessedAt,
    inputTokens: v.inputTokens ?? null,
    outputTokens: v.outputTokens ?? null,
    costUsd: v.costUsd ?? null
  };
  // Replace-on-conflict for the (domain_id, source) unique index: everything except
  // the identity columns is overwritten by the newer assessment.
  const { domainId: _d, source: _s, ...set } = values;
  await db
    .insert(schema.verdicts)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.verdicts.domainId, schema.verdicts.source],
      set
    });
}

export async function listVerdictsForDomain(
  db: any,
  schema: any,
  domainId: number
): Promise<VerdictRow[]> {
  return db
    .select()
    .from(schema.verdicts)
    .where(eq(schema.verdicts.domainId, domainId));
}

export async function isAllowlisted(
  db: any,
  schema: any,
  domain: string
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(schema.allowlist)
    .where(eq(schema.allowlist.domain, domain))
    .limit(1);
  return !!row;
}

export async function addAllowlist(
  db: any,
  schema: any,
  domain: string,
  reason: string,
  at: number
): Promise<void> {
  await db
    .insert(schema.allowlist)
    .values({ domain, reason, addedAt: at })
    .onConflictDoNothing();
}

export async function getIngestState(
  db: any,
  schema: any
): Promise<IngestStateRow> {
  const [row] = await db
    .select()
    .from(schema.ingestState)
    .where(eq(schema.ingestState.id, 1))
    .limit(1);
  if (row) return row;
  const [created] = await db
    .insert(schema.ingestState)
    .values({ id: 1, cursor: null, lastIngestAt: null, firstRunDone: false })
    .returning();
  return created;
}

export async function setIngestState(
  db: any,
  schema: any,
  patch: Partial<{
    cursor: string | null;
    lastIngestAt: number | null;
    firstRunDone: boolean;
  }>
): Promise<void> {
  await getIngestState(db, schema); // ensure the id=1 row exists
  await db
    .update(schema.ingestState)
    .set(patch)
    .where(eq(schema.ingestState.id, 1));
}

export async function logBlocklistFetch(
  db: any,
  schema: any,
  row: { at: number; ip: string; userAgent: string | null; status: number }
): Promise<void> {
  await db.insert(schema.blocklistFetchLog).values(row);
}

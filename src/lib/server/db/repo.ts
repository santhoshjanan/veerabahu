import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lt,
  notInArray,
  sql
} from 'drizzle-orm';
import type { DomainState, SourceName } from './types';

export type {
  AppConfigRow,
  ConfigSecretRow,
  DomainRow,
  VerdictRow,
  IngestStateRow
} from './types';
import type {
  AppConfigRow,
  ConfigSecretRow,
  DomainRow,
  VerdictRow,
  IngestStateRow
} from './types';
import { DOMAIN_STATES } from './types';
import type {
  AllowlistRow,
  AuditLogRow,
  BlocklistFetchLogRow,
  CuratedListRow,
  SourceRateStateRow
} from './types';

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

export async function getAppConfig(
  db: any,
  schema: any
): Promise<AppConfigRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.appConfig)
    .where(eq(schema.appConfig.id, 1))
    .limit(1);
  return row;
}

export async function getConfigSecret(
  db: any,
  schema: any,
  name: string
): Promise<ConfigSecretRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.configSecrets)
    .where(eq(schema.configSecrets.name, name))
    .limit(1);
  return row;
}

export async function listConfigSecrets(
  db: any,
  schema: any
): Promise<ConfigSecretRow[]> {
  return db.select().from(schema.configSecrets);
}

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

const QUEUE_BACKLOG_STATES: DomainState[] = ['observed', 'assessing'];

export async function countDomainsByState(
  db: any,
  schema: any
): Promise<Record<DomainState, number>> {
  const rows = await db
    .select({ state: schema.domains.state, n: sql<number>`count(*)` })
    .from(schema.domains)
    .groupBy(schema.domains.state);
  const out = Object.fromEntries(DOMAIN_STATES.map((s) => [s, 0])) as Record<
    DomainState,
    number
  >;
  for (const r of rows) out[r.state as DomainState] = Number(r.n);
  return out;
}

export async function countDomainsSince(
  db: any,
  schema: any,
  field: 'firstSeen',
  sinceMs: number
): Promise<number> {
  const col = schema.domains[field];
  const [r] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.domains)
    .where(gte(col, sinceMs));
  return Number(r.n);
}

export async function countDomainsInStateSince(
  db: any,
  schema: any,
  state: DomainState,
  field: 'decidedAt' | 'lastSeen',
  sinceMs: number
): Promise<number> {
  const col = schema.domains[field];
  const [r] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.domains)
    .where(and(eq(schema.domains.state, state), gte(col, sinceMs)));
  return Number(r.n);
}

export async function countPublished(db: any, schema: any): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.domains)
    .where(eq(schema.domains.state, 'approved'));
  return Number(r.n);
}

export async function listRecentBlocklistFetches(
  db: any,
  schema: any,
  limit: number
): Promise<BlocklistFetchLogRow[]> {
  return db
    .select()
    .from(schema.blocklistFetchLog)
    .orderBy(
      desc(schema.blocklistFetchLog.at),
      desc(schema.blocklistFetchLog.id)
    )
    .limit(limit);
}

export async function getCuratedLists(
  db: any,
  schema: any
): Promise<CuratedListRow[]> {
  return db
    .select()
    .from(schema.curatedLists)
    .orderBy(asc(schema.curatedLists.name));
}

export async function getAllSourceRateState(
  db: any,
  schema: any
): Promise<SourceRateStateRow[]> {
  return db.select().from(schema.sourceRateState);
}

export async function countVerdictsSince(
  db: any,
  schema: any,
  sinceMs: number
): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.verdicts)
    .where(gte(schema.verdicts.assessedAt, sinceMs));
  return Number(r.n);
}

export async function sumVerdictCostSince(
  db: any,
  schema: any,
  sinceMs: number
): Promise<number> {
  const [r] = await db
    .select({ s: sql<number | null>`sum(${schema.verdicts.costUsd})` })
    .from(schema.verdicts)
    .where(gte(schema.verdicts.assessedAt, sinceMs));
  return r.s == null ? 0 : Number(r.s);
}

export async function countBacklogForSource(
  db: any,
  schema: any,
  source: SourceName
): Promise<number> {
  const done = db
    .select({ id: schema.verdicts.domainId })
    .from(schema.verdicts)
    .where(eq(schema.verdicts.source, source));
  const [r] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.domains)
    .where(
      and(
        inArray(schema.domains.state, QUEUE_BACKLOG_STATES),
        notInArray(schema.domains.id, done)
      )
    );
  return Number(r.n);
}

function domainWhere(
  schema: any,
  opts: { search?: string; state?: DomainState }
) {
  const clauses = [];
  if (opts.state) clauses.push(eq(schema.domains.state, opts.state));
  if (opts.search)
    clauses.push(
      sql`lower(${schema.domains.domain}) like ${'%' + opts.search.toLowerCase() + '%'}`
    );
  return clauses.length ? and(...clauses) : undefined;
}

export async function searchDomains(
  db: any,
  schema: any,
  opts: { search?: string; state?: DomainState; limit: number; offset: number }
): Promise<(DomainRow & { verdictCount: number })[]> {
  // Left join + group so verdictCount is a real per-domain aggregate. A correlated
  // subquery here loses its table qualifiers under drizzle's single-table select
  // and silently miscounts.
  const rows = await db
    .select({
      d: schema.domains,
      verdictCount: sql<number>`count(${schema.verdicts.id})`
    })
    .from(schema.domains)
    .leftJoin(schema.verdicts, eq(schema.verdicts.domainId, schema.domains.id))
    .where(domainWhere(schema, opts))
    .groupBy(schema.domains.id)
    .orderBy(desc(schema.domains.lastSeen), asc(schema.domains.domain))
    .limit(opts.limit)
    .offset(opts.offset);
  return rows.map((r: any) => ({
    ...r.d,
    verdictCount: Number(r.verdictCount)
  }));
}

export async function countDomainsMatching(
  db: any,
  schema: any,
  opts: { search?: string; state?: DomainState }
): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.domains)
    .where(domainWhere(schema, opts));
  return Number(r.n);
}

function auditWhere(
  schema: any,
  opts: { event?: string; actor?: string; since?: number; until?: number }
) {
  const c = [];
  if (opts.event) c.push(eq(schema.auditLog.event, opts.event));
  if (opts.actor) c.push(eq(schema.auditLog.actor, opts.actor));
  if (opts.since != null) c.push(gte(schema.auditLog.at, opts.since));
  if (opts.until != null) c.push(lt(schema.auditLog.at, opts.until));
  return c.length ? and(...c) : undefined;
}

export async function listAuditRows(
  db: any,
  schema: any,
  opts: {
    event?: string;
    actor?: string;
    since?: number;
    until?: number;
    limit: number;
    offset: number;
  }
): Promise<(AuditLogRow & { domain: string | null })[]> {
  const rows = await db
    .select({ a: schema.auditLog, domain: schema.domains.domain })
    .from(schema.auditLog)
    .leftJoin(schema.domains, eq(schema.auditLog.domainId, schema.domains.id))
    .where(auditWhere(schema, opts))
    .orderBy(desc(schema.auditLog.at), desc(schema.auditLog.id))
    .limit(opts.limit)
    .offset(opts.offset);
  return rows.map((r: any) => ({ ...r.a, domain: r.domain ?? null }));
}

export async function countAuditRows(
  db: any,
  schema: any,
  opts: { event?: string; actor?: string; since?: number; until?: number }
): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.auditLog)
    .where(auditWhere(schema, opts));
  return Number(r.n);
}

export async function getAllowlistRow(
  db: any,
  schema: any,
  domain: string
): Promise<AllowlistRow | undefined> {
  const [r] = await db
    .select()
    .from(schema.allowlist)
    .where(eq(schema.allowlist.domain, domain))
    .limit(1);
  return r;
}

export async function removeAllowlist(
  db: any,
  schema: any,
  domain: string
): Promise<void> {
  await db.delete(schema.allowlist).where(eq(schema.allowlist.domain, domain));
}

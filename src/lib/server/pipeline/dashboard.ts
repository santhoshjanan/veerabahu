import * as repo from '../db/repo';
import { SOURCE_NAMES } from '../db/types';
import type { DomainState, SourceName } from '../db/types';
import { now } from '../time';

export const WINDOW_MS = 86_400_000;

export interface SourceQuotaSummary {
  source: SourceName;
  remainingDay: number | null;
  remainingMonth: number | null;
  pausedUntil: number | null;
}

export interface DashboardView {
  counts: Record<DomainState, number>;
  observed24h: number;
  autoCleared24h: number;
  publishedCount: number;
  verdictsToday: number;
  aiCostTodayUsd: number;
  lastPull: { at: number; ip: string; status: number } | null;
  recentPulls: { at: number; status: number }[];
  curatedLists: {
    name: string;
    lastFetched: number | null;
    entryCount: number;
    lastError: string | null;
  }[];
  sources: SourceQuotaSummary[];
  recentAudit: {
    at: number;
    actor: string;
    event: string;
    domain: string | null;
  }[];
}

export async function getDashboard(
  db: any,
  schema: any,
  nowMs: number = now()
): Promise<DashboardView> {
  const since = nowMs - WINDOW_MS;
  const [
    counts,
    observed24h,
    autoCleared24h,
    publishedCount,
    verdictsToday,
    aiCostTodayUsd,
    fetches,
    curated,
    rateRows,
    recentAudit
  ] = await Promise.all([
    repo.countDomainsByState(db, schema),
    repo.countDomainsSince(db, schema, 'firstSeen', since),
    repo.countDomainsInStateSince(db, schema, 'auto_cleared', 'lastSeen', since),
    repo.countPublished(db, schema),
    repo.countVerdictsSince(db, schema, since),
    repo.sumVerdictCostSince(db, schema, since),
    repo.listRecentBlocklistFetches(db, schema, 10),
    repo.getCuratedLists(db, schema),
    repo.getAllSourceRateState(db, schema),
    repo.listAuditRows(db, schema, { limit: 8, offset: 0 })
  ]);

  const byName = new Map(rateRows.map((r: any) => [r.source, r]));
  const sources: SourceQuotaSummary[] = SOURCE_NAMES.filter(
    (s) => s !== 'curated_list'
  ).map((source) => {
    const r: any = byName.get(source);
    return {
      source,
      remainingDay: r ? Math.max(0, quotaDay(source) - r.dayCount) : null,
      remainingMonth: r ? Math.max(0, quotaMonth(source) - r.monthCount) : null,
      pausedUntil: r?.pausedUntil ?? null
    };
  });

  return {
    counts,
    observed24h,
    autoCleared24h,
    publishedCount,
    verdictsToday,
    aiCostTodayUsd,
    lastPull: fetches[0]
      ? { at: fetches[0].at, ip: fetches[0].ip, status: fetches[0].status }
      : null,
    recentPulls: fetches.map((f: any) => ({ at: f.at, status: f.status })),
    curatedLists: curated.map((c: any) => ({
      name: c.name,
      lastFetched: c.lastFetched,
      entryCount: c.entryCount,
      lastError: c.lastError
    })),
    sources,
    recentAudit: recentAudit.map((r: any) => ({
      at: r.at,
      actor: r.actor,
      event: r.event,
      domain: r.domain
    }))
  };
}

// Free-tier ceilings, mirrored from master-requirements §9. Settings (#4) will make
// these editable; until then they are display-only reference numbers.
// ponytail: hard-coded ceilings, move to config when Settings lands.
function quotaDay(s: SourceName): number {
  return s === 'metadefender' ? 4000 : s === 'virustotal' ? 500 : 100000;
}
function quotaMonth(s: SourceName): number {
  return s === 'virustotal' ? 15500 : quotaDay(s) * 31;
}

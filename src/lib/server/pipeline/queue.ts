import * as repo from '../db/repo';
import { SOURCE_NAMES } from '../db/types';
import type { SourceName } from '../db/types';
import { getInFocus } from '../events';
import { now } from '../time';

const DAY = 86_400_000;
const MONTH = DAY * 31;

// ponytail: reference free-tier ceilings, same numbers as dashboard.ts; Settings (#4)
// makes them editable and this module reads them from config instead.
function quotaDay(s: SourceName): number {
  return s === 'metadefender' ? 4000 : s === 'virustotal' ? 500 : 100_000;
}
function quotaMonth(s: SourceName): number {
  return s === 'virustotal' ? 15_500 : quotaDay(s) * 31;
}

export function amortizedIntervalMs(source: SourceName): number {
  if (source === 'curated_list') return 0;
  return Math.max(DAY / quotaDay(source), MONTH / quotaMonth(source));
}

export interface QueueSourceView {
  source: SourceName;
  inline: boolean;
  backlog: number;
  amortizedIntervalMs: number | null;
  nextCallAt: number | null;
  remainingDay: number | null;
  remainingMonth: number | null;
  pausedUntil: number | null;
  lastError: string | null;
  etaMs: number | null;
  inFocus: string | null;
}

export interface QueueView {
  sources: QueueSourceView[];
  ingestion: {
    lastIngestAt: number | null;
    cursor: string | null;
    firstRunDone: boolean;
    nextRunAt: number | null;
  };
  totalBacklog: number;
}

export async function getQueue(
  db: any,
  schema: any,
  nowMs: number = now()
): Promise<QueueView> {
  const [rateRows, ingest, counts] = await Promise.all([
    repo.getAllSourceRateState(db, schema),
    repo.getIngestState(db, schema),
    repo.countDomainsByState(db, schema)
  ]);
  const rateByName = new Map(rateRows.map((r: any) => [r.source, r]));
  const focus = getInFocus();

  const sources: QueueSourceView[] = [];

  for (const source of SOURCE_NAMES) {
    const inline = source === 'curated_list';
    const backlog = await repo.countBacklogForSource(db, schema, source);
    const r: any = rateByName.get(source);
    const interval = inline ? 0 : amortizedIntervalMs(source);
    const etaMs = inline || backlog === 0 ? null : backlog * interval;
    sources.push({
      source,
      inline,
      backlog,
      amortizedIntervalMs: inline ? null : interval,
      nextCallAt: inline
        ? null
        : r?.lastCallAt
          ? r.lastCallAt + interval
          : nowMs,
      remainingDay: r ? Math.max(0, quotaDay(source) - r.dayCount) : null,
      remainingMonth: r ? Math.max(0, quotaMonth(source) - r.monthCount) : null,
      pausedUntil: r?.pausedUntil ?? null,
      lastError: null,
      etaMs,
      inFocus: focus[source] ?? null
    });
  }

  const intervalMin = Number(process.env.VB_INGEST_INTERVAL_MIN ?? 15);
  return {
    sources,
    ingestion: {
      lastIngestAt: ingest.lastIngestAt ?? null,
      cursor: ingest.cursor ?? null,
      firstRunDone: !!ingest.firstRunDone,
      nextRunAt: ingest.lastIngestAt
        ? ingest.lastIngestAt + intervalMin * 60_000
        : null
    },
    totalBacklog: counts.observed + counts.assessing
  };
}

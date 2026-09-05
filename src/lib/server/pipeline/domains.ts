import * as repo from '../db/repo';
import type { DomainState } from '../db/types';

export const PAGE_SIZE = 50;

export interface DomainListItem {
  domain: string;
  state: DomainState;
  score: number | null;
  hitCount: number;
  firstSeen: number;
  lastSeen: number;
  decidedAt: number | null;
  verdictCount: number;
}

export interface DomainListResult {
  items: DomainListItem[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

export async function listDomains(
  db: any,
  schema: any,
  opts: { search?: string; state?: DomainState; page?: number }
): Promise<DomainListResult> {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const filter = { search: opts.search?.trim() || undefined, state: opts.state };
  const [rows, total] = await Promise.all([
    repo.searchDomains(db, schema, {
      ...filter,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE
    }),
    repo.countDomainsMatching(db, schema, filter)
  ]);
  return {
    items: rows.map((r) => ({
      domain: r.domain,
      state: r.state as DomainState,
      score: r.score,
      hitCount: r.hitCount,
      firstSeen: r.firstSeen,
      lastSeen: r.lastSeen,
      decidedAt: r.decidedAt,
      verdictCount: r.verdictCount
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    pageSize: PAGE_SIZE
  };
}

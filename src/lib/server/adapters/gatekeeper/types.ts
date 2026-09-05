export interface ResolvedQuery {
  domain: string;
  client: { id: string; label: string | null };
  at: number; // epoch ms
  disposition: 'allowed' | 'blocked' | 'other';
  rawStatus: string;
}

export interface GatekeeperAdapter {
  listResolvedDomains(opts: {
    since: number;
    until: number;
    cursor?: string;
    limit: number;
  }): Promise<{ entries: ResolvedQuery[]; nextCursor: string | null; gapBefore: number | null }>;
}

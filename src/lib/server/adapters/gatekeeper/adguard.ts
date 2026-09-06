import type { GatekeeperAdapter, ResolvedQuery } from './types';

interface AdguardCfg {
  baseUrl: string;
  password: string;
  username?: string;
  fetchImpl?: typeof fetch;
}

interface AdguardEntry {
  question?: { name?: string };
  client?: string | { ip?: string; name?: string | null };
  time?: string | number;
  reason?: string;
}

const dispositionOf = (reason: string): ResolvedQuery['disposition'] =>
  reason.startsWith('NotFiltered')
    ? 'allowed'
    : reason.startsWith('Filtered')
      ? 'blocked'
      : 'other';

const timestamp = (value: string | number): number =>
  typeof value === 'number'
    ? value < 1e12
      ? value * 1000
      : value
    : Date.parse(value);

export function makeAdguardAdapter(cfg: AdguardCfg): GatekeeperAdapter {
  const doFetch = cfg.fetchImpl ?? fetch;
  const auth = `Basic ${btoa(`${cfg.username ?? ''}:${cfg.password}`)}`;

  return {
    async listResolvedDomains(opts) {
      const params = new URLSearchParams({
        limit: String(opts.limit),
        offset: '0'
      });
      params.set(
        'older_than',
        opts.cursor ?? new Date(opts.until).toISOString()
      );
      const res = await doFetch(
        `${cfg.baseUrl.replace(/\/+$/, '')}/control/querylog?${params}`,
        {
          headers: { authorization: auth },
          signal: AbortSignal.timeout(15_000)
        }
      );
      if (!res.ok) throw new Error(`AdGuard /querylog returned ${res.status}`);
      const body = (await res.json()) as {
        data?: AdguardEntry[];
        oldest?: string | number;
      };
      if (!Array.isArray(body.data))
        throw new Error('AdGuard /querylog returned invalid response');
      const entries = body.data
        .map((q) => {
          const client =
            typeof q.client === 'string'
              ? { id: q.client, label: null }
              : { id: q.client?.ip ?? '', label: q.client?.name ?? null };
          const reason = q.reason ?? '';
          return {
            domain: q.question?.name ?? '',
            client,
            at: timestamp(q.time ?? 0),
            disposition: dispositionOf(reason),
            rawStatus: reason
          };
        })
        .filter((entry) => entry.at >= opts.since && entry.at <= opts.until);
      const oldest = body.oldest === undefined ? null : timestamp(body.oldest);
      return {
        entries,
        nextCursor:
          body.data.length === opts.limit &&
          oldest !== null &&
          oldest > opts.since &&
          body.data.some((entry) => timestamp(entry.time ?? 0) > opts.since)
            ? String(body.oldest)
            : null,
        gapBefore:
          body.data.length < opts.limit &&
          oldest !== null &&
          oldest > opts.since
            ? oldest
            : null
      };
    }
  };
}

import type { GatekeeperAdapter, ResolvedQuery } from './types';

const ALLOWED = new Set(['FORWARDED', 'CACHE', 'CACHE_STALE', 'RETRIED', 'RETRIED_DNSSEC']);
const BLOCKED = new Set([
  'GRAVITY',
  'DENYLIST',
  'REGEX',
  'EXTERNAL_BLOCKED_IP',
  'EXTERNAL_BLOCKED_NULL',
  'EXTERNAL_BLOCKED_NXRA',
  'GRAVITY_CNAME',
  'REGEX_CNAME',
  'DENYLIST_CNAME'
]);

function dispositionOf(status: string): ResolvedQuery['disposition'] {
  if (ALLOWED.has(status)) return 'allowed';
  if (BLOCKED.has(status)) return 'blocked';
  return 'other';
}

interface PiholeQueryRow {
  id: number;
  time: number;
  domain: string;
  status: string;
  client: { ip: string; name: string | null };
}

interface PiholeCfg {
  baseUrl: string;
  appPassword: string;
  fetchImpl?: typeof fetch;
}

export function makePiholeAdapter(cfg: PiholeCfg) {
  const doFetch = cfg.fetchImpl ?? fetch;
  let sid: string | null = null;

  async function login(): Promise<void> {
    const res = await doFetch(`${cfg.baseUrl}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: cfg.appPassword }),
      signal: AbortSignal.timeout(15_000)
    });
    const body = (await res.json().catch(() => ({}))) as {
      session?: { valid?: boolean; sid?: string };
    };
    if (!res.ok || !body.session?.valid || !body.session.sid) {
      throw new Error(`Pi-hole auth failed (status ${res.status})`);
    }
    sid = body.session.sid;
  }

  async function _authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    if (!sid) await login();
    const call = () =>
      doFetch(`${cfg.baseUrl}${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), 'X-FTL-SID': sid! },
        signal: init.signal ?? AbortSignal.timeout(15_000)
      });
    let res = await call();
    if (res.status === 401) {
      sid = null;
      await login();
      res = await call();
    }
    return res;
  }

  const adapter: GatekeeperAdapter = {
    async listResolvedDomains(opts) {
      const params = new URLSearchParams({
        from: String(Math.floor(opts.since / 1000)),
        until: String(Math.ceil(opts.until / 1000)),
        length: String(opts.limit)
      });
      if (opts.cursor) params.set('cursor', opts.cursor);

      const res = await _authedFetch(`/queries?${params.toString()}`);
      if (!res.ok) throw new Error(`Pi-hole /queries returned ${res.status}`);
      const body = (await res.json()) as {
        queries: PiholeQueryRow[];
        cursor: number | null;
        earliest_timestamp: number;
      };

      const entries: ResolvedQuery[] = body.queries.map((q) => ({
        domain: q.domain,
        client: { id: q.client.ip, label: q.client.name ?? null },
        at: Math.round(q.time * 1000),
        disposition: dispositionOf(q.status),
        rawStatus: q.status
      }));

      const earliestMs = Math.round(body.earliest_timestamp * 1000);
      const gapBefore = earliestMs > opts.since ? earliestMs : null;

      return {
        entries,
        nextCursor: body.cursor === null ? null : String(body.cursor),
        gapBefore
      };
    }
  };

  return Object.assign(adapter, { _authedFetch });
}

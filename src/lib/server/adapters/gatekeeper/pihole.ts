import type { GatekeeperAdapter } from './types';

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
      body: JSON.stringify({ password: cfg.appPassword })
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
    async listResolvedDomains() {
      throw new Error('implemented in Task 6');
    }
  };

  return Object.assign(adapter, { _authedFetch });
}

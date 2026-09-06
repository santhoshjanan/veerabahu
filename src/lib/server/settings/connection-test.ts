import type { StoredSettings } from './types';
import type { GatekeeperConnectionResult } from '../adapters/gatekeeper/types';

export type ConnectionTestResult = GatekeeperConnectionResult;

export async function testGatekeeper(
  settings: Pick<StoredSettings, 'gatekeeper'>,
  secret: string,
  fetchImpl: typeof fetch = fetch
): Promise<ConnectionTestResult> {
  if (!settings.gatekeeper || !secret) return { kind: 'invalid_response' };
  try {
    const baseUrl = settings.gatekeeper.baseUrl.replace(/\/+$/, '');
    if (settings.gatekeeper.type === 'adguard') {
      const response = await fetchImpl(
        `${baseUrl}/control/querylog?limit=1&offset=0`,
        {
          headers: {
            authorization: `Basic ${btoa(`${settings.gatekeeper.username ?? ''}:${secret}`)}`
          },
          signal: AbortSignal.timeout(5_000)
        }
      );
      if (response.status === 401 || response.status === 403)
        return { kind: 'auth_rejected' };
      if (!response.ok) return { kind: 'invalid_response' };
      const body = await response.json().catch(() => null);
      return Array.isArray(body?.data)
        ? { kind: 'connected' }
        : { kind: 'invalid_response' };
    }

    const auth = await fetchImpl(`${baseUrl}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: secret }),
      signal: AbortSignal.timeout(5_000)
    });
    if (auth.status === 401 || auth.status === 403)
      return { kind: 'auth_rejected' };
    if (!auth.ok) return { kind: 'invalid_response' };
    const authBody = await auth.json().catch(() => null);
    if (!authBody?.session?.valid || !authBody.session.sid)
      return { kind: 'invalid_response' };
    const response = await fetchImpl(`${baseUrl}/queries?length=1`, {
      headers: { 'X-FTL-SID': authBody.session.sid },
      signal: AbortSignal.timeout(5_000)
    });
    if (response.status === 401 || response.status === 403)
      return { kind: 'auth_rejected' };
    if (!response.ok) return { kind: 'invalid_response' };
    const body = await response.json().catch(() => null);
    return Array.isArray(body?.queries)
      ? { kind: 'connected' }
      : { kind: 'invalid_response' };
  } catch {
    return { kind: 'unreachable' };
  }
}

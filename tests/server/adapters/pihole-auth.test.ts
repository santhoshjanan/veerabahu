import { describe, it, expect, afterEach } from 'vitest';
import { startStubPihole } from '../../helpers/stub-pihole';
import { makePiholeAdapter } from '$lib/server/adapters/gatekeeper/pihole';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

describe('Pi-hole auth', () => {
  it('logs in once and reuses the session for subsequent calls', async () => {
    const stub = await startStubPihole({ appPassword: 'pw', queries: [] });
    close = stub.close;
    const a = makePiholeAdapter({ baseUrl: stub.baseUrl, appPassword: 'pw' });
    await a._authedFetch('/queries?length=1');
    await a._authedFetch('/queries?length=1');
    expect(stub.authCount).toBe(1);
  });

  it('re-authenticates once when the session has expired (401) and retries', async () => {
    const stub = await startStubPihole({
      appPassword: 'pw',
      queries: [],
      sessionTtlMs: 1
    });
    close = stub.close;
    const a = makePiholeAdapter({ baseUrl: stub.baseUrl, appPassword: 'pw' });
    await a._authedFetch('/queries?length=1');
    await new Promise((r) => setTimeout(r, 5)); // let the session expire
    const res = await a._authedFetch('/queries?length=1'); // should transparently re-auth
    expect(res.status).toBe(200);
    expect(stub.authCount).toBe(2);
  });

  it('throws a clear error on bad credentials', async () => {
    const stub = await startStubPihole({ appPassword: 'right', queries: [] });
    close = stub.close;
    const a = makePiholeAdapter({
      baseUrl: stub.baseUrl,
      appPassword: 'wrong'
    });
    await expect(a._authedFetch('/queries?length=1')).rejects.toThrow(
      /pi-hole auth failed/i
    );
  });
});

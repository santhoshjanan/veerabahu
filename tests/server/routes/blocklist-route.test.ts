import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db';

let closer: (() => void) | null = null;
afterEach(() => {
  closer?.();
  closer = null;
  vi.resetModules();
});

describe('GET /blocklist.txt route', () => {
  it('returns text/plain with the approved domains', async () => {
    const t = await makeTestDb();
    closer = t.close;
    vi.doMock('$lib/server/db/index', () => ({
      db: t.db,
      schema: t.schema,
      dialect: t.dialect
    }));
    const repo = await import('$lib/server/db/repo');
    const { domainId } = await repo.upsertObservedDomain(t.db, t.schema, {
      domain: 'z.test',
      clientId: 'c',
      at: 1
    });
    await repo.decideDomain(t.db, t.schema, domainId, 'approve', null, 1);

    const { GET } = await import('../../../src/routes/blocklist.txt/+server');
    const res: Response = await GET({
      request: new Request('http://x/blocklist.txt'),
      getClientAddress: () => '10.0.0.5'
    } as any);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toContain('z.test');

    const etag = res.headers.get('etag');
    expect(etag).toBeTruthy();

    const res304: Response = await GET({
      request: new Request('http://x/blocklist.txt', {
        headers: { 'if-none-match': etag! }
      }),
      getClientAddress: () => '10.0.0.5'
    } as any);
    expect(res304.status).toBe(304);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestDb, type TestDb } from '../../helpers/test-db';

let tdb: TestDb;
beforeEach(async () => {
  tdb = await makeTestDb();
  vi.doMock('$lib/server/db/index', () => ({ db: tdb.db, schema: tdb.schema }));
});
afterEach(() => {
  vi.doUnmock('$lib/server/db/index');
  vi.resetModules();
  tdb.close();
});

describe('+layout.server load', () => {
  it('returns badge counts', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.domains).values([
      {
        domain: 'a',
        firstSeen: 1,
        lastSeen: 1,
        hitCount: 1,
        state: 'pending_review'
      },
      {
        domain: 'b',
        firstSeen: 1,
        lastSeen: 1,
        hitCount: 1,
        state: 'pending_review'
      },
      { domain: 'c', firstSeen: 1, lastSeen: 1, hitCount: 1, state: 'approved' }
    ]);
    const { load } = await import('../../../src/routes/+layout.server');
    const depends = vi.fn();
    const res = await (load as any)({
      depends,
      locals: { adminSession: { tokenHash: 'server-only' }, configured: true }
    });
    expect(res).toEqual({
      authenticated: true,
      configured: true,
      badge: { inQueue: 2, published: 1 }
    });
    expect(JSON.stringify(res)).not.toContain('server-only');
    expect(depends).toHaveBeenCalledWith('vb:data');
  });

  it('does not expose operational counts to anonymous public pages', async () => {
    await tdb.db.insert(tdb.schema.domains).values({
      domain: 'private.example',
      firstSeen: 1,
      lastSeen: 1,
      hitCount: 1,
      state: 'pending_review'
    });
    const { load } = await import('../../../src/routes/+layout.server');

    expect(
      await (load as any)({ depends: vi.fn(), locals: { adminSession: null } })
    ).toEqual({
      authenticated: false,
      configured: false,
      badge: { inQueue: 0, published: 0 }
    });
  });

  it('exposes incomplete setup independently of authentication', async () => {
    const { load } = await import('../../../src/routes/+layout.server');

    expect(
      await (load as any)({
        depends: vi.fn(),
        locals: {
          adminSession: { tokenHash: 'server-only' },
          configured: false
        }
      })
    ).toMatchObject({ authenticated: true, configured: false });
  });
});

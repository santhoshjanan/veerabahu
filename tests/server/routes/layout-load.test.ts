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
    const res = await (load as any)({ depends });
    expect(res).toEqual({ badge: { inQueue: 2, published: 1 } });
    expect(depends).toHaveBeenCalledWith('vb:data');
  });
});

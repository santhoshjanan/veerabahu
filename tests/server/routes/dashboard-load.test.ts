import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestDb, type TestDb } from '../../helpers/test-db';

let tdb: TestDb;
beforeEach(async () => {
  tdb = await makeTestDb();
  vi.doMock('$lib/server/db/index', () => ({
    db: tdb.db,
    schema: tdb.schema,
    dialect: tdb.dialect
  }));
});
afterEach(() => {
  vi.doUnmock('$lib/server/db/index');
  vi.resetModules();
  tdb.close();
});

describe('/ dashboard load', () => {
  it('returns the view, queue preview and last pull', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.domains).values([
      {
        domain: 'q1',
        firstSeen: 1,
        lastSeen: 2,
        hitCount: 9,
        state: 'pending_review',
        score: -0.7
      },
      {
        domain: 'q2',
        firstSeen: 1,
        lastSeen: 2,
        hitCount: 3,
        state: 'pending_review',
        score: -0.6
      }
    ]);
    const { load } = await import('../../../src/routes/+page.server');
    const res = await (load as any)({ depends: vi.fn() });
    expect(res.view.counts.pending_review).toBe(2);
    expect(res.queueTop.map((d: any) => d.domain)).toEqual(['q1', 'q2']);
    expect(res.lastPullAt).toBeNull();
  });
});

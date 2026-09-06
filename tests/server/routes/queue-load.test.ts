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

describe('/queue load', () => {
  it('returns a QueueView', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.domains).values({
      domain: 'a',
      firstSeen: 1,
      lastSeen: 1,
      hitCount: 1,
      state: 'observed'
    });
    const { load } = await import('../../../src/routes/queue/+page.server');
    const res = await (load as any)({ depends: vi.fn() });
    expect(res.view.totalBacklog).toBe(1);
    expect(res.view.sources.some((s: any) => s.source === 'metadefender')).toBe(
      true
    );
  });
});

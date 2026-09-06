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

describe('/audit load', () => {
  it('filters by event', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.auditLog).values([
      {
        at: 10,
        actor: 'user',
        domainId: null,
        event: 'decision.approve',
        data: {}
      },
      {
        at: 20,
        actor: 'system',
        domainId: null,
        event: 'domain.transition',
        data: {}
      }
    ]);
    const { load } = await import('../../../src/routes/audit/+page.server');
    const res = await (load as any)({
      url: new URL('http://x/audit?event=decision.approve'),
      depends: vi.fn()
    });
    expect(res.event).toBe('decision.approve');
    expect(res.result.items).toHaveLength(1);
    expect(res.result.items[0].event).toBe('decision.approve');
  });
});

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

const url = (qs: string) => new URL(`http://x/domains${qs}`);

describe('/domains load', () => {
  it('reads filters from the query string and filters the result', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.domains).values([
      {
        domain: 'ads.one.com',
        firstSeen: 1,
        lastSeen: 5,
        hitCount: 1,
        state: 'observed'
      },
      {
        domain: 'ads.two.com',
        firstSeen: 2,
        lastSeen: 6,
        hitCount: 1,
        state: 'pending_review',
        score: -0.3
      },
      {
        domain: 'clean.com',
        firstSeen: 3,
        lastSeen: 7,
        hitCount: 1,
        state: 'observed'
      }
    ]);
    const { load } = await import('../../../src/routes/domains/+page.server');
    const res = await (load as any)({
      url: url('?search=ads&state=observed'),
      depends: vi.fn()
    });
    expect(res.search).toBe('ads');
    expect(res.state).toBe('observed');
    expect(res.result.items.map((i: any) => i.domain)).toEqual(['ads.one.com']);
  });

  it('ignores an unknown state param', async () => {
    const { load } = await import('../../../src/routes/domains/+page.server');
    const res = await (load as any)({
      url: url('?state=bogus'),
      depends: vi.fn()
    });
    expect(res.state).toBe('bogus');
    expect(res.result.items).toEqual([]);
  });
});

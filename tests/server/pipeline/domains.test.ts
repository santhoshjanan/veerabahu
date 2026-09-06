import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '../../helpers/test-db';
import {
  listDomains,
  PAGE_SIZE
} from '../../../src/lib/server/pipeline/domains';

let tdb: TestDb;
beforeEach(async () => (tdb = await makeTestDb()));
afterEach(() => tdb.close());

describe('listDomains', () => {
  it('paginates and reports page math', async () => {
    const { db, schema } = tdb;
    const rows = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => ({
      domain: `d${String(i).padStart(3, '0')}.com`,
      firstSeen: 1000 + i,
      lastSeen: 2000 + i,
      hitCount: i,
      state: 'observed' as const
    }));
    await db.insert(schema.domains).values(rows);

    const p1 = await listDomains(db, schema, {});
    expect(p1.items).toHaveLength(PAGE_SIZE);
    expect(p1.total).toBe(PAGE_SIZE + 5);
    expect(p1.pageCount).toBe(2);
    expect(p1.page).toBe(1);

    const p2 = await listDomains(db, schema, { page: 2 });
    expect(p2.items).toHaveLength(5);
    expect(p2.page).toBe(2);
  });

  it('filters by search and state', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.domains).values([
      {
        domain: 'tracker.ads.net',
        firstSeen: 1,
        lastSeen: 9,
        hitCount: 1,
        state: 'pending_review',
        score: -0.5
      },
      {
        domain: 'safe.example',
        firstSeen: 2,
        lastSeen: 8,
        hitCount: 1,
        state: 'observed'
      }
    ]);
    const s = await listDomains(db, schema, { search: 'ADS' });
    expect(s.items.map((i) => i.domain)).toEqual(['tracker.ads.net']);
    const st = await listDomains(db, schema, { state: 'observed' });
    expect(st.items.map((i) => i.domain)).toEqual(['safe.example']);
  });
});

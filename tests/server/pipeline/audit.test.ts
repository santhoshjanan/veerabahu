import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '../../helpers/test-db';
import { listAudit } from '../../../src/lib/server/pipeline/audit';

let tdb: TestDb;
beforeEach(async () => (tdb = await makeTestDb()));
afterEach(() => tdb.close());

describe('listAudit', () => {
  it('returns newest-first with the domain name joined and filters by event', async () => {
    const { db, schema } = tdb;
    const [d] = await db
      .insert(schema.domains)
      .values({ domain: 'x.ads.io', firstSeen: 1, lastSeen: 1, hitCount: 1, state: 'approved' })
      .returning();
    await db.insert(schema.auditLog).values([
      { at: 100, actor: 'system', domainId: d.id, event: 'domain.transition', data: { to: 'pending_review' } },
      { at: 200, actor: 'user', domainId: d.id, event: 'decision.approve', data: { note: 'bad' } },
      { at: 150, actor: 'metadefender', domainId: null, event: 'assess.error', data: { msg: 'timeout' } }
    ]);

    const all = await listAudit(db, schema, {});
    expect(all.items.map((e) => e.at)).toEqual([200, 150, 100]);
    expect(all.items[0].domain).toBe('x.ads.io');
    expect(all.items[1].domain).toBeNull();
    expect(all.total).toBe(3);

    const decisions = await listAudit(db, schema, { event: 'decision.approve' });
    expect(decisions.items).toHaveLength(1);
    expect(decisions.items[0].data).toEqual({ note: 'bad' });
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '../../helpers/test-db';
import * as repo from '../../../src/lib/server/db/repo';

let tdb: TestDb;
beforeEach(async () => (tdb = await makeTestDb()));
afterEach(() => tdb.close());

async function seed() {
  const { db, schema } = tdb;
  const [d1] = await db
    .insert(schema.domains)
    .values({
      domain: 'a.ads.com',
      firstSeen: 1000,
      lastSeen: 5000,
      hitCount: 9,
      state: 'pending_review',
      score: -0.7
    })
    .returning();
  const [d2] = await db
    .insert(schema.domains)
    .values({
      domain: 'b.cdn.com',
      firstSeen: 2000,
      lastSeen: 6000,
      hitCount: 2,
      state: 'observed'
    })
    .returning();
  await db.insert(schema.domains).values({
    domain: 'c.good.com',
    firstSeen: 3000,
    lastSeen: 7000,
    hitCount: 1,
    state: 'approved',
    decidedAt: 8000
  });
  await db.insert(schema.verdicts).values({
    domainId: d1.id,
    source: 'metadefender',
    verdict: 'block',
    confidence: 0.9,
    category: 'malware',
    detail: null,
    raw: {},
    assessedAt: 4000,
    costUsd: null
  });
  await db.insert(schema.verdicts).values({
    domainId: d1.id,
    source: 'ai',
    verdict: 'block',
    confidence: 0.7,
    category: null,
    detail: 'looks bad',
    raw: {},
    assessedAt: 4500,
    costUsd: 0.002
  });
  await db.insert(schema.auditLog).values({
    at: 4000,
    actor: 'system',
    domainId: d1.id,
    event: 'domain.transition',
    data: { to: 'pending_review' }
  });
  await db.insert(schema.auditLog).values({
    at: 9000,
    actor: 'user',
    domainId: null,
    event: 'decision.approve',
    data: {}
  });
  await db
    .insert(schema.blocklistFetchLog)
    .values({ at: 5000, ip: '10.0.0.2', userAgent: 'pihole', status: 200 });
  return { d1, d2 };
}

describe('repo read queries', () => {
  it('counts domains by state with zero-fill', async () => {
    await seed();
    const c = await repo.countDomainsByState(tdb.db, tdb.schema);
    expect(c.pending_review).toBe(1);
    expect(c.observed).toBe(1);
    expect(c.approved).toBe(1);
    expect(c.rejected).toBe(0);
  });

  it('counts published and recent windows', async () => {
    await seed();
    expect(await repo.countPublished(tdb.db, tdb.schema)).toBe(1);
    expect(
      await repo.countDomainsSince(tdb.db, tdb.schema, 'firstSeen', 2500)
    ).toBe(1);
    expect(await repo.countVerdictsSince(tdb.db, tdb.schema, 4200)).toBe(1);
    expect(await repo.sumVerdictCostSince(tdb.db, tdb.schema, 0)).toBeCloseTo(
      0.002
    );
    expect(await repo.sumVerdictCostSince(tdb.db, tdb.schema, 999999)).toBe(0);
  });

  it('computes per-source backlog', async () => {
    await seed();
    // d2 (observed) has no verdicts; d1 has metadefender+ai but is pending_review (not in backlog states)
    expect(
      await repo.countBacklogForSource(tdb.db, tdb.schema, 'metadefender')
    ).toBe(1);
    expect(
      await repo.countBacklogForSource(tdb.db, tdb.schema, 'curated_list')
    ).toBe(1);
  });

  it('searches and paginates domains', async () => {
    await seed();
    const hits = await repo.searchDomains(tdb.db, tdb.schema, {
      search: 'ADS',
      limit: 10,
      offset: 0
    });
    expect(hits.map((h) => h.domain)).toEqual(['a.ads.com']);
    expect(hits[0].verdictCount).toBe(2);
    expect(
      await repo.countDomainsMatching(tdb.db, tdb.schema, { state: 'observed' })
    ).toBe(1);
  });

  it('lists audit rows with domain name and filters', async () => {
    await seed();
    const all = await repo.listAuditRows(tdb.db, tdb.schema, {
      limit: 10,
      offset: 0
    });
    expect(all[0].event).toBe('decision.approve');
    expect(all[0].domain).toBeNull();
    expect(all[1].domain).toBe('a.ads.com');
    const byActor = await repo.listAuditRows(tdb.db, tdb.schema, {
      actor: 'user',
      limit: 10,
      offset: 0
    });
    expect(byActor).toHaveLength(1);
    expect(
      await repo.countAuditRows(tdb.db, tdb.schema, {
        event: 'domain.transition'
      })
    ).toBe(1);
  });

  it('reads and clears an allowlist row', async () => {
    const { db, schema } = tdb;
    await repo.addAllowlist(db, schema, 'keep.com', 'rejected by user', 1);
    expect((await repo.getAllowlistRow(db, schema, 'keep.com'))?.reason).toBe(
      'rejected by user'
    );
    await repo.removeAllowlist(db, schema, 'keep.com');
    expect(await repo.getAllowlistRow(db, schema, 'keep.com')).toBeUndefined();
  });
});

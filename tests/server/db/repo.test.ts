import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db';
import * as repo from '$lib/server/db/repo';

let closer: (() => void) | null = null;
afterEach(() => {
  closer?.();
  closer = null;
});

describe('repo.upsertObservedDomain', () => {
  it('creates on first sight and increments hit_count + last_seen on repeats', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const a = await repo.upsertObservedDomain(t.db, t.schema, {
      domain: 'x.com',
      clientId: 'c1',
      at: 100
    });
    expect(a.created).toBe(true);
    const b = await repo.upsertObservedDomain(t.db, t.schema, {
      domain: 'x.com',
      clientId: 'c1',
      at: 200
    });
    expect(b.created).toBe(false);
    await repo.upsertObservedDomain(t.db, t.schema, {
      domain: 'x.com',
      clientId: 'c2',
      at: 300
    });
    const row = await repo.getDomainByName(t.db, t.schema, 'x.com');
    expect(row!.hitCount).toBe(3);
    expect(row!.lastSeen).toBe(300);
    expect(row!.firstSeen).toBe(100);
  });

  it('never lets last_seen go backwards', async () => {
    const t = await makeTestDb();
    closer = t.close;
    await repo.upsertObservedDomain(t.db, t.schema, {
      domain: 'x.com',
      clientId: 'c1',
      at: 500
    });
    await repo.upsertObservedDomain(t.db, t.schema, {
      domain: 'x.com',
      clientId: 'c1',
      at: 100
    });
    const row = await repo.getDomainByName(t.db, t.schema, 'x.com');
    expect(row!.lastSeen).toBe(500);
    expect(row!.hitCount).toBe(2);
  });
});

describe('repo.upsertVerdict', () => {
  it('replaces the row for the same (domain, source)', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const { domainId } = await repo.upsertObservedDomain(t.db, t.schema, {
      domain: 'x.com',
      clientId: 'c',
      at: 1
    });
    await repo.upsertVerdict(t.db, t.schema, {
      domainId,
      source: 'ai',
      verdict: 'unsure',
      confidence: 0.3,
      raw: {},
      assessedAt: 1
    });
    await repo.upsertVerdict(t.db, t.schema, {
      domainId,
      source: 'ai',
      verdict: 'block',
      confidence: 0.9,
      raw: {},
      assessedAt: 2,
      category: 'ad'
    });
    const vs = await repo.listVerdictsForDomain(t.db, t.schema, domainId);
    expect(vs).toHaveLength(1);
    expect(vs[0]).toMatchObject({
      verdict: 'block',
      confidence: 0.9,
      category: 'ad'
    });
  });
});

describe('repo.listQueuedDomains', () => {
  it('returns observed/assessing domains the source has not assessed, ranked by hit_count', async () => {
    const t = await makeTestDb();
    closer = t.close;
    // low priority: 1 hit
    await repo.upsertObservedDomain(t.db, t.schema, {
      domain: 'low.com',
      clientId: 'c1',
      at: 1
    });
    // high priority: 3 hits
    for (const c of ['c1', 'c2', 'c3'])
      await repo.upsertObservedDomain(t.db, t.schema, {
        domain: 'high.com',
        clientId: c,
        at: 1
      });
    const q = await repo.listQueuedDomains(t.db, t.schema, 'ai', 10);
    expect(q.map((d) => d.domain)).toEqual(['high.com', 'low.com']);

    // once 'ai' has a verdict for high.com, it drops out of the 'ai' queue
    const high = await repo.getDomainByName(t.db, t.schema, 'high.com');
    await repo.upsertVerdict(t.db, t.schema, {
      domainId: high!.id,
      source: 'ai',
      verdict: 'allow',
      confidence: 1,
      raw: {},
      assessedAt: 1
    });
    const q2 = await repo.listQueuedDomains(t.db, t.schema, 'ai', 10);
    expect(q2.map((d) => d.domain)).toEqual(['low.com']);
  });

  it('excludes domains past pending_review/decided states', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const { domainId } = await repo.upsertObservedDomain(t.db, t.schema, {
      domain: 'x.com',
      clientId: 'c',
      at: 1
    });
    await repo.setDomainScoreAndState(
      t.db,
      t.schema,
      domainId,
      0.9,
      'auto_cleared'
    );
    expect(await repo.listQueuedDomains(t.db, t.schema, 'ai', 10)).toHaveLength(
      0
    );
  });
});

describe('repo.decideDomain', () => {
  it('approve sets state approved + decidedAt + note', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const { domainId } = await repo.upsertObservedDomain(t.db, t.schema, {
      domain: 'x.com',
      clientId: 'c',
      at: 1
    });
    await repo.setDomainScoreAndState(
      t.db,
      t.schema,
      domainId,
      -0.7,
      'pending_review'
    );
    await repo.decideDomain(
      t.db,
      t.schema,
      domainId,
      'approve',
      'looks like a tracker',
      999
    );
    const row = await repo.getDomainById(t.db, t.schema, domainId);
    expect(row).toMatchObject({
      state: 'approved',
      decidedAt: 999,
      decisionNote: 'looks like a tracker'
    });
    expect(await repo.listApprovedDomains(t.db, t.schema)).toEqual(['x.com']);
  });

  it('reject sets state rejected', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const { domainId } = await repo.upsertObservedDomain(t.db, t.schema, {
      domain: 'x.com',
      clientId: 'c',
      at: 1
    });
    await repo.decideDomain(t.db, t.schema, domainId, 'reject', null, 5);
    const row = await repo.getDomainById(t.db, t.schema, domainId);
    expect(row).toMatchObject({
      state: 'rejected',
      decidedAt: 5,
      decisionNote: null
    });
    expect(await repo.listApprovedDomains(t.db, t.schema)).toEqual([]);
  });
});

describe('repo.allowlist + ingestState', () => {
  it('round-trips the allowlist', async () => {
    const t = await makeTestDb();
    closer = t.close;
    expect(await repo.isAllowlisted(t.db, t.schema, 'x.com')).toBe(false);
    await repo.addAllowlist(t.db, t.schema, 'x.com', 'rejected by user', 1);
    expect(await repo.isAllowlisted(t.db, t.schema, 'x.com')).toBe(true);
    // idempotent
    await repo.addAllowlist(t.db, t.schema, 'x.com', 'again', 2);
    expect(await repo.isAllowlisted(t.db, t.schema, 'x.com')).toBe(true);
  });

  it('creates the id=1 ingest_state row on first read and patches it', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const s = await repo.getIngestState(t.db, t.schema);
    expect(s).toMatchObject({ id: 1, cursor: null, firstRunDone: false });
    await repo.setIngestState(t.db, t.schema, {
      cursor: 'abc',
      firstRunDone: true,
      lastIngestAt: 5
    });
    const s2 = await repo.getIngestState(t.db, t.schema);
    expect(s2).toMatchObject({
      cursor: 'abc',
      firstRunDone: true,
      lastIngestAt: 5
    });
  });

  it('setIngestState works even if the row does not exist yet', async () => {
    const t = await makeTestDb();
    closer = t.close;
    await repo.setIngestState(t.db, t.schema, { cursor: 'first' });
    expect((await repo.getIngestState(t.db, t.schema)).cursor).toBe('first');
  });
});

describe('repo.logBlocklistFetch', () => {
  it('appends a fetch-log row', async () => {
    const t = await makeTestDb();
    closer = t.close;
    await repo.logBlocklistFetch(t.db, t.schema, {
      at: 10,
      ip: '10.0.0.1',
      userAgent: null,
      status: 200
    });
    const [row] = await t.db.select().from(t.schema.blocklistFetchLog);
    expect(row).toMatchObject({
      at: 10,
      ip: '10.0.0.1',
      userAgent: null,
      status: 200
    });
  });
});

describe('repo.listPendingReview', () => {
  it('returns pending_review domains ranked by hit_count then first_seen, with limit/offset', async () => {
    const t = await makeTestDb();
    closer = t.close;
    for (const [d, hits, at] of [
      ['a.com', 1, 10],
      ['b.com', 3, 20],
      ['c.com', 3, 5]
    ] as const) {
      for (let i = 0; i < hits; i++)
        await repo.upsertObservedDomain(t.db, t.schema, {
          domain: d,
          clientId: 'c',
          at
        });
      const row = await repo.getDomainByName(t.db, t.schema, d);
      await repo.setDomainScoreAndState(
        t.db,
        t.schema,
        row!.id,
        null,
        'pending_review'
      );
    }
    const page = await repo.listPendingReview(t.db, t.schema, 10, 0);
    expect(page.map((d) => d.domain)).toEqual(['c.com', 'b.com', 'a.com']);
    const paged = await repo.listPendingReview(t.db, t.schema, 1, 1);
    expect(paged.map((d) => d.domain)).toEqual(['b.com']);
  });
});

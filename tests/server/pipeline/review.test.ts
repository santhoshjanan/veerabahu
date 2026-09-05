import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db';
import * as repo from '$lib/server/db/repo';
import {
  listReview,
  getReviewDetail,
  decide
} from '$lib/server/pipeline/review';

let closer: (() => void) | null = null;
afterEach(() => {
  closer?.();
  closer = null;
});

async function seedPending(t: any, domain: string, clients: string[]) {
  let id = 0;
  for (const c of clients) {
    id = (
      await repo.upsertObservedDomain(t.db, t.schema, {
        domain,
        clientId: c,
        at: 1
      })
    ).domainId;
  }
  await repo.upsertVerdict(t.db, t.schema, {
    domainId: id,
    source: 'curated_list',
    verdict: 'block',
    confidence: 1,
    raw: {},
    assessedAt: 1
  });
  await repo.setDomainScoreAndState(t.db, t.schema, id, -1, 'pending_review');
  return id;
}

describe('review', () => {
  it('lists pending domains ranked by hits + 2*clients with a verdict summary', async () => {
    const t = await makeTestDb();
    closer = t.close;
    await seedPending(t, 'low.test', ['c1']);
    await seedPending(t, 'high.test', ['c1', 'c2', 'c3']);
    const rows = await listReview(t.db, t.schema, 10, 0);
    expect(rows.map((r) => r.domain)).toEqual(['high.test', 'low.test']);
    expect(rows[0].verdicts[0]).toMatchObject({
      source: 'curated_list',
      verdict: 'block'
    });
  });

  it('detail includes full verdicts and the domain audit trail', async () => {
    const t = await makeTestDb();
    closer = t.close;
    await seedPending(t, 'x.test', ['c1']);
    const d = await getReviewDetail(t.db, t.schema, 'x.test');
    expect(d).not.toBeNull();
    expect(d!.verdictsFull).toHaveLength(1);
    expect(d!.state).toBe('pending_review');
    expect(d!.verdicts).toHaveLength(1);
    expect(d!.verdicts[0]).toMatchObject({
      source: 'curated_list',
      verdict: 'block'
    });
  });

  it('detail returns null for unknown domain', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const d = await getReviewDetail(t.db, t.schema, 'nonexistent.test');
    expect(d).toBeNull();
  });

  it('approve moves to approved + audits; reject allowlists + audits', async () => {
    const t = await makeTestDb();
    closer = t.close;
    await seedPending(t, 'a.test', ['c1']);
    await seedPending(t, 'b.test', ['c1']);

    expect(
      await decide(t.db, t.schema, 'a.test', 'approve', 'tracker')
    ).toEqual({ ok: true });
    expect((await repo.getDomainByName(t.db, t.schema, 'a.test'))!.state).toBe(
      'approved'
    );

    expect(await decide(t.db, t.schema, 'b.test', 'reject', null)).toEqual({
      ok: true
    });
    expect(await repo.isAllowlisted(t.db, t.schema, 'b.test')).toBe(true);

    const audit = await t.db.select().from(t.schema.auditLog);
    expect(
      audit.filter((r: any) => r.event.startsWith('decision.')).length
    ).toBe(2);
  });

  it('rejects a decision on a non-pending domain with 409', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const id = (
      await repo.upsertObservedDomain(t.db, t.schema, {
        domain: 'c.test',
        clientId: 'x',
        at: 1
      })
    ).domainId;
    await repo.setDomainScoreAndState(t.db, t.schema, id, 0.9, 'auto_cleared');
    expect(
      await decide(t.db, t.schema, 'c.test', 'approve', null)
    ).toMatchObject({
      ok: false,
      code: 409
    });
  });

  it('404 for an unknown domain', async () => {
    const t = await makeTestDb();
    closer = t.close;
    expect(
      await decide(t.db, t.schema, 'nope.test', 'approve', null)
    ).toMatchObject({
      ok: false,
      code: 404
    });
  });
});

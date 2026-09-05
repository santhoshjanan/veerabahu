import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db';

let closer: (() => void) | null = null;
afterEach(() => {
  closer?.();
  closer = null;
  vi.resetModules();
});

async function withDb() {
  const t = await makeTestDb();
  closer = t.close;
  vi.doMock('$lib/server/db/index', () => ({
    db: t.db,
    schema: t.schema,
    dialect: t.dialect
  }));
  return t;
}

describe('review API routes', () => {
  it('GET /api/review returns pending items; POST decides; POST again is 409', async () => {
    const t = await withDb();
    const repo = await import('$lib/server/db/repo');
    const id = (
      await repo.upsertObservedDomain(t.db, t.schema, {
        domain: 'q.test',
        clientId: 'c',
        at: 1
      })
    ).domainId;
    await repo.upsertVerdict(t.db, t.schema, {
      domainId: id,
      source: 'curated_list',
      verdict: 'block',
      confidence: 1,
      raw: {},
      assessedAt: 1
    });
    await repo.setDomainScoreAndState(t.db, t.schema, id, -1, 'pending_review');

    const list = await import('../../../src/routes/api/review/+server');
    const listRes: Response = await list.GET({
      url: new URL('http://x/api/review')
    } as any);
    expect(await listRes.json()).toHaveLength(1);

    const one = await import('../../../src/routes/api/review/[domain]/+server');
    const okRes: Response = await one.POST({
      params: { domain: 'q.test' },
      request: new Request('http://x', {
        method: 'POST',
        body: JSON.stringify({ decision: 'approve' })
      })
    } as any);
    expect(await okRes.json()).toEqual({ ok: true });

    await expect(
      one.POST({
        params: { domain: 'q.test' },
        request: new Request('http://x', {
          method: 'POST',
          body: JSON.stringify({ decision: 'approve' })
        })
      } as any)
    ).rejects.toMatchObject({ status: 409 });
  });

  it('GET /api/review respects limit and offset query parameters', async () => {
    const t = await withDb();
    const repo = await import('$lib/server/db/repo');

    for (let i = 1; i <= 3; i++) {
      const { domainId } = await repo.upsertObservedDomain(t.db, t.schema, {
        domain: `d${i}.test`,
        clientId: 'c',
        at: i
      });
      await repo.setDomainScoreAndState(
        t.db,
        t.schema,
        domainId,
        -1,
        'pending_review'
      );
    }

    const list = await import('../../../src/routes/api/review/+server');
    const res1: Response = await list.GET({
      url: new URL('http://x/api/review?limit=2&offset=0')
    } as any);
    const body1 = (await res1.json()) as any[];
    expect(body1).toHaveLength(2);

    const res2: Response = await list.GET({
      url: new URL('http://x/api/review?limit=2&offset=2')
    } as any);
    const body2 = (await res2.json()) as any[];
    expect(body2).toHaveLength(1);
  });

  it('GET /api/review/:domain returns full detail or 404', async () => {
    const t = await withDb();
    const repo = await import('$lib/server/db/repo');
    const { domainId } = await repo.upsertObservedDomain(t.db, t.schema, {
      domain: 'detail.test',
      clientId: 'c1',
      at: 100
    });
    await repo.upsertVerdict(t.db, t.schema, {
      domainId,
      source: 'curated_list',
      verdict: 'block',
      confidence: 0.95,
      raw: { match: true },
      assessedAt: 101
    });
    await repo.setDomainScoreAndState(
      t.db,
      t.schema,
      domainId,
      -0.9,
      'pending_review'
    );

    const one = await import('../../../src/routes/api/review/[domain]/+server');
    const res: Response = await one.GET({
      params: { domain: 'detail.test' }
    } as any);
    const detail = (await res.json()) as any;
    expect(detail.domain).toBe('detail.test');
    expect(detail.state).toBe('pending_review');
    expect(detail.verdictsFull).toHaveLength(1);

    await expect(
      one.GET({ params: { domain: 'notfound.test' } } as any)
    ).rejects.toMatchObject({
      status: 404
    });
  });

  it('POST /api/review/:domain validates body and handles reject decision', async () => {
    const t = await withDb();
    const repo = await import('$lib/server/db/repo');
    const { domainId } = await repo.upsertObservedDomain(t.db, t.schema, {
      domain: 'reject-me.test',
      clientId: 'c1',
      at: 100
    });
    await repo.setDomainScoreAndState(
      t.db,
      t.schema,
      domainId,
      -1,
      'pending_review'
    );

    const one = await import('../../../src/routes/api/review/[domain]/+server');

    // Invalid body
    await expect(
      one.POST({
        params: { domain: 'reject-me.test' },
        request: new Request('http://x', {
          method: 'POST',
          body: JSON.stringify({ decision: 'unknown' })
        })
      } as any)
    ).rejects.toMatchObject({ status: 400 });

    // Non-JSON body
    await expect(
      one.POST({
        params: { domain: 'reject-me.test' },
        request: new Request('http://x', {
          method: 'POST',
          body: 'not-json'
        })
      } as any)
    ).rejects.toMatchObject({ status: 400 });

    // Valid reject
    const okRes: Response = await one.POST({
      params: { domain: 'reject-me.test' },
      request: new Request('http://x', {
        method: 'POST',
        body: JSON.stringify({ decision: 'reject', note: 'false positive' })
      })
    } as any);
    expect(await okRes.json()).toEqual({ ok: true });

    // Domain is now allowlisted and state is rejected
    expect(await repo.isAllowlisted(t.db, t.schema, 'reject-me.test')).toBe(
      true
    );
    const row = await repo.getDomainByName(t.db, t.schema, 'reject-me.test');
    expect(row!.state).toBe('rejected');
  });
});

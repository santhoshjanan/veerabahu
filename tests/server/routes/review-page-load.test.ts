import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db';

let closer: (() => void) | null = null;
afterEach(() => {
  closer?.();
  closer = null;
  vi.resetModules();
});

describe('review page load', () => {
  it('returns the pending items', async () => {
    const t = await makeTestDb();
    closer = t.close;
    vi.doMock('$lib/server/db/index', () => ({
      db: t.db,
      schema: t.schema,
      dialect: t.dialect
    }));
    const repo = await import('$lib/server/db/repo');
    const id = (
      await repo.upsertObservedDomain(t.db, t.schema, {
        domain: 'p.test',
        clientId: 'c',
        at: 1
      })
    ).domainId;
    await repo.setDomainScoreAndState(
      t.db,
      t.schema,
      id,
      -0.7,
      'pending_review'
    );

    const { load } = await import('../../../src/routes/review/+page.server');
    const data = await (load as any)({});
    expect(data.items.map((i: any) => i.domain)).toEqual(['p.test']);
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db';
import * as repo from '$lib/server/db/repo';
import { evaluateDomain } from '$lib/server/pipeline/evaluate';
import { loadConfig } from '$lib/server/config';

let closer: (() => void) | null = null;
afterEach(() => {
  closer?.();
  closer = null;
});

const cfg = loadConfig({
  VB_PIHOLE_BASE_URL: 'http://x',
  VB_PIHOLE_APP_PASSWORD: 'p',
  VB_MAX_REVIEW_WAIT_HOURS: '9999'
});

describe('evaluateDomain', () => {
  it('scores with the runtime source weights', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const { domainId } = await repo.upsertObservedDomain(t.db, t.schema, {
      domain: 'weighted.test',
      clientId: 'c',
      at: 1
    });
    await repo.upsertVerdict(t.db, t.schema, {
      domainId,
      source: 'curated_list',
      verdict: 'block',
      confidence: 1,
      raw: {},
      assessedAt: 1
    });
    await repo.upsertVerdict(t.db, t.schema, {
      domainId,
      source: 'ai',
      verdict: 'allow',
      confidence: 1,
      raw: {},
      assessedAt: 1
    });
    const weighted = {
      ...cfg,
      weights: { ...cfg.weights, curated_list: 1, ai: 3 }
    };

    const result = await evaluateDomain(
      t.db,
      t.schema,
      domainId,
      ['curated_list', 'ai'],
      weighted
    );

    expect(result.score).toBe(0.5);
  });

  it('writes score + state and an audit row when they change', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const { domainId } = await repo.upsertObservedDomain(t.db, t.schema, {
      domain: 'x.com',
      clientId: 'c',
      at: 1
    });
    await repo.upsertVerdict(t.db, t.schema, {
      domainId,
      source: 'curated_list',
      verdict: 'block',
      confidence: 1,
      raw: {},
      assessedAt: 1
    });

    const r = await evaluateDomain(
      t.db,
      t.schema,
      domainId,
      ['curated_list'],
      cfg
    );
    expect(r).toEqual({ score: -1, state: 'pending_review' });

    const row = await repo.getDomainById(t.db, t.schema, domainId);
    expect(row).toMatchObject({ score: -1, state: 'pending_review' });
    const audit = await t.db.select().from(t.schema.auditLog);
    expect(audit.some((a: any) => a.event === 'domain.transition')).toBe(true);
  });

  it('is a no-op the second time (no duplicate audit rows)', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const { domainId } = await repo.upsertObservedDomain(t.db, t.schema, {
      domain: 'x.com',
      clientId: 'c',
      at: 1
    });
    await repo.upsertVerdict(t.db, t.schema, {
      domainId,
      source: 'curated_list',
      verdict: 'block',
      confidence: 1,
      raw: {},
      assessedAt: 1
    });
    await evaluateDomain(t.db, t.schema, domainId, ['curated_list'], cfg);
    await evaluateDomain(t.db, t.schema, domainId, ['curated_list'], cfg);
    const audit = await t.db.select().from(t.schema.auditLog);
    expect(
      audit.filter((a: any) => a.event === 'domain.transition')
    ).toHaveLength(1);
  });
});

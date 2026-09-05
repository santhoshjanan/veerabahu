import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db';
import { fakeSource } from '../../helpers/fake-source';
import { makeDrainer } from '$lib/server/governor/drainer';
import * as repo from '$lib/server/db/repo';
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
const noEnrich = async () => ({ dns: null });

describe('drainer.tick', () => {
  it('assesses the top queued domain, writes a verdict, and scores it', async () => {
    const t = await makeTestDb();
    closer = t.close;
    for (const c of ['c1', 'c2'])
      await repo.upsertObservedDomain(t.db, t.schema, { domain: 'bad.test', clientId: c, at: 1 });
    await repo.upsertObservedDomain(t.db, t.schema, { domain: 'low.test', clientId: 'c1', at: 1 });

    const md = fakeSource({
      name: 'metadefender',
      limits: { perMinute: null, perDay: 4000 },
      reply: { verdict: 'block', confidence: 0.8, category: 'ad' }
    });

    const d = makeDrainer({
      db: t.db,
      schema: t.schema,
      cfg,
      pacedSources: [md],
      eligibleSourceNames: ['metadefender'],
      enrich: noEnrich,
      curatedHits: () => []
    });
    const r = await d.tick(1_000_000);
    expect(r.calls).toBe(1);
    expect(md.calls).toEqual(['bad.test']); // higher priority first

    const dom = await repo.getDomainByName(t.db, t.schema, 'bad.test');
    const vs = await repo.listVerdictsForDomain(t.db, t.schema, dom!.id);
    expect(vs[0]).toMatchObject({ source: 'metadefender', verdict: 'block', confidence: 0.8 });
  });

  it('records an error verdict when the source throws, and still consumes quota', async () => {
    const t = await makeTestDb();
    closer = t.close;
    await repo.upsertObservedDomain(t.db, t.schema, { domain: 'x.test', clientId: 'c', at: 1 });
    const md = fakeSource({
      name: 'metadefender',
      limits: { perMinute: null, perDay: 2 },
      throwErr: 'boom'
    });
    const d = makeDrainer({
      db: t.db,
      schema: t.schema,
      cfg,
      pacedSources: [md],
      eligibleSourceNames: ['metadefender'],
      enrich: noEnrich,
      curatedHits: () => []
    });
    await d.tick(1_000_000);
    const dom = await repo.getDomainByName(t.db, t.schema, 'x.test');
    const vs = await repo.listVerdictsForDomain(t.db, t.schema, dom!.id);
    expect(vs[0]).toMatchObject({ source: 'metadefender', verdict: 'error' });
    const [rate] = await t.db.select().from(t.schema.sourceRateState);
    expect(rate.dayCount).toBe(1);
  });

  it('never exceeds perDay across many ticks', async () => {
    const t = await makeTestDb();
    closer = t.close;
    for (let i = 0; i < 10; i++)
      await repo.upsertObservedDomain(t.db, t.schema, { domain: `d${i}.test`, clientId: 'c', at: 1 });
    const md = fakeSource({ name: 'metadefender', limits: { perMinute: null, perDay: 3 } });
    const d = makeDrainer({
      db: t.db,
      schema: t.schema,
      cfg,
      pacedSources: [md],
      eligibleSourceNames: ['metadefender'],
      enrich: noEnrich,
      curatedHits: () => []
    });
    let day = Date.UTC(2026, 5, 1, 0);
    for (let i = 0; i < 20; i++) {
      await d.tick(day);
      day += 3_600_000;
    } // 20 hourly ticks, same UTC day
    expect(md.calls.length).toBe(3);
  });
});

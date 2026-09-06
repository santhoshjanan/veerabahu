import { describe, it, expect, afterEach, vi } from 'vitest';
import { makeTestDb } from '../../helpers/test-db';
import { fakeSource } from '../../helpers/fake-source';
import { makeDrainer } from '$lib/server/governor/drainer';
import * as repo from '$lib/server/db/repo';
import { loadConfig } from '$lib/server/config';
import {
  subscribe,
  _resetForTest,
  type VbEvent
} from '../../../src/lib/server/events';

let closer: (() => void) | null = null;
afterEach(() => {
  closer?.();
  closer = null;
  _resetForTest();
});

const cfg = loadConfig({
  VB_PIHOLE_BASE_URL: 'http://x',
  VB_PIHOLE_APP_PASSWORD: 'p',
  VB_MAX_REVIEW_WAIT_HOURS: '9999'
});
const noEnrich = async () => ({ dns: null });

describe('drainer.tick', () => {
  it('waits for an active source assessment before shutdown completes', async () => {
    const t = await makeTestDb();
    closer = t.close;
    await repo.upsertObservedDomain(t.db, t.schema, {
      domain: 'pending.test',
      clientId: 'c',
      at: 1
    });
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const source = fakeSource({
      name: 'ai',
      limits: { perMinute: null, perDay: null }
    });
    const assess = source.assess;
    source.assess = async (input) => {
      entered();
      await pending;
      return assess(input);
    };
    const drainer = makeDrainer({
      db: t.db,
      schema: t.schema,
      cfg,
      pacedSources: [source],
      eligibleSourceNames: ['ai'],
      enrich: noEnrich,
      curatedHits: () => []
    });
    vi.useFakeTimers();
    try {
      drainer.start();
      await vi.advanceTimersByTimeAsync(5000);
      await started;
      let stopped = false;
      const stop = drainer.stop().then(() => {
        stopped = true;
      });
      await Promise.resolve();
      expect(stopped).toBe(false);
      release();
      await stop;
      const domain = await repo.getDomainByName(t.db, t.schema, 'pending.test');
      expect(
        await repo.listVerdictsForDomain(t.db, t.schema, domain!.id)
      ).toHaveLength(1);
    } finally {
      release();
      await drainer.stop();
      vi.useRealTimers();
    }
  });
  it('assesses the top queued domain, writes a verdict, and scores it', async () => {
    const t = await makeTestDb();
    closer = t.close;
    for (const c of ['c1', 'c2'])
      await repo.upsertObservedDomain(t.db, t.schema, {
        domain: 'bad.test',
        clientId: c,
        at: 1
      });
    await repo.upsertObservedDomain(t.db, t.schema, {
      domain: 'low.test',
      clientId: 'c1',
      at: 1
    });

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
    const evts: VbEvent[] = [];
    const off = subscribe((e) => evts.push(e));
    const r = await d.tick(1_000_000);
    expect(r.calls).toBe(1);
    expect(md.calls).toEqual(['bad.test']); // higher priority first

    const dom = await repo.getDomainByName(t.db, t.schema, 'bad.test');
    const vs = await repo.listVerdictsForDomain(t.db, t.schema, dom!.id);
    expect(vs[0]).toMatchObject({
      source: 'metadefender',
      verdict: 'block',
      confidence: 0.8
    });

    off();
    expect(evts.map((e) => e.type)).toEqual(
      expect.arrayContaining(['assess.start', 'verdict', 'assess.done'])
    );
  });

  it('records an error verdict when the source throws, and still consumes quota', async () => {
    const t = await makeTestDb();
    closer = t.close;
    await repo.upsertObservedDomain(t.db, t.schema, {
      domain: 'x.test',
      clientId: 'c',
      at: 1
    });
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
      await repo.upsertObservedDomain(t.db, t.schema, {
        domain: `d${i}.test`,
        clientId: 'c',
        at: 1
      });
    const md = fakeSource({
      name: 'metadefender',
      limits: { perMinute: null, perDay: 3 }
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
    let day = Date.UTC(2026, 5, 1, 0);
    for (let i = 0; i < 20; i++) {
      await d.tick(day);
      day += 3_600_000;
    } // 20 hourly ticks, same UTC day
    expect(md.calls.length).toBe(3);
  });

  it('does not call a source after its daily cost ceiling is reached', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const nowMs = Date.UTC(2026, 5, 1, 12);
    const prior = await repo.upsertObservedDomain(t.db, t.schema, {
      domain: 'prior.test',
      clientId: 'c',
      at: nowMs - 2_000
    });
    await repo.upsertVerdict(t.db, t.schema, {
      domainId: prior.domainId,
      source: 'ai',
      verdict: 'allow',
      confidence: 1,
      raw: {},
      assessedAt: nowMs - 1_000,
      costUsd: 1
    });
    await repo.upsertObservedDomain(t.db, t.schema, {
      domain: 'next.test',
      clientId: 'c',
      at: nowMs
    });
    const ai = fakeSource({
      name: 'ai',
      limits: {
        perMinute: null,
        perDay: null,
        dailyCostCeiling: 1
      }
    });
    const d = makeDrainer({
      db: t.db,
      schema: t.schema,
      cfg,
      pacedSources: [ai],
      eligibleSourceNames: ['ai'],
      enrich: noEnrich,
      curatedHits: () => []
    });

    expect(await d.tick(nowMs)).toEqual({ calls: 0 });
    expect(ai.calls).toHaveLength(0);
  });

  it('counts only that source toward its daily cost ceiling', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const nowMs = Date.UTC(2026, 5, 1, 12);
    const prior = await repo.upsertObservedDomain(t.db, t.schema, {
      domain: 'prior.test',
      clientId: 'c',
      at: nowMs - 2_000
    });
    await repo.upsertVerdict(t.db, t.schema, {
      domainId: prior.domainId,
      source: 'metadefender',
      verdict: 'allow',
      confidence: 1,
      raw: {},
      assessedAt: nowMs - 1_000,
      costUsd: 10
    });
    const ai = fakeSource({
      name: 'ai',
      limits: {
        perMinute: null,
        perDay: null,
        dailyCostCeiling: 1
      }
    });
    const d = makeDrainer({
      db: t.db,
      schema: t.schema,
      cfg,
      pacedSources: [ai],
      eligibleSourceNames: ['ai'],
      enrich: noEnrich,
      curatedHits: () => []
    });

    expect(await d.tick(nowMs)).toEqual({ calls: 1 });
    expect(ai.calls).toEqual(['prior.test']);
  });
});

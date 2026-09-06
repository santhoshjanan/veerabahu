import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '../../helpers/test-db';
import { getDashboard } from '../../../src/lib/server/pipeline/dashboard';

let tdb: TestDb;
const NOW = 1_000_000_000;
beforeEach(async () => (tdb = await makeTestDb()));
afterEach(() => tdb.close());

describe('getDashboard', () => {
  it('summarises pipeline state', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.domains).values([
      {
        domain: 'q1',
        firstSeen: NOW - 1000,
        lastSeen: NOW,
        hitCount: 5,
        state: 'pending_review',
        score: -0.6
      },
      {
        domain: 'q2',
        firstSeen: NOW - 2000,
        lastSeen: NOW,
        hitCount: 1,
        state: 'pending_review',
        score: -0.4
      },
      {
        domain: 'obs',
        firstSeen: NOW - 1000,
        lastSeen: NOW,
        hitCount: 1,
        state: 'observed'
      },
      {
        domain: 'old',
        firstSeen: NOW - 5 * 86_400_000,
        lastSeen: NOW,
        hitCount: 1,
        state: 'observed'
      },
      {
        domain: 'pub',
        firstSeen: NOW - 3000,
        lastSeen: NOW,
        hitCount: 1,
        state: 'approved',
        decidedAt: NOW - 100
      },
      {
        domain: 'cleared',
        firstSeen: NOW - 3000,
        lastSeen: NOW - 200,
        hitCount: 1,
        state: 'auto_cleared'
      }
    ]);
    const [d] = await db.select().from(schema.domains).limit(1);
    await db.insert(schema.verdicts).values({
      domainId: d.id,
      source: 'ai',
      verdict: 'block',
      confidence: 0.8,
      category: null,
      detail: null,
      raw: {},
      assessedAt: NOW - 500,
      costUsd: 0.01
    });
    await db.insert(schema.blocklistFetchLog).values({
      at: NOW - 60_000,
      ip: '10.0.0.9',
      userAgent: 'AdGuardHome',
      status: 200
    });
    await db.insert(schema.auditLog).values({
      at: NOW - 50,
      actor: 'user',
      domainId: d.id,
      event: 'decision.approve',
      data: {}
    });
    await db.insert(schema.curatedLists).values({
      name: 'oisd',
      url: 'https://x',
      lastFetched: NOW - 3600_000,
      entryCount: 100000,
      lastError: null
    });
    await db.insert(schema.sourceRateState).values({
      source: 'metadefender',
      tokens: 10,
      lastRefill: NOW,
      dayCount: 40,
      dayStart: NOW,
      monthCount: 40,
      monthStart: NOW,
      lastCallAt: NOW - 1000,
      pausedUntil: null
    });

    const v = await getDashboard(db, schema, NOW);
    expect(v.counts.pending_review).toBe(2);
    expect(v.counts.observed).toBe(2);
    expect(v.publishedCount).toBe(1);
    expect(v.observed24h).toBe(5);
    expect(v.autoCleared24h).toBe(1);
    expect(v.verdictsToday).toBe(1);
    expect(v.aiCostTodayUsd).toBeCloseTo(0.01);
    expect(v.lastPull?.status).toBe(200);
    expect(v.blocklistHealth).toBe('protected');
    expect(v.recentPulls).toHaveLength(1);
    expect(v.curatedLists[0].name).toBe('oisd');
    expect(v.sources.find((s) => s.source === 'metadefender')).toBeTruthy();
    expect(v.recentAudit[0].event).toBe('decision.approve');
  });

  it('returns null lastPull when nothing has fetched', async () => {
    const v = await getDashboard(tdb.db, tdb.schema, NOW);
    expect(v.lastPull).toBeNull();
    expect(v.blocklistHealth).toBe('awaiting_first_pull');
    expect(v.recentPulls).toEqual([]);
    expect(v.aiCostTodayUsd).toBe(0);
  });

  it('preserves identities for matching recent audit events', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.domains).values({
      domain: 'example.test',
      firstSeen: NOW,
      lastSeen: NOW,
      hitCount: 1,
      state: 'observed'
    });
    const [domain] = await db.select().from(schema.domains).limit(1);
    await db.insert(schema.auditLog).values([
      {
        at: NOW,
        actor: 'system',
        domainId: domain.id,
        event: 'assess.error',
        data: {}
      },
      {
        at: NOW,
        actor: 'system',
        domainId: domain.id,
        event: 'assess.error',
        data: {}
      }
    ]);

    const audit = (await getDashboard(db, schema, NOW)).recentAudit;
    expect(new Set(audit.map((entry) => entry.id)).size).toBe(2);
  });
});

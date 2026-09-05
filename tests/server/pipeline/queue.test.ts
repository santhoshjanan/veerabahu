import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '../../helpers/test-db';
import { getQueue, amortizedIntervalMs } from '../../../src/lib/server/pipeline/queue';
import { publish, _resetForTest } from '../../../src/lib/server/events';

let tdb: TestDb;
const NOW = 2_000_000_000;
beforeEach(async () => (tdb = await makeTestDb()));
afterEach(() => {
  _resetForTest();
  tdb.close();
});

describe('getQueue', () => {
  it('reports per-source backlog, ETA and the in-focus domain', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.domains).values([
      { domain: 'a', firstSeen: 1, lastSeen: 1, hitCount: 3, state: 'observed' },
      { domain: 'b', firstSeen: 2, lastSeen: 2, hitCount: 1, state: 'assessing' }
    ]);
    await db.insert(schema.sourceRateState).values([
      {
        source: 'metadefender', tokens: 5, lastRefill: NOW, dayCount: 0, dayStart: NOW,
        monthCount: 0, monthStart: NOW, lastCallAt: NOW - 60_000, pausedUntil: null
      },
      {
        source: 'ai', tokens: 10, lastRefill: NOW, dayCount: 0, dayStart: NOW,
        monthCount: 0, monthStart: NOW, lastCallAt: null, pausedUntil: null
      }
    ]);
    publish({ type: 'assess.start', source: 'metadefender', domain: 'a' });

    const v = await getQueue(db, schema, NOW);
    const md = v.sources.find((s) => s.source === 'metadefender')!;
    expect(md.backlog).toBe(2);
    expect(md.inFocus).toBe('a');
    expect(md.etaMs).toBe(2 * amortizedIntervalMs('metadefender'));
    expect(md.nextCallAt).toBe(NOW - 60_000 + amortizedIntervalMs('metadefender'));

    const curated = v.sources.find((s) => s.source === 'curated_list')!;
    expect(curated.inline).toBe(true);
    expect(curated.etaMs).toBeNull();

    expect(v.totalBacklog).toBe(2);
    expect(v.ingestion.firstRunDone).toBe(false);
  });

  it('flags a paused source and drained backlog', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.sourceRateState).values({
      source: 'ai', tokens: 0, lastRefill: NOW, dayCount: 0, dayStart: NOW,
      monthCount: 0, monthStart: NOW, lastCallAt: null, pausedUntil: NOW + 3600_000
    });
    const v = await getQueue(db, schema, NOW);
    const ai = v.sources.find((s) => s.source === 'ai')!;
    expect(ai.backlog).toBe(0);
    expect(ai.etaMs).toBeNull();
    expect(ai.pausedUntil).toBe(NOW + 3600_000);
    expect(ai.nextCallAt).toBe(NOW); // no lastCallAt → now
  });
});

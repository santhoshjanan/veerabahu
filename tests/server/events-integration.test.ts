import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '../helpers/test-db';
import { subscribe, _resetForTest, type VbEvent } from '../../src/lib/server/events';
import { decide } from '../../src/lib/server/pipeline/review';

let tdb: TestDb;
let events: VbEvent[];
let off: () => void;

beforeEach(async () => {
  tdb = await makeTestDb();
  events = [];
  off = subscribe((e) => events.push(e));
});
afterEach(() => {
  off();
  _resetForTest();
  tdb.close();
});

describe('decide emits a decision event', () => {
  it('fires on approve', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.domains).values({
      domain: 'ads.example',
      firstSeen: 1,
      lastSeen: 1,
      hitCount: 3,
      state: 'pending_review',
      score: -0.7
    });
    const r = await decide(db, schema, 'ads.example', 'approve', 'looks bad');
    expect(r).toEqual({ ok: true });
    expect(events).toContainEqual({
      type: 'decision',
      domain: 'ads.example',
      decision: 'approve'
    });
  });
});

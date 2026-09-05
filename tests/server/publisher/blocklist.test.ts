import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db';
import {
  renderBlocklist,
  computeEtag,
  buildBlocklistResponse
} from '$lib/server/publisher/blocklist';
import * as repo from '$lib/server/db/repo';

let closer: (() => void) | null = null;
afterEach(() => {
  closer?.();
  closer = null;
});

describe('renderBlocklist / computeEtag', () => {
  it('sorts, one per line, with a comment header', () => {
    const body = renderBlocklist(['b.com', 'a.com'], 1_700_000_000_000);
    const lines = body.trimEnd().split('\n');
    expect(lines[0]).toMatch(
      /^# Veerabahu blocklist — generated .*, 2 domains$/
    );
    expect(lines.slice(1)).toEqual(['a.com', 'b.com']);
  });
  it('etag is stable for the same set regardless of order and changes with content', () => {
    expect(computeEtag(['a.com', 'b.com'])).toBe(
      computeEtag(['b.com', 'a.com'])
    );
    expect(computeEtag(['a.com'])).not.toBe(computeEtag(['a.com', 'b.com']));
  });
});

describe('buildBlocklistResponse', () => {
  it('200 with body + etag, and logs the fetch', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const { domainId } = await repo.upsertObservedDomain(t.db, t.schema, {
      domain: 'ads.test',
      clientId: 'c',
      at: 1
    });
    await repo.setDomainScoreAndState(
      t.db,
      t.schema,
      domainId,
      -1,
      'pending_review'
    );
    await repo.decideDomain(t.db, t.schema, domainId, 'approve', null, 5);

    const r = await buildBlocklistResponse(t.db, t.schema, {
      ifNoneMatch: null,
      ip: '10.0.0.9',
      userAgent: 'pihole/6'
    });
    expect(r.status).toBe(200);
    expect(r.body).toContain('ads.test');
    expect(r.headers['ETag']).toBeTruthy();

    const logs = await t.db.select().from(t.schema.blocklistFetchLog);
    expect(logs[0]).toMatchObject({
      ip: '10.0.0.9',
      userAgent: 'pihole/6',
      status: 200
    });
  });

  it('304 when If-None-Match matches, still logs status 304', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const first = await buildBlocklistResponse(t.db, t.schema, {
      ifNoneMatch: null,
      ip: '1.1.1.1',
      userAgent: null
    });
    const again = await buildBlocklistResponse(t.db, t.schema, {
      ifNoneMatch: first.headers['ETag'],
      ip: '1.1.1.1',
      userAgent: null
    });
    expect(again.status).toBe(304);
    const logs = await t.db.select().from(t.schema.blocklistFetchLog);
    expect(logs.map((l: any) => l.status).sort()).toEqual([200, 304]);
  });
});

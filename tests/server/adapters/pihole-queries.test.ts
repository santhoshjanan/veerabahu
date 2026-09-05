import { describe, it, expect, afterEach } from 'vitest';
import fixture from '../../fixtures/pihole-queries.json';
import { startStubPihole } from '../../helpers/stub-pihole';
import { makePiholeAdapter } from '$lib/server/adapters/gatekeeper/pihole';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

describe('listResolvedDomains', () => {
  it('normalizes rows: ms timestamps, client, disposition from status', async () => {
    const stub = await startStubPihole({ appPassword: 'pw', queries: fixture.queries });
    close = stub.close;
    const a = makePiholeAdapter({ baseUrl: stub.baseUrl, appPassword: 'pw' });
    const { entries, nextCursor } = await a.listResolvedDomains({
      since: 0,
      until: Date.now(),
      limit: 100
    });
    expect(nextCursor).toBeNull();
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      domain: 'telemetry.example.com',
      client: { id: '192.168.1.20', label: 'laptop' },
      at: 1725500000500,
      disposition: 'allowed',
      rawStatus: 'FORWARDED'
    });
    expect(entries[1].disposition).toBe('blocked'); // GRAVITY
    expect(entries[2].disposition).toBe('blocked'); // DENYLIST_CNAME
    expect(entries[2].client).toEqual({ id: '192.168.1.22', label: 'phone' });
  });

  it('pages: follows the numeric cursor and stops at null', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: 100 - i,
      time: 1725500000 - i,
      type: 'A',
      domain: `d${i}.com`,
      cname: null,
      status: 'FORWARDED',
      client: { ip: '10.0.0.1', name: null },
      reply: {},
      upstream: 'x'
    }));
    const stub = await startStubPihole({ appPassword: 'pw', queries: rows });
    close = stub.close;
    const a = makePiholeAdapter({ baseUrl: stub.baseUrl, appPassword: 'pw' });

    const p1 = await a.listResolvedDomains({ since: 0, until: Date.now(), limit: 2 });
    expect(p1.entries.map((e) => e.domain)).toEqual(['d0.com', 'd1.com']);
    expect(p1.nextCursor).toBe('99');

    const p2 = await a.listResolvedDomains({
      since: 0,
      until: Date.now(),
      limit: 2,
      cursor: p1.nextCursor!
    });
    expect(p2.entries.map((e) => e.domain)).toEqual(['d2.com', 'd3.com']);
  });

  it('reports gapBefore when earliest available data is newer than `since`', async () => {
    const stub = await startStubPihole({ appPassword: 'pw', queries: fixture.queries });
    close = stub.close;
    const a = makePiholeAdapter({ baseUrl: stub.baseUrl, appPassword: 'pw' });
    const since = Date.UTC(2020, 0, 1); // way before the fixture's earliest_timestamp
    const r = await a.listResolvedDomains({ since, until: Date.now(), limit: 100 });
    expect(r.gapBefore).toBe(1725499998000);
  });
});

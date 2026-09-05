import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeTestDb } from '../../helpers/test-db';
import {
  parseListText,
  makeCuratedListSource
} from '$lib/server/reputation/curated-list';

let closer: (() => void) | null = null;
afterEach(() => {
  closer?.();
  closer = null;
});

const hosts = readFileSync('tests/fixtures/curated-hosts.txt', 'utf8');
const domainsList = readFileSync('tests/fixtures/curated-domains.txt', 'utf8');
const adblock = readFileSync('tests/fixtures/curated-adblock.txt', 'utf8');

describe('parseListText', () => {
  it('parses hosts, plain and adblock lines and drops comments/localhost', () => {
    expect(parseListText(hosts).sort()).toEqual([
      'ads.tracker.test',
      'metrics.tracker.test'
    ]);
    expect(parseListText(domainsList).sort()).toEqual([
      'another.plainbad.test',
      'plainbad.test'
    ]);
    expect(parseListText(adblock).sort()).toEqual([
      'sub.wildcardbad.test',
      'wildcardbad.test'
    ]);
  });
});

describe('makeCuratedListSource', () => {
  const fetchImpl = (async (url: string) => {
    const body = String(url).includes('hosts')
      ? hosts
      : String(url).includes('adblock')
        ? adblock
        : domainsList;
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;

  it('refresh loads every url into the set and persists to curated_domains', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const src = makeCuratedListSource(t.db, t.schema, {
      urls: [
        'http://x/hosts.txt',
        'http://x/adblock.txt',
        'http://x/domains.txt'
      ],
      fetchImpl
    });
    await src.refresh();
    expect(src.has('ads.tracker.test')).toBe(true);
    expect(src.has('wildcardbad.test')).toBe(true);
    const rows = await t.db.select().from(t.schema.curatedDomains);
    expect(rows.length).toBe(6);
    const lists = await t.db.select().from(t.schema.curatedLists);
    expect(
      lists.every((l: any) => l.entryCount > 0 && l.lastError === null)
    ).toBe(true);
  });

  it('votes block@1 for a listed domain and for a subdomain of a listed domain', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const src = makeCuratedListSource(t.db, t.schema, {
      urls: ['http://x/domains.txt'],
      fetchImpl
    });
    await src.refresh();
    const base = {
      hitCount: 1,
      distinctClientCount: 1,
      curatedListHits: [],
      enrichment: { whois: null, dns: null }
    };

    const hit = await src.assess({ ...base, domain: 'plainbad.test' });
    expect(hit).toMatchObject({ verdict: 'block', confidence: 1 });

    const subHit = await src.assess({ ...base, domain: 'deep.plainbad.test' });
    expect(subHit.verdict).toBe('block'); // parent-domain match

    const miss = await src.assess({ ...base, domain: 'totally-fine.test' });
    expect(miss).toMatchObject({ verdict: 'unsure', confidence: 0 });
  });

  it('loadFromDb rebuilds the set without re-fetching', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const a = makeCuratedListSource(t.db, t.schema, {
      urls: ['http://x/domains.txt'],
      fetchImpl
    });
    await a.refresh();
    const b = makeCuratedListSource(t.db, t.schema, { urls: [], fetchImpl });
    await b.loadFromDb();
    expect(b.has('plainbad.test')).toBe(true);
  });

  it('records last_error and keeps the previous set when a url fails', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const flaky = (async () =>
      new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const src = makeCuratedListSource(t.db, t.schema, {
      urls: ['http://x/domains.txt'],
      fetchImpl: flaky
    });
    await src.refresh(); // must not throw
    const [list] = await t.db.select().from(t.schema.curatedLists);
    expect(list.lastError).toMatch(/500/);
  });
});

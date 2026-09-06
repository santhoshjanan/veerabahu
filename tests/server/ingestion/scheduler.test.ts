import { describe, it, expect, afterEach, vi } from 'vitest';
import { makeTestDb } from '../../helpers/test-db';
import { makeIngestion } from '$lib/server/ingestion/scheduler';
import * as repo from '$lib/server/db/repo';
import { loadConfig } from '$lib/server/config';
import type { GatekeeperAdapter } from '$lib/server/adapters/gatekeeper/types';

let closer: (() => void) | null = null;
afterEach(() => {
  closer?.();
  closer = null;
});

const cfg = loadConfig({
  VB_PIHOLE_BASE_URL: 'http://x',
  VB_PIHOLE_APP_PASSWORD: 'p',
  VB_FIRST_RUN_CAP: '2',
  VB_MAX_REVIEW_WAIT_HOURS: '9999'
});

function stubAdapter(
  pages: Awaited<ReturnType<GatekeeperAdapter['listResolvedDomains']>>[]
): GatekeeperAdapter {
  let i = 0;
  return {
    listResolvedDomains: async () => pages[Math.min(i++, pages.length - 1)]
  };
}

const curatedAlways = {
  assess: async () => ({
    verdict: 'block' as const,
    confidence: 1,
    category: 'listed',
    detail: null,
    raw: {}
  }),
  has: () => true
};
const curatedNever = {
  assess: async () => ({
    verdict: 'unsure' as const,
    confidence: 0,
    category: null,
    detail: null,
    raw: {}
  }),
  has: () => false
};

describe('ingestion.runOnce', () => {
  it('waits for in-flight ingestion before shutdown completes', async () => {
    const t = await makeTestDb();
    closer = t.close;
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ing = makeIngestion({
      db: t.db,
      schema: t.schema,
      cfg,
      curated: null,
      eligibleSourceNames: [],
      adapter: {
        listResolvedDomains: async () => {
          entered();
          await pending;
          return { entries: [], nextCursor: null, gapBefore: null };
        }
      }
    });
    ing.start();
    await started;
    let stopped = false;
    const stop = Promise.resolve(ing.stop()).then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await stop;
    expect((await repo.getIngestState(t.db, t.schema)).firstRunDone).toBe(true);
  });
  it('does not assess curated lists when that source is disabled', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const ing = makeIngestion({
      db: t.db,
      schema: t.schema,
      cfg,
      adapter: stubAdapter([
        {
          entries: [
            {
              domain: 'unlisted.test',
              client: { id: 'c', label: null },
              at: 1,
              disposition: 'allowed',
              rawStatus: 'FORWARDED'
            }
          ],
          nextCursor: null,
          gapBefore: null
        }
      ]),
      curated: null,
      eligibleSourceNames: []
    });

    await expect(ing.runOnce()).resolves.toMatchObject({ newCount: 1 });
    const domain = await repo.getDomainByName(t.db, t.schema, 'unlisted.test');
    expect(
      await repo.listVerdictsForDomain(t.db, t.schema, domain!.id)
    ).toEqual([]);
  });

  it('inserts allowed domains, skips blocked, records curated block verdicts, sets cursor', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const adapter = stubAdapter([
      {
        entries: [
          {
            domain: 'ok.test',
            client: { id: 'c1', label: null },
            at: 10,
            disposition: 'allowed',
            rawStatus: 'FORWARDED'
          },
          {
            domain: 'blk.test',
            client: { id: 'c1', label: null },
            at: 11,
            disposition: 'blocked',
            rawStatus: 'GRAVITY'
          }
        ],
        nextCursor: null,
        gapBefore: null
      }
    ]);
    const assessSpy = vi.fn(curatedAlways.assess);
    const ing = makeIngestion({
      db: t.db,
      schema: t.schema,
      cfg,
      adapter,
      curated: { assess: assessSpy, has: curatedAlways.has },
      eligibleSourceNames: ['curated_list']
    });
    const r = await ing.runOnce();
    expect(r.newCount).toBe(1);
    expect(
      await repo.getDomainByName(t.db, t.schema, 'blk.test')
    ).toBeUndefined();
    const ok = await repo.getDomainByName(t.db, t.schema, 'ok.test');
    expect(ok!.state).toBe('pending_review'); // curated block => score -1 => pending
    const st = await repo.getIngestState(t.db, t.schema);
    expect(st).toMatchObject({
      firstRunDone: true,
      lastIngestAt: expect.any(Number)
    });

    // Amendment #3: NO WHOIS. enrichment passed to curated.assess is { dns: null }
    expect(assessSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'ok.test',
        enrichment: { dns: null }
      })
    );
  });

  it('honours the first-run cap and stops paging', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const mk = (n: number) => ({
      entries: Array.from({ length: n }, (_, i) => ({
        domain: `d${i}-${Math.random()}.test`,
        client: { id: 'c', label: null },
        at: i,
        disposition: 'allowed' as const,
        rawStatus: 'FORWARDED'
      })),
      nextCursor: 'more',
      gapBefore: null
    });
    const ing = makeIngestion({
      db: t.db,
      schema: t.schema,
      cfg,
      adapter: stubAdapter([mk(5), mk(5)]),
      curated: curatedNever,
      eligibleSourceNames: ['curated_list']
    });
    const r = await ing.runOnce();
    expect(r.newCount).toBeGreaterThanOrEqual(2);
    expect(r.pages).toBe(1); // stopped after the cap, did not fetch page 2
  });

  it('pages past cap on subsequent runs (when firstRunDone is true)', async () => {
    const t = await makeTestDb();
    closer = t.close;
    await repo.setIngestState(t.db, t.schema, {
      firstRunDone: true,
      cursor: 'cur1'
    });

    let fetchedPage = 0;
    const adapter: GatekeeperAdapter = {
      listResolvedDomains: async (opts) => {
        fetchedPage++;
        if (fetchedPage === 1) {
          return {
            entries: [
              {
                domain: 'sub1.test',
                client: { id: 'c', label: null },
                at: 1,
                disposition: 'allowed',
                rawStatus: 'FORWARDED'
              },
              {
                domain: 'sub2.test',
                client: { id: 'c', label: null },
                at: 2,
                disposition: 'allowed',
                rawStatus: 'FORWARDED'
              },
              {
                domain: 'sub3.test',
                client: { id: 'c', label: null },
                at: 3,
                disposition: 'allowed',
                rawStatus: 'FORWARDED'
              }
            ],
            nextCursor: 'cur2',
            gapBefore: null
          };
        }
        return {
          entries: [
            {
              domain: 'sub4.test',
              client: { id: 'c', label: null },
              at: 4,
              disposition: 'allowed',
              rawStatus: 'FORWARDED'
            }
          ],
          nextCursor: null,
          gapBefore: null
        };
      }
    };

    const ing = makeIngestion({
      db: t.db,
      schema: t.schema,
      cfg,
      adapter,
      curated: curatedNever,
      eligibleSourceNames: ['curated_list']
    });
    const r = await ing.runOnce();
    // Cap is Infinity so it should have processed both pages
    expect(r.pages).toBe(2);
    expect(r.newCount).toBe(4);
    const st = await repo.getIngestState(t.db, t.schema);
    expect(st.cursor).toBeNull();
  });

  it('skips allowlisted domains', async () => {
    const t = await makeTestDb();
    closer = t.close;
    await repo.addAllowlist(t.db, t.schema, 'known-good.test', 'user', 1);
    const adapter = stubAdapter([
      {
        entries: [
          {
            domain: 'known-good.test',
            client: { id: 'c', label: null },
            at: 1,
            disposition: 'allowed',
            rawStatus: 'CACHE'
          }
        ],
        nextCursor: null,
        gapBefore: null
      }
    ]);
    const ing = makeIngestion({
      db: t.db,
      schema: t.schema,
      cfg,
      adapter,
      curated: curatedNever,
      eligibleSourceNames: ['curated_list']
    });
    await ing.runOnce();
    expect(
      await repo.getDomainByName(t.db, t.schema, 'known-good.test')
    ).toBeUndefined();
  });

  it('writes an ingest.gap audit row when gapBefore is set', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const adapter = stubAdapter([
      { entries: [], nextCursor: null, gapBefore: 123456 }
    ]);
    const ing = makeIngestion({
      db: t.db,
      schema: t.schema,
      cfg,
      adapter,
      curated: curatedNever,
      eligibleSourceNames: ['curated_list']
    });
    await ing.runOnce();
    const audit = await t.db.select().from(t.schema.auditLog);
    expect(audit.some((a: any) => a.event === 'ingest.gap')).toBe(true);
  });

  it('deduplicates observed domains across runs, updating hit count', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const adapter = stubAdapter([
      {
        entries: [
          {
            domain: 'repeat.test',
            client: { id: 'c1', label: null },
            at: 100,
            disposition: 'allowed',
            rawStatus: 'FORWARDED'
          },
          {
            domain: 'repeat.test',
            client: { id: 'c2', label: null },
            at: 200,
            disposition: 'allowed',
            rawStatus: 'FORWARDED'
          }
        ],
        nextCursor: null,
        gapBefore: null
      }
    ]);
    const ing = makeIngestion({
      db: t.db,
      schema: t.schema,
      cfg,
      adapter,
      curated: curatedNever,
      eligibleSourceNames: ['curated_list']
    });
    const r = await ing.runOnce();
    expect(r.newCount).toBe(1);
    const domain = await repo.getDomainByName(t.db, t.schema, 'repeat.test');
    expect(domain?.hitCount).toBe(2);
    expect(domain?.lastSeen).toBe(200);
  });

  it('start() immediately runs once, sets interval, and stop() clears it', async () => {
    vi.useFakeTimers();
    try {
      const t = await makeTestDb();
      closer = t.close;
      let callCount = 0;
      const adapter: GatekeeperAdapter = {
        listResolvedDomains: async () => {
          callCount++;
          return { entries: [], nextCursor: null, gapBefore: null };
        }
      };
      const ing = makeIngestion({
        db: t.db,
        schema: t.schema,
        cfg,
        adapter,
        curated: curatedNever,
        eligibleSourceNames: ['curated_list']
      });

      ing.start();
      // start() runs once immediately
      await vi.waitFor(() => expect(callCount).toBe(1));

      // Advance interval
      await vi.advanceTimersByTimeAsync(cfg.ingestIntervalMs);
      await vi.waitFor(() => expect(callCount).toBe(2));

      // Advance another interval
      await vi.advanceTimersByTimeAsync(cfg.ingestIntervalMs);
      await vi.waitFor(() => expect(callCount).toBe(3));

      // Stop halts future runs
      ing.stop();
      await vi.advanceTimersByTimeAsync(cfg.ingestIntervalMs * 2);
      expect(callCount).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

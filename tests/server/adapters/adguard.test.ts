import { describe, expect, it, vi } from 'vitest';
import { makeAdguardAdapter } from '$lib/server/adapters/gatekeeper/adguard';

describe('AdGuard adapter', () => {
  it('maps query reasons to allowed and blocked', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                question: { name: 'allowed.example' },
                client: '192.168.1.2',
                time: '2024-01-01T00:00:00.500Z',
                reason: 'NotFilteredNotFound'
              },
              {
                question: { name: 'blocked.example' },
                client: '192.168.1.3',
                time: '2024-01-01T00:00:01Z',
                reason: 'FilteredBlackList'
              }
            ],
            oldest: '2023-12-31T23:59:00Z'
          })
        )
    );
    const adapter = makeAdguardAdapter({
      baseUrl: 'http://adguard.local',
      password: 'secret',
      fetchImpl
    });

    const page = await adapter.listResolvedDomains({
      since: 0,
      until: Date.now(),
      limit: 10
    });

    expect(page.entries.map((x) => x.disposition)).toEqual([
      'allowed',
      'blocked'
    ]);
    expect(page.entries[0]).toMatchObject({
      domain: 'allowed.example',
      client: { id: '192.168.1.2', label: null },
      at: 1704067200500,
      rawStatus: 'NotFilteredNotFound'
    });
    expect(
      String((fetchImpl.mock.calls as unknown as [unknown][])[0][0])
    ).toContain('older_than=');
    expect(page.gapBefore).toBe(1704067140000);
  });

  it('uses the timestamp cursor and returns the next page cursor', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                question: { name: 'one.example' },
                time: '2024-01-01T00:00:01Z',
                reason: 'NotFiltered'
              }
            ],
            oldest: '2024-01-01T00:00:01Z'
          })
        )
    );
    const adapter = makeAdguardAdapter({
      baseUrl: 'http://adguard.local',
      password: 'secret',
      fetchImpl
    });

    const page = await adapter.listResolvedDomains({
      since: 0,
      until: Date.now(),
      limit: 1
    });

    expect(page.nextCursor).toBe('2024-01-01T00:00:01Z');
    expect(
      String((fetchImpl.mock.calls as unknown as [unknown][])[0][0])
    ).toContain('limit=1');
  });
});

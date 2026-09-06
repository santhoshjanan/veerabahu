import { describe, expect, it, vi } from 'vitest';
import { testGatekeeper } from '$lib/server/settings/connection-test';

const settings = (type: 'pihole' | 'adguard' = 'adguard') =>
  ({
    gatekeeper: { type, baseUrl: 'http://adguard.local', username: 'admin' }
  }) as any;

describe('testGatekeeper', () => {
  it('maps a 401 to auth_rejected without returning credentials', async () => {
    const result = await testGatekeeper(
      settings(),
      'secret',
      vi.fn(async () => new Response('no', { status: 401 }))
    );
    expect(result).toMatchObject({ kind: 'auth_rejected' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('maps a successful valid response to connected', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ data: [] }))
    );
    await expect(
      testGatekeeper(settings(), 'secret', fetchImpl)
    ).resolves.toMatchObject({ kind: 'connected' });
    const init = (
      fetchImpl.mock.calls as unknown as [unknown, RequestInit][]
    )[0][1];
    expect(init.headers).toMatchObject({
      authorization: `Basic ${btoa('admin:secret')}`
    });
  });

  it('maps fetch errors and malformed responses', async () => {
    await expect(
      testGatekeeper(
        settings(),
        'secret',
        vi.fn(async () => {
          throw new Error('offline');
        })
      )
    ).resolves.toMatchObject({ kind: 'unreachable' });
    await expect(
      testGatekeeper(
        settings(),
        'secret',
        vi.fn(async () => new Response('{}'))
      )
    ).resolves.toMatchObject({ kind: 'invalid_response' });
  });
});

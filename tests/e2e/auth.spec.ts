import { test, expect } from './fixtures';

test.describe('fresh setup over HTTP', () => {
  test.use({ configured: false });

  test('only the password creator can read, change, and activate setup', async ({
    request,
    playwright,
    baseURL,
    seeded,
    gatekeeperUrl
  }) => {
    void seeded;
    const headers = { origin: baseURL!, accept: 'text/html' };
    const post = (path: string, form: Record<string, string>) =>
      request.post(path, {
        form,
        headers,
        maxRedirects: 0
      });
    expect((await request.get('/setup')).status()).toBe(200);
    const password = 'correct horse battery staple';
    expect(
      (
        await post('/setup?/access', { password, passwordConfirm: password })
      ).status()
    ).toBe(200);
    const anonymous = await playwright.request.newContext({ baseURL });
    try {
      expect(
        (await anonymous.get('/setup', { maxRedirects: 0 })).headers().location
      ).toBe('/login');
      for (const action of [
        'access',
        'gatekeeper',
        'sources',
        'quotas',
        'activate'
      ]) {
        const response = await anonymous.post(`/setup?/${action}`, {
          headers,
          form: {
            type: 'pihole',
            baseUrl: 'http://attacker.invalid',
            password: ''
          },
          maxRedirects: 0
        });
        expect(response.status()).toBe(303);
        expect(response.headers().location).toBe('/login');
      }
      expect((await anonymous.get('/blocklist.txt')).status()).toBe(200);
    } finally {
      await anonymous.dispose();
    }
    expect(
      (
        await post('/setup?/gatekeeper', {
          type: 'pihole',
          baseUrl: gatekeeperUrl,
          password: 'pihole-app-password'
        })
      ).status()
    ).toBe(200);
    expect(
      (
        await post('/setup?/sources', {
          curatedListEnabled: 'on',
          curatedListUrls: ''
        })
      ).status()
    ).toBe(400);
    expect(
      (
        await post('/setup?/sources', {
          curatedListEnabled: 'on',
          curatedListUrls: `${gatekeeperUrl}/list`
        })
      ).status()
    ).toBe(200);
    expect(
      (
        await post('/setup?/quotas', {
          curatedListWeight: '1',
          metadefenderWeight: '1',
          aiWeight: '0.6',
          virustotalWeight: '1'
        })
      ).status()
    ).toBe(200);
    const concurrent = await Promise.all([
      post('/setup?/quotas', {
        curatedListWeight: '1',
        metadefenderWeight: '1',
        aiWeight: '0.6',
        virustotalWeight: '1',
        aiPriceInputPerMTok: '2',
        aiPriceOutputPerMTok: '5'
      }),
      post('/setup?/sources', {
        curatedListEnabled: 'on',
        curatedListUrls: `${gatekeeperUrl}/list`,
        aiModel: 'saved-model'
      })
    ]);
    expect(concurrent.map((response) => response.status())).toEqual([200, 200]);
    const activation = await post('/setup?/activate', {});
    expect(activation.status()).toBe(303);
    expect(activation.headers().location).toBe('/');
    const settings = await request.get('/settings');
    expect(settings.status()).toBe(200);
    const html = await settings.text();
    expect(html).not.toContain('pihole-app-password');
    expect(
      html.match(/<input[^>]*name="aiPriceInputPerMTok"[^>]*>/)?.[0]
    ).toContain('value="2"');
    expect(html.match(/<input[^>]*name="aiModel"[^>]*>/)?.[0]).toContain(
      'value="saved-model"'
    );
  });
});

test('configured fixtures authenticate and keep the current gatekeeper URL', async ({
  request,
  baseURL,
  seeded,
  gatekeeperUrl
}) => {
  void seeded;
  expect(
    (await request.get('/settings', { maxRedirects: 0 })).headers().location
  ).toBe('/login');
  expect(
    (
      await request.post('/login', {
        headers: { origin: baseURL!, accept: 'text/html' },
        form: { password: 'correct horse battery staple' },
        maxRedirects: 0
      })
    ).status()
  ).toBe(303);
  const settings = await request.get('/settings');
  const html = await settings.text();
  expect(html).toContain(gatekeeperUrl);
  expect(html).toContain('href="/blocklist.txt"');
  expect(html).not.toContain('name="blocklistPath"');
  expect(
    (
      await request.post('/settings?/gatekeeper', {
        headers: { origin: baseURL!, accept: 'text/html' },
        form: { type: 'pihole', baseUrl: gatekeeperUrl, password: '' },
        maxRedirects: 0
      })
    ).status()
  ).toBe(200);
});

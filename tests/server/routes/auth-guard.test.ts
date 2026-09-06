import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$app/environment', () => ({ building: false }));

const mocks = vi.hoisted(() => ({
  importEnvironmentOnce: vi.fn(),
  getStoredSettings: vi.fn(),
  getSession: vi.fn(),
  hasAdmin: vi.fn(),
  parseMasterKey: vi.fn(),
  createSession: vi.fn(),
  verifyAdminPassword: vi.fn(),
  runMigrations: vi.fn(),
  startIfActive: vi.fn()
}));

vi.mock('$lib/server/db/index', () => ({ db: {}, schema: {} }));
vi.mock('$lib/server/db/migrate', () => ({
  runMigrations: mocks.runMigrations
}));
vi.mock('$lib/server/settings/crypto', () => ({
  parseMasterKey: mocks.parseMasterKey
}));
vi.mock('$lib/server/settings/store', () => ({
  importEnvironmentOnce: mocks.importEnvironmentOnce,
  getStoredSettings: mocks.getStoredSettings
}));
vi.mock('$lib/server/settings/runtime', () => ({
  runtime: { startIfActive: mocks.startIfActive }
}));
vi.mock('$lib/server/auth', async (original) => ({
  ...(await original<typeof import('../../../src/lib/server/auth')>()),
  getSession: mocks.getSession,
  hasAdmin: mocks.hasAdmin,
  createSession: mocks.createSession,
  verifyAdminPassword: mocks.verifyAdminPassword
}));

function cookies(token?: string) {
  return {
    get: vi.fn(() => token),
    set: vi.fn(),
    delete: vi.fn()
  };
}

async function resolveFor(pathname: string, settings: unknown, token?: string) {
  mocks.getStoredSettings.mockResolvedValue(settings);
  const jar = cookies(token);
  const event = {
    url: new URL(`http://local${pathname}`),
    request: new Request(`http://local${pathname}`),
    cookies: jar,
    locals: {}
  } as any;
  const resolve = vi.fn(async () => new Response('ok'));
  const { handle } = await import('../../../src/hooks.server');
  try {
    const response = await handle({ event, resolve });
    return { status: response.status, event, resolve, cookies: jar };
  } catch (error) {
    return { ...(error as object), event, resolve, cookies: jar };
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.importEnvironmentOnce.mockResolvedValue(false);
  mocks.getSession.mockResolvedValue(null);
  mocks.hasAdmin.mockResolvedValue(false);
  mocks.parseMasterKey.mockReset().mockReturnValue(Buffer.alloc(32));
  mocks.createSession.mockResolvedValue('opaque');
  mocks.verifyAdminPassword.mockResolvedValue(true);
  mocks.runMigrations.mockResolvedValue(undefined);
  mocks.startIfActive.mockResolvedValue(undefined);
});

afterEach(() => vi.resetModules());

describe('authentication hook', () => {
  it('protects setup as soon as a local admin exists, including incomplete onboarding', async () => {
    mocks.hasAdmin.mockResolvedValue(true);
    for (const pathname of [
      '/setup',
      '/setup?/gatekeeper',
      '/setup?/sources',
      '/setup?/quotas',
      '/setup?/activate'
    ]) {
      const result = await resolveFor(pathname, { onboardingComplete: false });
      expect(result).toMatchObject({ status: 303, location: '/login' });
      expect(result.resolve).not.toHaveBeenCalled();
    }
    mocks.getSession.mockResolvedValue({ tokenHash: 'admin' });
    expect(
      await resolveFor('/setup', { onboardingComplete: false }, 'opaque')
    ).toMatchObject({ status: 200 });
  });

  it('validates the master key and initializes runtime at server startup before requests', async () => {
    const { init } = await import('../../../src/hooks.server');
    await init();
    await resolveFor('/blocklist.txt', null);
    expect(mocks.parseMasterKey).toHaveBeenCalledOnce();
    expect(mocks.startIfActive).toHaveBeenCalledOnce();
  });

  it('fails startup before serving requests with an invalid master key', async () => {
    mocks.parseMasterKey.mockImplementationOnce(() => {
      throw new Error('VB_MASTER_KEY is invalid');
    });
    const { init } = await import('../../../src/hooks.server');
    await expect(init()).rejects.toThrow('VB_MASTER_KEY');
    expect(mocks.startIfActive).not.toHaveBeenCalled();
  });
  it('redirects incomplete instances to setup and anonymous configured instances to login', async () => {
    expect(await resolveFor('/review', null)).toMatchObject({
      status: 303,
      location: '/setup'
    });
    expect(
      await resolveFor('/review', { onboardingComplete: true })
    ).toMatchObject({ status: 303, location: '/login' });
  });

  it('requires a valid session for setup after onboarding is complete', async () => {
    expect(
      await resolveFor('/setup', { onboardingComplete: true })
    ).toMatchObject({ status: 303, location: '/login' });
  });

  it.each(['/setup', '/login', '/_app/app.js', '/blocklist.txt'])(
    'keeps %s public',
    async (pathname) => {
      expect(await resolveFor(pathname, null)).toMatchObject({ status: 200 });
    }
  );

  it('protects endpoints and attaches valid sessions before resolving', async () => {
    const session = {
      tokenHash: 'hash',
      createdAt: 1,
      expiresAt: 2,
      invalidatedAt: null
    };
    mocks.getSession.mockResolvedValue(session);

    const result = await resolveFor(
      '/api/review/example.com',
      { onboardingComplete: true },
      'opaque'
    );

    expect(result).toMatchObject({ status: 200 });
    expect(result.event.locals.adminSession).toEqual(session);
    expect(result.event.locals.configured).toBe(true);
    expect(result.resolve).toHaveBeenCalledOnce();
  });

  it('imports settings and starts the runtime once across requests', async () => {
    await resolveFor('/blocklist.txt', null);
    await resolveFor('/blocklist.txt', null);

    expect(mocks.runMigrations).toHaveBeenCalledOnce();
    expect(mocks.importEnvironmentOnce).toHaveBeenCalledOnce();
    expect(mocks.startIfActive).toHaveBeenCalledOnce();
  });

  it('keeps recovery surfaces available when runtime startup fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.startIfActive.mockRejectedValueOnce(new Error('damaged credential'));

    expect(await resolveFor('/login', null)).toMatchObject({ status: 200 });
    expect(await resolveFor('/setup', null)).toMatchObject({ status: 200 });
    expect(await resolveFor('/blocklist.txt', null)).toMatchObject({
      status: 200
    });
    mocks.getSession.mockResolvedValue({
      tokenHash: 'hash',
      createdAt: 1,
      expiresAt: 2,
      invalidatedAt: null
    });
    expect(
      await resolveFor('/review', { onboardingComplete: true }, 'opaque')
    ).toMatchObject({ status: 200 });
    expect(mocks.startIfActive).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      'background startup failed',
      expect.objectContaining({ message: 'damaged credential' })
    );
    log.mockRestore();
  });

  it('retries initialization after a fatal transient failure', async () => {
    mocks.runMigrations.mockRejectedValueOnce(
      new Error('database unavailable')
    );

    expect(await resolveFor('/login', null)).not.toMatchObject({ status: 200 });
    expect(await resolveFor('/login', null)).toMatchObject({ status: 200 });
    expect(mocks.runMigrations).toHaveBeenCalledTimes(2);
    expect(mocks.startIfActive).toHaveBeenCalledOnce();
  });
});

describe('login route', () => {
  it('sets a 12-hour strict cookie with Secure on HTTPS', async () => {
    const jar = cookies();
    const { actions } = await import('../../../src/routes/login/+page.server');

    await expect(
      (actions.default as any)({
        request: new Request('https://local/login', {
          method: 'POST',
          body: new URLSearchParams({ password: 'secret' })
        }),
        cookies: jar,
        url: new URL('https://local/login')
      })
    ).rejects.toMatchObject({ status: 303, location: '/' });
    expect(jar.set).toHaveBeenCalledWith('vb_session', 'opaque', {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      secure: true,
      maxAge: 43_200
    });
  });

  it('rejects a wrong password without creating a session', async () => {
    mocks.verifyAdminPassword.mockResolvedValue(false);
    const jar = cookies();
    const { actions } = await import('../../../src/routes/login/+page.server');

    const result = await (actions.default as any)({
      request: new Request('http://local/login', {
        method: 'POST',
        body: new URLSearchParams({ password: 'wrong' })
      }),
      cookies: jar,
      url: new URL('http://local/login')
    });

    expect(result).toMatchObject({ status: 400, data: { invalid: true } });
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(jar.set).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  importEnvironmentOnce: vi.fn(),
  getStoredSettings: vi.fn(),
  getSession: vi.fn(),
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
  parseMasterKey: () => Buffer.alloc(32)
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
  mocks.createSession.mockResolvedValue('opaque');
  mocks.verifyAdminPassword.mockResolvedValue(true);
  mocks.runMigrations.mockResolvedValue(undefined);
  mocks.startIfActive.mockResolvedValue(undefined);
});

afterEach(() => vi.resetModules());

describe('authentication hook', () => {
  it('redirects incomplete instances to setup and anonymous configured instances to login', async () => {
    expect(await resolveFor('/review', null)).toMatchObject({
      status: 303,
      location: '/setup'
    });
    expect(
      await resolveFor('/review', { onboardingComplete: true })
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
    expect(result.resolve).toHaveBeenCalledOnce();
  });

  it('imports settings and starts the runtime once across requests', async () => {
    await resolveFor('/blocklist.txt', null);
    await resolveFor('/blocklist.txt', null);

    expect(mocks.runMigrations).toHaveBeenCalledOnce();
    expect(mocks.importEnvironmentOnce).toHaveBeenCalledOnce();
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

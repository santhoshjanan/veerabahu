import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  getSafeSettings: vi.fn(),
  getSecret: vi.fn(),
  getSettings: vi.fn(),
  getStoredSettings: vi.fn(),
  replaceSecret: vi.fn(),
  saveSettings: vi.fn(),
  testGatekeeper: vi.fn(),
  restart: vi.fn(),
  values: vi.fn()
}));

vi.mock('$lib/server/db/index', () => ({
  db: { insert: () => ({ values: mocks.values }) },
  schema: { localAdmin: {} }
}));
vi.mock('$lib/server/settings/crypto', () => ({
  hashPassword: () => ({ salt: 'salt', hash: 'hash' }),
  parseMasterKey: () => Buffer.alloc(32)
}));
vi.mock('$lib/server/auth', () => ({
  createSession: mocks.createSession,
  SESSION_COOKIE: 'vb_session',
  SESSION_TTL_MS: 43_200_000
}));
vi.mock('$lib/server/settings/store', () => ({
  getSafeSettings: mocks.getSafeSettings,
  getSecret: mocks.getSecret,
  getSettings: mocks.getSettings,
  getStoredSettings: mocks.getStoredSettings,
  replaceSecret: mocks.replaceSecret,
  saveSettings: mocks.saveSettings
}));
vi.mock('$lib/server/settings/connection-test', () => ({
  testGatekeeper: mocks.testGatekeeper
}));
vi.mock('$lib/server/settings/runtime', () => ({
  runtime: { restart: mocks.restart }
}));

const settings = (onboardingStep = 0) => ({
  version: 1 as const,
  onboardingStep,
  onboardingComplete: false,
  activated: false,
  gatekeeper: null,
  sources: {
    curated_list: { enabled: true, baseUrl: null, secretConfigured: false },
    metadefender: {
      enabled: false,
      baseUrl: 'https://api.metadefender.com/v4',
      secretConfigured: false
    },
    ai: {
      enabled: false,
      baseUrl: null,
      model: null,
      priceInputPerMTok: null,
      priceOutputPerMTok: null,
      secretConfigured: false
    },
    virustotal: {
      enabled: false,
      baseUrl: 'https://www.virustotal.com/api/v3',
      secretConfigured: false
    }
  },
  quotas: {
    curated_list: {
      perMinute: null,
      perDay: null,
      perMonth: null,
      dailyCostCeilingUsd: null
    },
    metadefender: {
      perMinute: null,
      perDay: 4000,
      perMonth: null,
      dailyCostCeilingUsd: null
    },
    ai: {
      perMinute: null,
      perDay: null,
      perMonth: null,
      dailyCostCeilingUsd: null
    },
    virustotal: {
      perMinute: 4,
      perDay: 500,
      perMonth: 15500,
      dailyCostCeilingUsd: null
    }
  },
  weights: { curated_list: 1, metadefender: 1, ai: 0.6, virustotal: 1 },
  scheduler: {
    ingestIntervalMinutes: 15,
    firstRunLookbackHours: 24,
    firstRunCap: 5000,
    maxReviewWaitHours: 6,
    blocklistPath: '/blocklist.txt'
  },
  curatedListUrls: []
});

const storedSettings = (onboardingStep = 0) => {
  const value: any = structuredClone(settings(onboardingStep));
  for (const source of Object.values(value.sources) as any[])
    delete source.secretConfigured;
  return value;
};

function event(body: Record<string, string> = {}) {
  return {
    request: new Request('http://local/setup', {
      method: 'POST',
      body: new URLSearchParams(body)
    }),
    cookies: { set: vi.fn() },
    url: new URL('http://local/setup')
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.values.mockResolvedValue(undefined);
  mocks.createSession.mockResolvedValue('opaque');
  mocks.getSafeSettings.mockResolvedValue(settings());
  mocks.getSecret.mockResolvedValue(null);
  mocks.getSettings.mockResolvedValue(settings(4));
  mocks.getStoredSettings.mockResolvedValue(storedSettings());
  mocks.saveSettings.mockImplementation(async (_db, _schema, _key, patch) => ({
    ...settings(),
    ...patch
  }));
  mocks.testGatekeeper.mockResolvedValue({ kind: 'connected' });
  mocks.restart.mockResolvedValue(undefined);
});

afterEach(() => vi.resetModules());

describe('setup actions', () => {
  it('creates matching secure access and establishes the admin session', async () => {
    const request = event({
      password: 'correct horse battery staple',
      passwordConfirm: 'correct horse battery staple'
    });
    const { actions } = await import('../../../src/routes/setup/+page.server');

    await (actions.access as any)(request);

    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, salt: 'salt', passwordHash: 'hash' })
    );
    expect(mocks.saveSettings).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      { onboardingStep: 1 }
    );
    expect(request.cookies.set).toHaveBeenCalledWith('vb_session', 'opaque', {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      secure: false,
      maxAge: 43_200
    });
  });

  it('reports a precise gatekeeper failure without saving credentials', async () => {
    mocks.getSafeSettings.mockResolvedValue(settings(1));
    mocks.testGatekeeper.mockResolvedValue({ kind: 'auth_rejected' });
    const { actions } = await import('../../../src/routes/setup/+page.server');

    const result = await (actions.gatekeeper as any)(
      event({
        type: 'pihole',
        baseUrl: 'http://pi.hole',
        username: '',
        password: 'do-not-return'
      })
    );

    expect(result).toMatchObject({
      status: 400,
      data: {
        step: 2,
        testStatus: 'auth_rejected',
        values: { type: 'pihole', baseUrl: 'http://pi.hole', username: '' }
      }
    });
    expect(JSON.stringify(result)).not.toContain('do-not-return');
    expect(mocks.replaceSecret).not.toHaveBeenCalled();
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it('keeps configured secrets when a valid sources form leaves them empty', async () => {
    const current = settings(2);
    current.sources.metadefender.secretConfigured = true;
    mocks.getSafeSettings.mockResolvedValue(current);
    mocks.getStoredSettings.mockResolvedValue(storedSettings(2));
    const { actions } = await import('../../../src/routes/setup/+page.server');

    await (actions.sources as any)(
      event({
        curatedListUrls: 'https://example.com/blocklist.txt',
        metadefenderEnabled: 'on',
        metadefenderBaseUrl: 'https://api.metadefender.com/v4',
        metadefenderApiKey: '',
        aiBaseUrl: '',
        aiModel: '',
        aiApiKey: '',
        virustotalBaseUrl: 'https://www.virustotal.com/api/v3',
        virustotalApiKey: ''
      })
    );

    expect(mocks.replaceSecret).not.toHaveBeenCalled();
    expect(mocks.saveSettings).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ onboardingStep: 3 })
    );
  });

  it('does not activate without a successful gatekeeper test', async () => {
    mocks.getSettings.mockResolvedValue(settings(1));
    const { actions } = await import('../../../src/routes/setup/+page.server');

    expect(await (actions.activate as any)(event())).toMatchObject({
      status: 400,
      data: { step: 5 }
    });
    expect(mocks.restart).not.toHaveBeenCalled();
  });

  it('activates valid completed settings, starts the runtime, and redirects to the log', async () => {
    const current = storedSettings(4);
    current.gatekeeper = { type: 'pihole', baseUrl: 'http://pi.hole' };
    mocks.getSettings.mockResolvedValue(current);
    const { actions } = await import('../../../src/routes/setup/+page.server');

    await expect((actions.activate as any)(event())).rejects.toMatchObject({
      status: 303,
      location: '/'
    });

    expect(mocks.saveSettings).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      {
        onboardingStep: 5,
        onboardingComplete: true,
        activated: true
      }
    );
    expect(mocks.restart).toHaveBeenCalledOnce();
  });

  it('resumes at the first incomplete step and never returns secrets', async () => {
    mocks.getSafeSettings.mockResolvedValue(settings(3));
    const { getSetupView } =
      await import('../../../src/routes/setup/setup-view');

    const view = await getSetupView();

    expect(view.step).toBe(4);
    expect(view.settings).toEqual(settings(3));
    expect(JSON.stringify(view)).not.toContain('do-not-return');
  });
});

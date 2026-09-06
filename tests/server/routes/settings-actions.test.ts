import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestDb, type TestDb } from '../../helpers/test-db';
import {
  createSession,
  getSession,
  verifyAdminPassword
} from '../../../src/lib/server/auth';
import {
  getSecret,
  getStoredSettings,
  saveSetupSection
} from '../../../src/lib/server/settings/store';
import {
  hashPassword,
  parseMasterKey
} from '../../../src/lib/server/settings/crypto';
import type { StoredSettings } from '../../../src/lib/server/settings/types';

const mocks = vi.hoisted(() => ({
  restart: vi.fn(),
  testGatekeeper: vi.fn()
}));

vi.mock('$lib/server/settings/runtime', () => ({
  runtime: { restart: mocks.restart }
}));
vi.mock('$lib/server/settings/connection-test', () => ({
  testGatekeeper: mocks.testGatekeeper
}));

const masterKey = Buffer.alloc(32, 7);
const configured: StoredSettings = {
  version: 1,
  onboardingStep: 5,
  onboardingComplete: true,
  activated: true,
  gatekeeper: { type: 'pihole', baseUrl: 'http://pi.hole' },
  sources: {
    curated_list: { enabled: true, baseUrl: null },
    metadefender: {
      enabled: false,
      baseUrl: 'https://api.metadefender.com/v4'
    },
    ai: {
      enabled: false,
      baseUrl: null,
      model: null,
      priceInputPerMTok: null,
      priceOutputPerMTok: null
    },
    virustotal: {
      enabled: false,
      baseUrl: 'https://www.virustotal.com/api/v3'
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
  curatedListUrls: ['https://example.com/domains.txt']
};

let t: TestDb;

function event(body: Record<string, string> = {}, token?: string) {
  return {
    request: new Request('http://local/settings', {
      method: 'POST',
      body: new URLSearchParams(body)
    }),
    cookies: {
      get: vi.fn(() => token),
      delete: vi.fn()
    },
    url: new URL('http://local/settings')
  } as any;
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  t = await makeTestDb();
  process.env.VB_MASTER_KEY = masterKey.toString('base64');
  vi.doMock('$lib/server/db/index', () => ({ db: t.db, schema: t.schema }));
  mocks.restart.mockResolvedValue(undefined);
  mocks.testGatekeeper.mockResolvedValue({ kind: 'connected' });
  const record = hashPassword('current password is long');
  await saveSetupSection(t.db, t.schema, masterKey, {
    patch: configured,
    secrets: {
      gatekeeperPassword: 'existing-gatekeeper',
      metadefenderApiKey: 'existing-source-secret'
    },
    admin: { salt: record.salt, passwordHash: record.hash }
  });
});

afterEach(() => {
  t.close();
  delete process.env.VB_MASTER_KEY;
});

describe('settings actions', () => {
  it('keeps concurrent source and AI price changes without stale section snapshots', async () => {
    const { actions } =
      await import('../../../src/routes/settings/+page.server');
    await Promise.all([
      (actions.quotas as any)(
        event({ aiPriceInputPerMTok: '2', aiPriceOutputPerMTok: '5' })
      ),
      (actions.sources as any)(
        event({
          curatedListEnabled: 'on',
          curatedListUrls: 'https://example.com/new.txt',
          aiBaseUrl: 'https://ai.example/v1',
          aiModel: 'new-model',
          metadefenderBaseUrl: 'https://api.metadefender.com/v4',
          virustotalBaseUrl: 'https://www.virustotal.com/api/v3'
        })
      )
    ]);
    expect(await getStoredSettings(t.db, t.schema)).toMatchObject({
      sources: {
        ai: { model: 'new-model', priceInputPerMTok: 2, priceOutputPerMTok: 5 }
      },
      curatedListUrls: ['https://example.com/new.txt']
    });
  });
  it('loads only the masked safe settings view', async () => {
    const { load } = await import('../../../src/routes/settings/+page.server');

    const result = await (load as any)({});

    expect(result.settings.gatekeeper.secretConfigured).toBe(true);
    expect(result.settings.sources.metadefender.secretConfigured).toBe(true);
    expect(JSON.stringify(result)).not.toContain('existing-source-secret');
    expect(JSON.stringify(result)).not.toContain('existing-gatekeeper');
  });

  it('keeps an empty secret replacement unchanged', async () => {
    const { actions } =
      await import('../../../src/routes/settings/+page.server');

    await (actions.sources as any)(
      event({
        curatedListEnabled: 'on',
        curatedListUrls: 'https://example.com/blocklist.txt',
        metadefenderBaseUrl: 'https://api.metadefender.com/v4',
        metadefenderApiKey: '',
        aiBaseUrl: '',
        aiModel: '',
        aiApiKey: '',
        virustotalBaseUrl: 'https://www.virustotal.com/api/v3',
        virustotalApiKey: ''
      })
    );

    expect(
      await getSecret(
        t.db,
        t.schema,
        parseMasterKey(process.env.VB_MASTER_KEY ?? ''),
        'metadefenderApiKey'
      )
    ).toBe('existing-source-secret');
    expect((await getStoredSettings(t.db, t.schema))?.curatedListUrls).toEqual([
      'https://example.com/blocklist.txt'
    ]);
    expect((await getStoredSettings(t.db, t.schema))?.weights).toEqual(
      configured.weights
    );
  });

  it('saves gatekeeper, quota, scoring, and system sections independently', async () => {
    const { actions } =
      await import('../../../src/routes/settings/+page.server');

    await (actions.gatekeeper as any)(
      event({ type: 'pihole', baseUrl: 'http://dns.local', password: '' })
    );
    expect(mocks.testGatekeeper).toHaveBeenCalledWith(
      { gatekeeper: { type: 'pihole', baseUrl: 'http://dns.local' } },
      'existing-gatekeeper'
    );

    await (actions.quotas as any)(
      event({
        curatedListPerMinute: '',
        curatedListPerDay: '100',
        curatedListPerMonth: '',
        metadefenderPerMinute: '',
        metadefenderPerDay: '3000',
        metadefenderPerMonth: '',
        aiPerMinute: '',
        aiPerDay: '',
        aiPerMonth: '',
        virustotalPerMinute: '3',
        virustotalPerDay: '400',
        virustotalPerMonth: '12000',
        aiDailyCostCeilingUsd: '2',
        aiPriceInputPerMTok: '1.5',
        aiPriceOutputPerMTok: '4'
      })
    );
    await (actions.weights as any)(
      event({
        curatedListWeight: '1.5',
        metadefenderWeight: '1',
        aiWeight: '0.5',
        virustotalWeight: '0.75'
      })
    );
    await (actions.system as any)(
      event({
        ingestIntervalMinutes: '20',
        firstRunLookbackHours: '12',
        firstRunCap: '2500',
        maxReviewWaitHours: '8',
        blocklistPath: '/custom-blocklist.txt'
      })
    );

    const saved = await getStoredSettings(t.db, t.schema);
    expect(saved).toMatchObject({
      gatekeeper: { type: 'pihole', baseUrl: 'http://dns.local' },
      quotas: {
        curated_list: { perDay: 100 },
        ai: { dailyCostCeilingUsd: 2 },
        virustotal: { perMinute: 3, perDay: 400, perMonth: 12000 }
      },
      weights: {
        curated_list: 1.5,
        metadefender: 1,
        ai: 0.5,
        virustotal: 0.75
      },
      activated: false,
      scheduler: {
        ingestIntervalMinutes: 20,
        firstRunLookbackHours: 12,
        firstRunCap: 2500,
        maxReviewWaitHours: 8,
        blocklistPath: '/blocklist.txt'
      }
    });
    expect(saved?.curatedListUrls).toEqual(['https://example.com/domains.txt']);
    expect(mocks.restart).toHaveBeenCalledTimes(4);
  });

  it('reports that settings persisted when the runtime restart fails', async () => {
    mocks.restart.mockRejectedValueOnce(new Error('scheduler unavailable'));
    const { actions } =
      await import('../../../src/routes/settings/+page.server');

    const result = await (actions.weights as any)(
      event({
        curatedListWeight: '2',
        metadefenderWeight: '1',
        aiWeight: '0.5',
        virustotalWeight: '0.75'
      })
    );

    expect(result).toMatchObject({
      status: 500,
      data: {
        section: 'weights',
        saved: true,
        restartFailed: true,
        error: expect.stringMatching(/saved.*runtime.*stopped/i)
      }
    });
    expect(
      (await getStoredSettings(t.db, t.schema))?.weights.curated_list
    ).toBe(2);
  });

  it('returns the source cross-field error without changing settings', async () => {
    const { actions } =
      await import('../../../src/routes/settings/+page.server');

    const result = await (actions.sources as any)(event());

    expect(result).toMatchObject({
      status: 400,
      data: {
        section: 'sources',
        errors: {
          curatedListEnabled: 'Enable at least one reputation source'
        }
      }
    });
    expect((await getStoredSettings(t.db, t.schema))?.sources).toEqual(
      configured.sources
    );
  });

  it('requires the current password and invalidates all sessions after a change', async () => {
    const first = await createSession(t.db, t.schema);
    const second = await createSession(t.db, t.schema);
    const { actions } =
      await import('../../../src/routes/settings/+page.server');

    const rejected = await (actions.password as any)(
      event({
        currentPassword: 'wrong password',
        newPassword: 'replacement password',
        passwordConfirm: 'replacement password'
      })
    );
    expect(rejected).toMatchObject({
      status: 400,
      data: {
        section: 'access',
        errors: { currentPassword: expect.any(String) }
      }
    });

    await expect(
      (actions.password as any)(
        event({
          currentPassword: 'current password is long',
          newPassword: 'replacement password',
          passwordConfirm: 'replacement password'
        })
      )
    ).rejects.toMatchObject({ status: 303, location: '/login?changed=1' });

    expect(await getSession(t.db, t.schema, first)).toBeNull();
    expect(await getSession(t.db, t.schema, second)).toBeNull();
    expect(
      await verifyAdminPassword(t.db, t.schema, 'replacement password')
    ).toBe(true);
    expect(JSON.stringify(rejected)).not.toContain('wrong password');
  });

  it('signs out by invalidating only the current session', async () => {
    const current = await createSession(t.db, t.schema);
    const other = await createSession(t.db, t.schema);
    const request = event({}, current);
    const { actions } =
      await import('../../../src/routes/settings/+page.server');

    await expect((actions.signout as any)(request)).rejects.toMatchObject({
      status: 303,
      location: '/login?signedout=1'
    });

    expect(await getSession(t.db, t.schema, current)).toBeNull();
    expect(await getSession(t.db, t.schema, other)).not.toBeNull();
    expect(request.cookies.delete).toHaveBeenCalledWith('vb_session', {
      path: '/'
    });
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { makeTestDb } from '../../helpers/test-db';
import {
  getSafeSettings,
  getSecret,
  getSettings,
  getStoredSettings,
  importEnvironmentOnce,
  replaceSecret,
  saveSetupSection,
  saveSettings
} from '$lib/server/settings/store';
import type { StoredSettings } from '$lib/server/settings/types';

let close: (() => void) | undefined;
afterEach(() => close?.());

const key = Buffer.alloc(32, 3);
const settings: StoredSettings = {
  version: 1,
  onboardingStep: 0,
  onboardingComplete: false,
  activated: false,
  gatekeeper: null,
  sources: {
    curated_list: {
      enabled: true,
      baseUrl: null
    },
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

async function testDb() {
  const t = await makeTestDb();
  close = t.close;
  return t;
}

describe('settings store', () => {
  it('preserves different categories saved concurrently through both store entrypoints', async () => {
    const t = await testDb();
    await saveSettings(t.db, t.schema, key, settings);
    await Promise.all([
      saveSettings(t.db, t.schema, key, {
        weights: { ...settings.weights, ai: 2 }
      }),
      saveSetupSection(t.db, t.schema, key, {
        patch: { scheduler: { ...settings.scheduler, firstRunCap: 100 } }
      })
    ]);
    expect(await getStoredSettings(t.db, t.schema)).toMatchObject({
      weights: { ai: 2 },
      scheduler: { firstRunCap: 100 }
    });
  });

  it('allows unrelated saves and shutdown with a damaged source, but rejects activation', async () => {
    const t = await testDb();
    await replaceSecret(t.db, t.schema, key, 'metadefenderApiKey', 'private');
    await saveSettings(t.db, t.schema, key, {
      ...settings,
      onboardingComplete: true,
      activated: true,
      sources: {
        ...settings.sources,
        metadefender: { ...settings.sources.metadefender, enabled: true }
      }
    });
    await t.db.update(t.schema.configSecrets).set({ payload: '{"v":1}' });
    await saveSetupSection(t.db, t.schema, key, {
      patch: { weights: { ...settings.weights, ai: 2 } },
      expectedOnboardingComplete: true
    });
    await saveSetupSection(t.db, t.schema, key, {
      patch: { activated: false },
      expectedOnboardingComplete: true
    });
    expect(await getStoredSettings(t.db, t.schema)).toMatchObject({
      activated: false,
      weights: { ai: 2 }
    });
    await expect(
      saveSetupSection(t.db, t.schema, key, {
        patch: { activated: true },
        expectedOnboardingComplete: true
      })
    ).rejects.toThrow(/credential/i);
  });

  it('requires explicit curated URLs before completing the source step', async () => {
    const t = await testDb();
    await saveSettings(t.db, t.schema, key, { onboardingStep: 1 });
    await expect(
      saveSetupSection(t.db, t.schema, key, {
        patch: { onboardingStep: 3 }
      })
    ).rejects.toThrow(/curated.*URL/i);
  });

  it('requires both AI prices when a positive daily cost ceiling is enabled', async () => {
    const t = await testDb();
    await replaceSecret(t.db, t.schema, key, 'aiApiKey', 'private');
    const patch = {
      ...settings,
      sources: {
        ...settings.sources,
        ai: {
          ...settings.sources.ai,
          enabled: true,
          baseUrl: 'https://ai.example/v1',
          model: 'test'
        }
      },
      quotas: {
        ...settings.quotas,
        ai: { ...settings.quotas.ai, dailyCostCeilingUsd: 1 }
      }
    };
    await expect(saveSettings(t.db, t.schema, key, patch)).rejects.toThrow(
      /AI.*price/i
    );
    patch.sources.ai.priceInputPerMTok = 1 as any;
    patch.sources.ai.priceOutputPerMTok = 2 as any;
    await saveSettings(t.db, t.schema, key, patch);
    expect(
      (await getStoredSettings(t.db, t.schema))?.sources.ai.priceOutputPerMTok
    ).toBe(2);
  });
  it('reads non-secret settings without decrypting disabled credentials', async () => {
    const t = await testDb();
    await saveSettings(t.db, t.schema, key, settings);
    await replaceSecret(t.db, t.schema, key, 'virustotalApiKey', 'unused');
    await t.db
      .update(t.schema.configSecrets)
      .set({ payload: '{"v":1}' })
      .where(eq(t.schema.configSecrets.name, 'virustotalApiKey'));

    await expect(getStoredSettings(t.db, t.schema)).resolves.toMatchObject({
      onboardingComplete: false,
      activated: false
    });
  });

  it('returns markers but never plaintext secrets', async () => {
    const t = await testDb();
    await saveSettings(t.db, t.schema, key, settings);
    await replaceSecret(t.db, t.schema, key, 'metadefenderApiKey', 'private');

    const safe = await getSafeSettings(t.db, t.schema, key);

    expect(JSON.stringify(safe)).not.toContain('private');
    expect(safe?.sources.metadefender.secretConfigured).toBe(true);
    const rows = await t.db.select().from(t.schema.configSecrets);
    expect(JSON.stringify(rows)).not.toContain('private');
  });

  it('imports legacy environment only once', async () => {
    const t = await testDb();
    const legacyEnv = {
      VB_PIHOLE_BASE_URL: 'http://pi.hole/api',
      VB_PIHOLE_APP_PASSWORD: 'legacy',
      VB_CURATED_LIST_URLS: 'https://example.com/imported.txt',
      VB_BLOCKLIST_PATH: '/old-custom.txt'
    };
    await importEnvironmentOnce(t.db, t.schema, key, legacyEnv);
    const changed = { type: 'pihole' as const, baseUrl: 'http://new.local' };
    await saveSettings(t.db, t.schema, key, { gatekeeper: changed });

    await importEnvironmentOnce(t.db, t.schema, key, legacyEnv);

    expect((await getSettings(t.db, t.schema, key))?.gatekeeper).toEqual(
      changed
    );
    expect(await getStoredSettings(t.db, t.schema)).toMatchObject({
      scheduler: { blocklistPath: '/blocklist.txt' },
      curatedListUrls: ['https://example.com/imported.txt']
    });
  });

  it('rejects invalid limits and enabled sources without usable credentials', async () => {
    const t = await testDb();
    await expect(
      saveSettings(t.db, t.schema, key, {
        ...settings,
        quotas: {
          ...settings.quotas,
          metadefender: { ...settings.quotas.metadefender, perDay: -1 }
        }
      })
    ).rejects.toThrow();

    await expect(
      saveSettings(t.db, t.schema, key, {
        ...settings,
        sources: {
          ...settings.sources,
          metadefender: {
            ...settings.sources.metadefender,
            enabled: true
          }
        }
      })
    ).rejects.toThrow(/credential/i);
  });

  it('rejects all-zero weights for enabled sources', async () => {
    const t = await testDb();
    await expect(
      saveSettings(t.db, t.schema, key, {
        ...settings,
        weights: { ...settings.weights, curated_list: 0 }
      })
    ).rejects.toThrow(/weight/i);
  });

  it('rejects configurations without an enabled reputation source', async () => {
    const t = await testDb();
    await expect(
      saveSettings(t.db, t.schema, key, {
        ...settings,
        sources: {
          ...settings.sources,
          curated_list: { ...settings.sources.curated_list, enabled: false }
        }
      })
    ).rejects.toThrow(/source.*enabled/i);
  });

  it('commits setup config, credentials, and the admin as one operation', async () => {
    const t = await testDb();

    await saveSetupSection(t.db, t.schema, key, {
      patch: {
        onboardingStep: 2,
        gatekeeper: { type: 'pihole', baseUrl: 'http://pi.hole' }
      },
      secrets: { gatekeeperPassword: 'private' },
      admin: { salt: 'salt', passwordHash: 'hash' }
    });

    expect(await getSecret(t.db, t.schema, key, 'gatekeeperPassword')).toBe(
      'private'
    );
    expect(await getStoredSettings(t.db, t.schema)).toMatchObject({
      onboardingStep: 2,
      gatekeeper: { type: 'pihole', baseUrl: 'http://pi.hole' }
    });
    expect(await t.db.select().from(t.schema.localAdmin)).toMatchObject([
      { id: 1, salt: 'salt', passwordHash: 'hash' }
    ]);
  });

  it('rolls back every setup-section write when its audit fails', async () => {
    const t = await testDb();
    await t.db.insert(t.schema.auditLog).values({
      at: 1,
      actor: 'system',
      domainId: null,
      event: 'settings.changed',
      data: {}
    });
    const failAudit = sql`create unique index fail_setup_audit on audit_log (event)`;
    await (t.dialect === 'sqlite'
      ? t.db.run(failAudit)
      : t.db.execute(failAudit));

    await expect(
      saveSetupSection(t.db, t.schema, key, {
        patch: {
          onboardingStep: 2,
          gatekeeper: { type: 'pihole', baseUrl: 'http://pi.hole' }
        },
        secrets: { gatekeeperPassword: 'private' },
        admin: { salt: 'salt', passwordHash: 'hash' }
      })
    ).rejects.toThrow();

    expect(await t.db.select().from(t.schema.appConfig)).toHaveLength(0);
    expect(await t.db.select().from(t.schema.configSecrets)).toHaveLength(0);
    expect(await t.db.select().from(t.schema.localAdmin)).toHaveLength(0);
  });

  it('rejects a stale setup save racing with activation', async () => {
    const t = await testDb();
    await saveSetupSection(t.db, t.schema, key, {
      patch: {
        ...settings,
        onboardingStep: 4,
        gatekeeper: { type: 'pihole', baseUrl: 'http://pi.hole' }
      },
      secrets: { gatekeeperPassword: 'private' }
    });

    const [activation, staleSave] = await Promise.allSettled([
      saveSetupSection(t.db, t.schema, key, {
        patch: {
          onboardingStep: 5,
          onboardingComplete: true,
          activated: true
        }
      }),
      saveSetupSection(t.db, t.schema, key, {
        patch: {
          gatekeeper: { type: 'pihole', baseUrl: 'http://stale.local' }
        }
      })
    ]);

    expect(activation.status).toBe('fulfilled');
    expect(staleSave.status).toBe('rejected');
    expect(await getStoredSettings(t.db, t.schema)).toMatchObject({
      onboardingComplete: true,
      activated: true,
      gatekeeper: { baseUrl: 'http://pi.hole' }
    });
  });

  it('treats tampered ciphertext as unconfigured and never exposes it', async () => {
    const t = await testDb();
    await saveSettings(t.db, t.schema, key, settings);
    await replaceSecret(t.db, t.schema, key, 'metadefenderApiKey', 'private');
    await t.db
      .update(t.schema.configSecrets)
      .set({ payload: '{"v":1}' })
      .where(eq(t.schema.configSecrets.name, 'metadefenderApiKey'));

    await expect(
      getSecret(t.db, t.schema, key, 'metadefenderApiKey')
    ).rejects.toThrow(/decrypt/i);
    const safe = await getSafeSettings(t.db, t.schema, key);
    expect(safe?.sources.metadefender.secretConfigured).toBe(false);
    expect(JSON.stringify(safe)).not.toContain('private');
  });

  it('audits only changed categories, never setting values', async () => {
    const t = await testDb();
    await saveSettings(t.db, t.schema, key, settings);
    await replaceSecret(t.db, t.schema, key, 'gatekeeperPassword', 'password');
    await saveSettings(t.db, t.schema, key, {
      gatekeeper: { type: 'pihole', baseUrl: 'http://sensitive.local' }
    });

    const rows = await t.db.select().from(t.schema.auditLog);
    expect(rows.at(-1)).toMatchObject({
      actor: 'local_admin',
      event: 'settings.changed',
      data: { categories: ['gatekeeper'] }
    });
    expect(JSON.stringify(rows)).not.toContain('sensitive.local');
  });

  it('rejects URL credentials before a safe view can expose them', async () => {
    const t = await testDb();
    await saveSettings(t.db, t.schema, key, settings);
    await replaceSecret(t.db, t.schema, key, 'gatekeeperPassword', 'stored');

    await expect(
      saveSettings(t.db, t.schema, key, {
        gatekeeper: {
          type: 'pihole',
          baseUrl: 'http://operator:private@pi.hole/api'
        }
      })
    ).rejects.toThrow(/credential|userinfo/i);
    expect(
      JSON.stringify(await getSafeSettings(t.db, t.schema, key))
    ).not.toContain('private');
  });

  it('rolls back config and secret mutations when their audit insert fails', async () => {
    const t = await testDb();
    await t.db.insert(t.schema.auditLog).values({
      at: 1,
      actor: 'system',
      domainId: null,
      event: 'settings.changed',
      data: {}
    });
    const failAudit = sql`create unique index fail_settings_audit on audit_log (event)`;
    await (t.dialect === 'sqlite'
      ? t.db.run(failAudit)
      : t.db.execute(failAudit));

    await expect(saveSettings(t.db, t.schema, key, settings)).rejects.toThrow();
    await expect(
      replaceSecret(t.db, t.schema, key, 'metadefenderApiKey', 'private')
    ).rejects.toThrow();
    await expect(
      importEnvironmentOnce(t.db, t.schema, key, {
        VB_PIHOLE_BASE_URL: 'http://pi.hole/api',
        VB_PIHOLE_APP_PASSWORD: 'legacy'
      })
    ).rejects.toThrow();

    expect(await t.db.select().from(t.schema.appConfig)).toHaveLength(0);
    expect(await t.db.select().from(t.schema.configSecrets)).toHaveLength(0);
  });

  it('merges a fresh partial save over safe defaults', async () => {
    const t = await testDb();

    await saveSettings(t.db, t.schema, key, { onboardingStep: 1 });

    const saved = await getSettings(t.db, t.schema, key);
    expect(saved).toMatchObject({
      onboardingStep: 1,
      activated: false,
      gatekeeper: null,
      weights: { curated_list: 1, ai: 0.6 }
    });
  });

  it('lets only one concurrent environment importer claim the singleton', async () => {
    const t = await testDb();
    const legacyEnv = {
      VB_PIHOLE_BASE_URL: 'http://pi.hole/api',
      VB_PIHOLE_APP_PASSWORD: 'legacy'
    };

    const results = await Promise.all([
      importEnvironmentOnce(t.db, t.schema, key, legacyEnv),
      importEnvironmentOnce(t.db, t.schema, key, legacyEnv)
    ]);

    expect(results.sort()).toEqual([false, true]);
    expect(await t.db.select().from(t.schema.appConfig)).toHaveLength(1);
    expect(await t.db.select().from(t.schema.configSecrets)).toHaveLength(1);
    expect(await t.db.select().from(t.schema.auditLog)).toHaveLength(1);
  });
});

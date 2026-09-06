import { afterEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { makeTestDb } from '../../helpers/test-db';
import {
  getSafeSettings,
  getSecret,
  getSettings,
  importEnvironmentOnce,
  replaceSecret,
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
  curatedListUrls: []
};

async function testDb() {
  const t = await makeTestDb();
  close = t.close;
  return t;
}

describe('settings store', () => {
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
      VB_PIHOLE_APP_PASSWORD: 'legacy'
    };
    await importEnvironmentOnce(t.db, t.schema, key, legacyEnv);
    const changed = { type: 'pihole' as const, baseUrl: 'http://new.local' };
    await saveSettings(t.db, t.schema, key, { gatekeeper: changed });

    await importEnvironmentOnce(t.db, t.schema, key, legacyEnv);

    expect((await getSettings(t.db, t.schema, key))?.gatekeeper).toEqual(
      changed
    );
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

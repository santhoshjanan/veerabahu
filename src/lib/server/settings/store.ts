import { encryptSecret, decryptSecret } from './crypto';
import {
  getAppConfig,
  getConfigSecret,
  listConfigSecrets,
  putAppConfig,
  putConfigSecret
} from '../db/repo';
import { loadConfig } from '../config';
import { parseStoredSettings, validateSettings } from './validate';
import type {
  SafeSettings,
  SettingsPatch,
  SettingsSecretName,
  StoredSettings
} from './types';

type Env = Record<string, string | undefined>;
type ConfigBody = Omit<
  StoredSettings,
  'version' | 'onboardingStep' | 'onboardingComplete' | 'activated'
>;

const secretCategory = (name: SettingsSecretName) =>
  name === 'gatekeeperPassword' ? 'gatekeeper' : 'sources';

const patchCategories = (patch: SettingsPatch): string[] => [
  ...new Set(
    Object.keys(patch)
      .filter((name) => name !== 'version')
      .map((name) =>
        name === 'gatekeeper'
          ? 'gatekeeper'
          : name === 'sources' || name === 'curatedListUrls'
            ? 'sources'
            : name === 'quotas' || name === 'weights'
              ? name
              : 'system'
      )
  )
];

async function audit(
  db: any,
  schema: any,
  actor: 'local_admin' | 'system',
  categories: string[]
) {
  if (!categories.length) return;
  await db.insert(schema.auditLog).values({
    at: Date.now(),
    actor,
    domainId: null,
    event: 'settings.changed',
    data: { categories }
  });
}

function fromRow(row: any): StoredSettings {
  return parseStoredSettings({
    ...(row.config as ConfigBody),
    version: row.version,
    onboardingStep: row.onboardingStep,
    onboardingComplete: row.onboardingComplete,
    activated: row.activated
  });
}

function bodyOf(settings: StoredSettings): ConfigBody {
  const {
    version: _version,
    onboardingStep: _onboardingStep,
    onboardingComplete: _onboardingComplete,
    activated: _activated,
    ...config
  } = settings;
  return config;
}

async function usableSecrets(
  db: any,
  schema: any,
  key: Buffer
): Promise<Set<SettingsSecretName>> {
  const usable = new Set<SettingsSecretName>();
  for (const row of await listConfigSecrets(db, schema)) {
    try {
      decryptSecret(key, row.payload);
      usable.add(row.name as SettingsSecretName);
    } catch {
      // A damaged credential is presented as unconfigured; plaintext never leaves.
    }
  }
  return usable;
}

async function writeSettings(
  db: any,
  schema: any,
  settings: StoredSettings
): Promise<void> {
  const old = await getAppConfig(db, schema);
  const at = Date.now();
  await putAppConfig(db, schema, {
    version: settings.version,
    config: bodyOf(settings),
    onboardingStep: settings.onboardingStep,
    onboardingComplete: settings.onboardingComplete,
    activated: settings.activated,
    createdAt: old?.createdAt ?? at,
    updatedAt: at
  });
}

export async function getSettings(
  db: any,
  schema: any,
  key: Buffer
): Promise<StoredSettings | null> {
  const row = await getAppConfig(db, schema);
  if (!row) return null;
  return validateSettings(fromRow(row), await usableSecrets(db, schema, key));
}

export async function getSecret(
  db: any,
  schema: any,
  key: Buffer,
  name: SettingsSecretName
): Promise<string | null> {
  const row = await getConfigSecret(db, schema, name);
  return row ? decryptSecret(key, row.payload) : null;
}

export async function getSafeSettings(
  db: any,
  schema: any,
  key: Buffer
): Promise<SafeSettings | null> {
  const row = await getAppConfig(db, schema);
  if (!row) return null;
  const settings = fromRow(row);
  const secrets = await usableSecrets(db, schema, key);
  return {
    ...settings,
    gatekeeper: settings.gatekeeper
      ? {
          ...settings.gatekeeper,
          secretConfigured: secrets.has('gatekeeperPassword')
        }
      : null,
    sources: {
      curated_list: {
        ...settings.sources.curated_list,
        secretConfigured: false
      },
      metadefender: {
        ...settings.sources.metadefender,
        secretConfigured: secrets.has('metadefenderApiKey')
      },
      ai: {
        ...settings.sources.ai,
        secretConfigured: secrets.has('aiApiKey')
      },
      virustotal: {
        ...settings.sources.virustotal,
        secretConfigured: secrets.has('virustotalApiKey')
      }
    }
  };
}

export async function saveSettings(
  db: any,
  schema: any,
  key: Buffer,
  patch: SettingsPatch
): Promise<StoredSettings> {
  const row = await getAppConfig(db, schema);
  const settings = validateSettings(
    row ? { ...fromRow(row), ...patch } : patch,
    await usableSecrets(db, schema, key)
  );
  await writeSettings(db, schema, settings);
  await audit(db, schema, 'local_admin', patchCategories(patch));
  return settings;
}

export async function replaceSecret(
  db: any,
  schema: any,
  key: Buffer,
  name: SettingsSecretName,
  plaintext: string
): Promise<void> {
  if (!plaintext) throw new Error('Credential must not be empty');
  const old = await getConfigSecret(db, schema, name);
  const at = Date.now();
  await putConfigSecret(db, schema, {
    name,
    payload: encryptSecret(key, plaintext),
    createdAt: old?.createdAt ?? at,
    updatedAt: at
  });
  await audit(db, schema, 'local_admin', [secretCategory(name)]);
}

const defaultSettings = (): StoredSettings => ({
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
});

export async function importEnvironmentOnce(
  db: any,
  schema: any,
  key: Buffer,
  env: Env
): Promise<boolean> {
  if (await getAppConfig(db, schema)) return false;
  if (!env.VB_PIHOLE_BASE_URL && !env.VB_PIHOLE_APP_PASSWORD) return false;

  const legacy = loadConfig(env);
  const settings = defaultSettings();
  settings.gatekeeper = { type: 'pihole', baseUrl: legacy.pihole.baseUrl };
  settings.curatedListUrls = legacy.curatedListUrls;
  settings.scheduler = {
    ingestIntervalMinutes: legacy.ingestIntervalMs / 60_000,
    firstRunLookbackHours: legacy.firstRunLookbackMs / 3_600_000,
    firstRunCap: legacy.firstRunCap,
    maxReviewWaitHours: legacy.maxReviewWaitMs / 3_600_000,
    blocklistPath: legacy.blocklistPath
  };
  settings.sources.metadefender.enabled = legacy.metadefender !== null;
  if (legacy.llm) {
    Object.assign(settings.sources.ai, {
      enabled: true,
      baseUrl: legacy.llm.baseUrl,
      model: legacy.llm.model,
      priceInputPerMTok: legacy.llm.priceInputPerMTok,
      priceOutputPerMTok: legacy.llm.priceOutputPerMTok
    });
    settings.quotas.ai = {
      ...settings.quotas.ai,
      dailyCostCeilingUsd: legacy.llm.dailyUsd
    };
  }
  settings.sources.virustotal.enabled = legacy.virustotal !== null;

  const plaintext = {
    gatekeeperPassword: legacy.pihole.appPassword,
    ...(legacy.metadefender && {
      metadefenderApiKey: legacy.metadefender.apiKey
    }),
    ...(legacy.llm && { aiApiKey: legacy.llm.apiKey }),
    ...(legacy.virustotal && { virustotalApiKey: legacy.virustotal.apiKey })
  } satisfies Partial<Record<SettingsSecretName, string>>;
  validateSettings(
    settings,
    new Set(Object.keys(plaintext) as SettingsSecretName[])
  );

  for (const [name, value] of Object.entries(plaintext) as [
    SettingsSecretName,
    string
  ][]) {
    const at = Date.now();
    await putConfigSecret(db, schema, {
      name,
      payload: encryptSecret(key, value),
      createdAt: at,
      updatedAt: at
    });
  }
  await writeSettings(db, schema, settings);
  await audit(db, schema, 'system', [
    'gatekeeper',
    'sources',
    'quotas',
    'weights',
    'system'
  ]);
  return true;
}

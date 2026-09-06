import { encryptSecret, decryptSecret } from './crypto';
import { getAppConfig, getConfigSecret, listConfigSecrets } from '../db/repo';
import { loadConfig } from '../config';
import { parseStoredSettings, validateSettings } from './validate';
import { eq } from 'drizzle-orm';
import type {
  SafeSettings,
  SettingsPatch,
  SettingsSecretName,
  SettingsSecrets,
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

type MaybePromise<T> = T | PromiseLike<T>;

export class SetupCompleteError extends Error {}

function then<T, U>(
  value: MaybePromise<T>,
  next: (value: T) => MaybePromise<U>
) {
  return value && typeof (value as PromiseLike<T>).then === 'function'
    ? Promise.resolve(value).then(next)
    : next(value as T);
}

function run(query: any): MaybePromise<unknown> {
  return typeof query.run === 'function' ? query.run() : query;
}

function first(query: any): MaybePromise<any> {
  return typeof query.get === 'function'
    ? query.get()
    : then(query, (rows: any[]) => rows[0]);
}

async function transaction<T>(
  db: any,
  mutate: (tx: any) => MaybePromise<T>
): Promise<T> {
  return await db.transaction(mutate);
}

function auditQuery(
  db: any,
  schema: any,
  actor: 'local_admin' | 'system',
  categories: string[]
) {
  return db.insert(schema.auditLog).values({
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

function settingsQuery(
  db: any,
  schema: any,
  settings: StoredSettings,
  createdAt: number,
  expectedOnboardingComplete?: boolean
) {
  const at = Date.now();
  return db
    .insert(schema.appConfig)
    .values({
      id: 1,
      version: settings.version,
      config: bodyOf(settings),
      onboardingStep: settings.onboardingStep,
      onboardingComplete: settings.onboardingComplete,
      activated: settings.activated,
      createdAt,
      updatedAt: at
    })
    .onConflictDoUpdate({
      target: schema.appConfig.id,
      set: {
        version: settings.version,
        config: bodyOf(settings),
        onboardingStep: settings.onboardingStep,
        onboardingComplete: settings.onboardingComplete,
        activated: settings.activated,
        updatedAt: at
      },
      ...(expectedOnboardingComplete === undefined
        ? {}
        : {
            setWhere: eq(
              schema.appConfig.onboardingComplete,
              expectedOnboardingComplete
            )
          })
    });
}

function secretQuery(
  db: any,
  schema: any,
  row: {
    name: SettingsSecretName;
    payload: string;
    createdAt: number;
    updatedAt: number;
  }
) {
  return db
    .insert(schema.configSecrets)
    .values(row)
    .onConflictDoUpdate({
      target: schema.configSecrets.name,
      set: { payload: row.payload, updatedAt: row.updatedAt }
    });
}

export async function getSettings(
  db: any,
  schema: any,
  key: Buffer
): Promise<StoredSettings | null> {
  const settings = await getStoredSettings(db, schema);
  if (!settings) return null;
  return validateSettings(settings, await usableSecrets(db, schema, key));
}

export async function getStoredSettings(
  db: any,
  schema: any
): Promise<StoredSettings | null> {
  const row = await getAppConfig(db, schema);
  if (!row) return null;
  return fromRow(row);
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
    { ...(row ? fromRow(row) : defaultSettings()), ...patch },
    await usableSecrets(db, schema, key)
  );
  const categories = patchCategories(patch);
  await transaction(db, (tx) =>
    then(
      run(settingsQuery(tx, schema, settings, row?.createdAt ?? Date.now())),
      () =>
        categories.length
          ? run(auditQuery(tx, schema, 'local_admin', categories))
          : undefined
    )
  );
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
  await transaction(db, (tx) =>
    then(
      run(
        secretQuery(tx, schema, {
          name,
          payload: encryptSecret(key, plaintext),
          createdAt: old?.createdAt ?? at,
          updatedAt: at
        })
      ),
      () => run(auditQuery(tx, schema, 'local_admin', [secretCategory(name)]))
    )
  );
}

export async function saveSetupSection(
  db: any,
  schema: any,
  key: Buffer,
  change: {
    patch: SettingsPatch;
    secrets?: SettingsSecrets;
    admin?: { salt: string; passwordHash: string };
    expectedOnboardingComplete?: boolean;
  }
): Promise<StoredSettings> {
  const row = await getAppConfig(db, schema);
  const available = await usableSecrets(db, schema, key);
  for (const [name, value] of Object.entries(change.secrets ?? {}) as [
    SettingsSecretName,
    string
  ][]) {
    if (value) available.add(name);
  }
  const settings = validateSettings(
    { ...(row ? fromRow(row) : defaultSettings()), ...change.patch },
    available
  );
  const at = Date.now();
  const categories = [
    ...new Set([
      ...patchCategories(change.patch),
      ...Object.keys(change.secrets ?? {}).map((name) =>
        secretCategory(name as SettingsSecretName)
      )
    ])
  ];

  return transaction(db, (tx) => {
    let writes: MaybePromise<unknown> = then(
      first(
        settingsQuery(
          tx,
          schema,
          settings,
          row?.createdAt ?? at,
          change.expectedOnboardingComplete ?? false
        ).returning({ id: schema.appConfig.id })
      ),
      (claimed) => {
        if (!claimed) throw new SetupCompleteError('Setup is already complete');
      }
    );
    for (const [name, value] of Object.entries(change.secrets ?? {}) as [
      SettingsSecretName,
      string
    ][]) {
      if (!value) continue;
      writes = then(writes, () =>
        run(
          secretQuery(tx, schema, {
            name,
            payload: encryptSecret(key, value),
            createdAt: at,
            updatedAt: at
          })
        )
      );
    }
    if (change.admin) {
      writes = then(writes, () =>
        run(
          tx.insert(schema.localAdmin).values({
            id: 1,
            ...change.admin,
            createdAt: at,
            updatedAt: at
          })
        )
      );
    }
    if (categories.length)
      writes = then(writes, () =>
        run(auditQuery(tx, schema, 'local_admin', categories))
      );
    return then(writes, () => settings);
  });
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
  settings.gatekeeper = {
    type: 'pihole',
    baseUrl: legacy.gatekeeper.baseUrl
  };
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
    gatekeeperPassword: legacy.gatekeeper.credential,
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

  const categories = ['gatekeeper', 'sources', 'quotas', 'weights', 'system'];
  const at = Date.now();
  return transaction(db, (tx) =>
    then(
      first(
        tx
          .insert(schema.appConfig)
          .values({
            id: 1,
            version: settings.version,
            config: bodyOf(settings),
            onboardingStep: settings.onboardingStep,
            onboardingComplete: settings.onboardingComplete,
            activated: settings.activated,
            createdAt: at,
            updatedAt: at
          })
          .onConflictDoNothing()
          .returning({ id: schema.appConfig.id })
      ),
      (claimed) => {
        if (!claimed) return false;
        let writes: MaybePromise<unknown> = undefined;
        for (const [name, value] of Object.entries(plaintext) as [
          SettingsSecretName,
          string
        ][]) {
          writes = then(writes, () =>
            run(
              secretQuery(tx, schema, {
                name,
                payload: encryptSecret(key, value),
                createdAt: at,
                updatedAt: at
              })
            )
          );
        }
        return then(writes, () =>
          then(run(auditQuery(tx, schema, 'system', categories)), () => true)
        );
      }
    )
  );
}

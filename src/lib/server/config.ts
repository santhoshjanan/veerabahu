import { validateSettings } from './settings/validate';
import type { SettingsSecrets, StoredSettings } from './settings/types';
import type { SourceName } from './db/types';
import type { SourceLimits } from './reputation/types';

export interface Config {
  gatekeeper: {
    type: 'pihole' | 'adguard';
    baseUrl: string;
    credential: string;
  };
  pihole: { baseUrl: string; appPassword: string } | null;
  metadefender: { apiKey: string } | null;
  llm: {
    baseUrl: string;
    apiKey: string;
    model: string;
    dailyUsd: number | null;
    priceInputPerMTok: number | null;
    priceOutputPerMTok: number | null;
  } | null;
  virustotal: { apiKey: string } | null;
  enabledSources: SourceName[];
  sourceBaseUrls: Record<SourceName, string | null>;
  quotas: Record<SourceName, SourceLimits>;
  weights: Record<SourceName, number>;
  databaseUrl: string;
  ingestIntervalMs: number;
  firstRunLookbackMs: number;
  firstRunCap: number;
  maxReviewWaitMs: number;
  blocklistPath: string;
  port: number;
  curatedListUrls: string[];
}

type Env = Record<string, string | undefined>;

const req = (env: Env, key: string): string => {
  const v = env[key];
  if (v === undefined || v === '')
    throw new Error(`Missing required env var: ${key}`);
  return v;
};

const num = (env: Env, key: string, fallback: number): number => {
  const v = env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n))
    throw new Error(`Env var ${key} must be a number, got: ${v}`);
  return n;
};

const optNum = (env: Env, key: string): number | null => {
  const v = env[key];
  if (v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n))
    throw new Error(`Env var ${key} must be a number, got: ${v}`);
  return n;
};

export function loadConfig(env: Env): Config {
  const llmBaseUrl = env.VB_LLM_BASE_URL;
  const llmKey = env.VB_LLM_API_KEY;
  const llmModel = env.VB_LLM_MODEL;
  const llmReady = !!llmBaseUrl && !!llmKey && !!llmModel;

  const vtKey = env.VB_VIRUSTOTAL_API_KEY;
  const vtEnabled = env.VB_VIRUSTOTAL_ENABLED === 'true';
  const pihole = {
    baseUrl: req(env, 'VB_PIHOLE_BASE_URL').replace(/\/+$/, ''),
    appPassword: req(env, 'VB_PIHOLE_APP_PASSWORD')
  };

  return {
    gatekeeper: {
      type: 'pihole',
      baseUrl: pihole.baseUrl,
      credential: pihole.appPassword
    },
    pihole,
    metadefender: env.VB_METADEFENDER_API_KEY
      ? { apiKey: env.VB_METADEFENDER_API_KEY }
      : null,
    llm: llmReady
      ? {
          baseUrl: llmBaseUrl!.replace(/\/+$/, ''),
          apiKey: llmKey!,
          model: llmModel!,
          dailyUsd: optNum(env, 'VB_LLM_DAILY_USD'),
          priceInputPerMTok: optNum(env, 'VB_LLM_PRICE_INPUT_PER_MTOK'),
          priceOutputPerMTok: optNum(env, 'VB_LLM_PRICE_OUTPUT_PER_MTOK')
        }
      : null,
    virustotal: vtKey && vtEnabled ? { apiKey: vtKey } : null,
    enabledSources: [
      'curated_list',
      ...(env.VB_METADEFENDER_API_KEY ? (['metadefender'] as const) : []),
      ...(llmReady ? (['ai'] as const) : []),
      ...(vtKey && vtEnabled ? (['virustotal'] as const) : [])
    ],
    sourceBaseUrls: {
      curated_list: null,
      metadefender: 'https://api.metadefender.com/v4',
      ai: llmBaseUrl?.replace(/\/+$/, '') ?? null,
      virustotal: 'https://www.virustotal.com/api/v3'
    },
    quotas: {
      curated_list: {
        perMinute: null,
        perDay: null,
        perMonth: null,
        dailyCostCeiling: null
      },
      metadefender: {
        perMinute: null,
        perDay: 4000,
        perMonth: null,
        dailyCostCeiling: null
      },
      ai: {
        perMinute: null,
        perDay: null,
        perMonth: null,
        dailyCostCeiling: optNum(env, 'VB_LLM_DAILY_USD')
      },
      virustotal: {
        perMinute: 4,
        perDay: 500,
        perMonth: 15_500,
        dailyCostCeiling: null
      }
    },
    weights: {
      curated_list: 1,
      metadefender: 1,
      ai: 0.6,
      virustotal: 1
    },
    databaseUrl: env.VB_DATABASE_URL || 'file:./data/veerabahu.db',
    ingestIntervalMs: num(env, 'VB_INGEST_INTERVAL_MIN', 15) * 60_000,
    firstRunLookbackMs: num(env, 'VB_FIRST_RUN_LOOKBACK_HOURS', 24) * 3_600_000,
    firstRunCap: num(env, 'VB_FIRST_RUN_CAP', 5000),
    maxReviewWaitMs: num(env, 'VB_MAX_REVIEW_WAIT_HOURS', 6) * 3_600_000,
    blocklistPath: env.VB_BLOCKLIST_PATH || '/blocklist.txt',
    port: num(env, 'VB_PORT', 3000),
    curatedListUrls: (env.VB_CURATED_LIST_URLS || '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  };
}

export function toRuntimeConfig(
  settings: StoredSettings,
  secrets: SettingsSecrets,
  bootstrap: Pick<Config, 'databaseUrl' | 'port'> = {
    databaseUrl: process.env.VB_DATABASE_URL || 'file:./data/veerabahu.db',
    port: Number(process.env.VB_PORT || 3000)
  }
): Config {
  const checked = validateSettings(
    settings,
    new Set(
      Object.entries(secrets)
        .filter(([, value]) => Boolean(value))
        .map(([name]) => name as keyof SettingsSecrets)
    )
  );
  if (!checked.gatekeeper || !secrets.gatekeeperPassword)
    throw new Error('Gatekeeper credential is required');

  return {
    gatekeeper: {
      type: checked.gatekeeper.type,
      baseUrl: checked.gatekeeper.baseUrl.replace(/\/+$/, ''),
      credential: secrets.gatekeeperPassword
    },
    pihole:
      checked.gatekeeper.type === 'pihole'
        ? {
            baseUrl: checked.gatekeeper.baseUrl.replace(/\/+$/, ''),
            appPassword: secrets.gatekeeperPassword
          }
        : null,
    metadefender:
      checked.sources.metadefender.enabled && secrets.metadefenderApiKey
        ? { apiKey: secrets.metadefenderApiKey }
        : null,
    llm:
      checked.sources.ai.enabled &&
      secrets.aiApiKey &&
      checked.sources.ai.baseUrl &&
      checked.sources.ai.model
        ? {
            baseUrl: checked.sources.ai.baseUrl.replace(/\/+$/, ''),
            apiKey: secrets.aiApiKey,
            model: checked.sources.ai.model,
            dailyUsd: checked.quotas.ai.dailyCostCeilingUsd,
            priceInputPerMTok: checked.sources.ai.priceInputPerMTok,
            priceOutputPerMTok: checked.sources.ai.priceOutputPerMTok
          }
        : null,
    virustotal:
      checked.sources.virustotal.enabled && secrets.virustotalApiKey
        ? { apiKey: secrets.virustotalApiKey }
        : null,
    enabledSources: Object.entries(checked.sources)
      .filter(([, source]) => source.enabled)
      .map(([name]) => name as SourceName),
    sourceBaseUrls: {
      curated_list: checked.sources.curated_list.baseUrl,
      metadefender: checked.sources.metadefender.baseUrl,
      ai: checked.sources.ai.baseUrl,
      virustotal: checked.sources.virustotal.baseUrl
    },
    quotas: Object.fromEntries(
      Object.entries(checked.quotas).map(([name, limits]) => [
        name,
        {
          perMinute: limits.perMinute,
          perDay: limits.perDay,
          perMonth: limits.perMonth,
          dailyCostCeiling: limits.dailyCostCeilingUsd
        }
      ])
    ) as Config['quotas'],
    weights: checked.weights,
    databaseUrl: bootstrap.databaseUrl,
    ingestIntervalMs: checked.scheduler.ingestIntervalMinutes * 60_000,
    firstRunLookbackMs: checked.scheduler.firstRunLookbackHours * 3_600_000,
    firstRunCap: checked.scheduler.firstRunCap,
    maxReviewWaitMs: checked.scheduler.maxReviewWaitHours * 3_600_000,
    blocklistPath: checked.scheduler.blocklistPath,
    port: bootstrap.port,
    curatedListUrls: checked.curatedListUrls
  };
}

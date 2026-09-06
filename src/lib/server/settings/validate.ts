import { z } from 'zod';
import type { SettingsSecretName, StoredSettings } from './types';

const httpUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password
    );
  }, 'Must be an HTTP(S) URL without credentials or userinfo');

const optionalHttpUrl = z.union([httpUrl, z.null()]);
const limit = z.number().finite().nonnegative().nullable();
const weight = z.number().finite().nonnegative();

const limitsSchema = z
  .object({
    perMinute: limit,
    perDay: limit,
    perMonth: limit,
    dailyCostCeilingUsd: limit
  })
  .strict();

const sourceSchema = z
  .object({
    enabled: z.boolean(),
    baseUrl: optionalHttpUrl
  })
  .strict();

const aiSourceSchema = sourceSchema.extend({
  model: z.string().trim().min(1).nullable(),
  priceInputPerMTok: limit,
  priceOutputPerMTok: limit
});

export const settingsSchema = z
  .object({
    version: z.literal(1),
    onboardingStep: z.number().int().min(0).max(5),
    onboardingComplete: z.boolean(),
    activated: z.boolean(),
    gatekeeper: z
      .object({
        type: z.enum(['pihole', 'adguard']),
        baseUrl: httpUrl,
        username: z.string().trim().optional()
      })
      .strict()
      .nullable(),
    sources: z
      .object({
        curated_list: sourceSchema,
        metadefender: sourceSchema,
        ai: aiSourceSchema,
        virustotal: sourceSchema
      })
      .strict(),
    quotas: z
      .object({
        curated_list: limitsSchema,
        metadefender: limitsSchema,
        ai: limitsSchema,
        virustotal: limitsSchema
      })
      .strict(),
    weights: z
      .object({
        curated_list: weight,
        metadefender: weight,
        ai: weight,
        virustotal: weight
      })
      .strict(),
    scheduler: z
      .object({
        ingestIntervalMinutes: z.number().finite().positive(),
        firstRunLookbackHours: z.number().finite().nonnegative(),
        firstRunCap: z.number().int().nonnegative(),
        maxReviewWaitHours: z.number().finite().nonnegative(),
        blocklistPath: z.string().transform(() => '/blocklist.txt')
      })
      .strict(),
    curatedListUrls: z.array(httpUrl)
  })
  .strict();

export function parseStoredSettings(value: unknown): StoredSettings {
  return settingsSchema.parse(value);
}

export function validateSettings(
  value: unknown,
  configuredSecrets: ReadonlySet<SettingsSecretName> = new Set(),
  unchanged?: StoredSettings
): StoredSettings {
  const settings = parseStoredSettings(value);
  const issues: string[] = [];

  if (
    settings.gatekeeper &&
    !configuredSecrets.has('gatekeeperPassword') &&
    JSON.stringify(settings.gatekeeper) !==
      JSON.stringify(unchanged?.gatekeeper)
  )
    issues.push('Gatekeeper credential is required');

  const credentialBySource = {
    metadefender: 'metadefenderApiKey',
    ai: 'aiApiKey',
    virustotal: 'virustotalApiKey'
  } as const;
  for (const [source, credential] of Object.entries(credentialBySource) as [
    keyof typeof credentialBySource,
    SettingsSecretName
  ][]) {
    const config = settings.sources[source];
    if (config.enabled && !config.baseUrl)
      issues.push(`${source} endpoint is required when enabled`);
    if (
      config.enabled &&
      !configuredSecrets.has(credential) &&
      (!unchanged?.sources[source].enabled ||
        config.baseUrl !== unchanged.sources[source].baseUrl)
    )
      issues.push(`${source} credential is required when enabled`);
  }
  if (settings.sources.ai.enabled && !settings.sources.ai.model)
    issues.push('AI model is required when enabled');
  if (
    settings.sources.ai.enabled &&
    (settings.quotas.ai.dailyCostCeilingUsd ?? 0) > 0 &&
    (settings.sources.ai.priceInputPerMTok === null ||
      settings.sources.ai.priceOutputPerMTok === null)
  )
    issues.push(
      'AI input and output prices are required with a positive daily cost ceiling'
    );
  if (
    (settings.onboardingStep >= 3 ||
      settings.onboardingComplete ||
      settings.activated) &&
    settings.sources.curated_list.enabled &&
    settings.curatedListUrls.length === 0
  )
    issues.push('Curated list URLs are required when enabled');

  const enabled = Object.entries(settings.sources)
    .filter(([, source]) => source.enabled)
    .map(([name]) => name as keyof StoredSettings['weights']);
  if (!enabled.length)
    issues.push('At least one reputation source must be enabled');
  else if (enabled.every((name) => settings.weights[name] === 0))
    issues.push('At least one enabled source weight must be greater than zero');
  if (settings.activated && !settings.onboardingComplete)
    issues.push('Scheduler cannot be activated before onboarding is complete');

  if (issues.length) throw new Error(issues.join('; '));
  return settings;
}

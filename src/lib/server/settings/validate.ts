import { z } from 'zod';
import type { SettingsSecretName, StoredSettings } from './types';

const httpUrl = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  }, 'Must be an HTTP(S) URL');

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
      .object({ type: z.enum(['pihole', 'adguard']), baseUrl: httpUrl })
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
        blocklistPath: z.string().regex(/^\/[^?#]*$/, 'Must be a URL path')
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
  configuredSecrets: ReadonlySet<SettingsSecretName> = new Set()
): StoredSettings {
  const settings = parseStoredSettings(value);
  const issues: string[] = [];

  if (settings.gatekeeper && !configuredSecrets.has('gatekeeperPassword'))
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
    if (config.enabled && !configuredSecrets.has(credential))
      issues.push(`${source} credential is required when enabled`);
  }
  if (settings.sources.ai.enabled && !settings.sources.ai.model)
    issues.push('AI model is required when enabled');

  const enabled = Object.entries(settings.sources)
    .filter(([, source]) => source.enabled)
    .map(([name]) => name as keyof StoredSettings['weights']);
  if (enabled.length && enabled.every((name) => settings.weights[name] === 0))
    issues.push('At least one enabled source weight must be greater than zero');
  if (settings.activated && !settings.onboardingComplete)
    issues.push('Scheduler cannot be activated before onboarding is complete');

  if (issues.length) throw new Error(issues.join('; '));
  return settings;
}

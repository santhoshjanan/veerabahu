import { fail, redirect } from '@sveltejs/kit';
import { ZodError } from 'zod';
import { db, schema } from '$lib/server/db/index';
import {
  changePassword,
  destroySession,
  SESSION_COOKIE
} from '$lib/server/auth';
import { testGatekeeper } from '$lib/server/settings/connection-test';
import { parseMasterKey } from '$lib/server/settings/crypto';
import { runtime } from '$lib/server/settings/runtime';
import {
  getSafeSettings,
  getSecret,
  getStoredSettings,
  saveSetupSection
} from '$lib/server/settings/store';
import { settingsSchema } from '$lib/server/settings/validate';
import type {
  SettingsSecrets,
  StoredSettings
} from '$lib/server/settings/types';
import type { Actions, PageServerLoad } from './$types';

const key = () => parseMasterKey(process.env.VB_MASTER_KEY ?? '');
const text = (form: FormData, name: string) =>
  String(form.get(name) ?? '').trim();
const raw = (form: FormData, name: string) => String(form.get(name) ?? '');
const checked = (form: FormData, name: string) => form.has(name);
const optional = (value: string) => value || null;
const numeric = (value: string) => (value === '' ? null : Number(value));
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Unable to save these settings';

class RuntimeRestartError extends Error {}

const sources = [
  ['curated_list', 'curatedList'],
  ['metadefender', 'metadefender'],
  ['ai', 'ai'],
  ['virustotal', 'virustotal']
] as const;

function fieldErrors(error: unknown): Record<string, string> {
  const errors: Record<string, string> = {};
  if (error instanceof ZodError) {
    for (const issue of error.issues) {
      const path = issue.path.join('.');
      const quota = /^quotas\.([^.]+)\.(perMinute|perDay|perMonth)$/.exec(path);
      const weight = /^weights\.([^.]+)$/.exec(path);
      const field = quota
        ? `${sources.find(([name]) => name === quota[1])?.[1]}${quota[2][0].toUpperCase()}${quota[2].slice(1)}`
        : weight
          ? `${sources.find(([name]) => name === weight[1])?.[1]}Weight`
          : path.startsWith('scheduler.')
            ? path.slice('scheduler.'.length)
            : ({
                'gatekeeper.type': 'type',
                'gatekeeper.baseUrl': 'baseUrl',
                'gatekeeper.username': 'username',
                'sources.metadefender.baseUrl': 'metadefenderBaseUrl',
                'sources.ai.baseUrl': 'aiBaseUrl',
                'sources.ai.model': 'aiModel',
                'sources.ai.priceInputPerMTok': 'aiPriceInputPerMTok',
                'sources.ai.priceOutputPerMTok': 'aiPriceOutputPerMTok',
                'sources.virustotal.baseUrl': 'virustotalBaseUrl',
                'quotas.ai.dailyCostCeilingUsd': 'aiDailyCostCeilingUsd'
              }[path] ??
              (path.startsWith('curatedListUrls.')
                ? 'curatedListUrls'
                : undefined));
      if (field && !errors[field]) errors[field] = issue.message;
    }
  }
  const detail = message(error);
  if (/reputation source must be enabled/i.test(detail))
    errors.curatedListEnabled = 'Enable at least one reputation source';
  if (/enabled source weight/i.test(detail))
    errors.curatedListWeight =
      'Give at least one enabled source a weight above zero';
  for (const [source, prefix, secret] of [
    ['metadefender', 'metadefender', 'metadefenderApiKey'],
    ['ai', 'ai', 'aiApiKey'],
    ['virustotal', 'virustotal', 'virustotalApiKey']
  ]) {
    if (new RegExp(`${source} endpoint`, 'i').test(detail))
      errors[`${prefix}BaseUrl`] = 'Endpoint is required when enabled';
    if (new RegExp(`${source} credential`, 'i').test(detail))
      errors[secret] = 'Credential is required when enabled';
  }
  if (/AI model is required/i.test(detail))
    errors.aiModel = 'Model is required when enabled';
  return Object.keys(errors).length ? errors : { _form: detail };
}

function failure(
  section: string,
  values: Record<string, unknown> | null,
  error: unknown,
  status = 400
) {
  const errors = fieldErrors(error);
  const restartFailed = error instanceof RuntimeRestartError;
  return fail(restartFailed ? 500 : status, {
    section,
    ...(values ? { values } : {}),
    ...(restartFailed && { saved: true, restartFailed: true }),
    errors,
    ...(errors._form && { error: errors._form })
  });
}

async function current() {
  const stored = await getStoredSettings(db, schema);
  if (!stored?.onboardingComplete)
    throw new Error('Settings are unavailable until setup is complete');
  return stored;
}

async function save(
  patch: Partial<StoredSettings>,
  secrets: SettingsSecrets = {}
) {
  await saveSetupSection(db, schema, key(), {
    patch,
    secrets,
    expectedOnboardingComplete: true
  });
  try {
    await runtime.restart();
  } catch {
    throw new RuntimeRestartError(
      'Settings were saved, but the background runtime could not restart and is currently stopped. Save again or restart Veerabahu.'
    );
  }
}

export const load: PageServerLoad = async () => {
  const settings = await getSafeSettings(db, schema, key());
  if (!settings?.onboardingComplete) redirect(303, '/setup');
  return { settings };
};

export const actions: Actions = {
  password: async ({ request, cookies }) => {
    const form = await request.formData();
    const currentPassword = raw(form, 'currentPassword');
    const newPassword = raw(form, 'newPassword');
    const confirmation = raw(form, 'passwordConfirm');
    if (newPassword.length < 12)
      return fail(400, {
        section: 'access',
        errors: { newPassword: 'Use at least 12 characters' }
      });
    if (newPassword !== confirmation)
      return fail(400, {
        section: 'access',
        errors: { passwordConfirm: 'Passwords do not match' }
      });
    if (
      !(await changePassword(db, schema, key(), currentPassword, newPassword))
    )
      return fail(400, {
        section: 'access',
        errors: { currentPassword: 'Current password did not match' }
      });
    cookies.delete(SESSION_COOKIE, { path: '/' });
    redirect(303, '/login?changed=1');
  },

  gatekeeper: async ({ request }) => {
    const form = await request.formData();
    const values = {
      type: text(form, 'type'),
      baseUrl: text(form, 'baseUrl'),
      username: text(form, 'username')
    };
    const password = raw(form, 'password');
    try {
      await current();
      const gatekeeper = settingsSchema.shape.gatekeeper.unwrap().parse({
        type: values.type,
        baseUrl: values.baseUrl,
        ...(values.username && { username: values.username })
      });
      const credential =
        password || (await getSecret(db, schema, key(), 'gatekeeperPassword'));
      if (!credential) throw new Error('Gatekeeper credential is required');
      const result = await testGatekeeper({ gatekeeper }, credential);
      if (result.kind !== 'connected') {
        const errors = {
          auth_rejected: {
            password:
              'Authentication rejected. Check the credential and try again.'
          },
          unreachable: {
            baseUrl: 'Gatekeeper unreachable. Check the URL and network.'
          },
          invalid_response: {
            baseUrl: 'Gatekeeper returned an unexpected response.'
          }
        } as const;
        return fail(400, {
          section: 'gatekeeper',
          values,
          testStatus: result.kind,
          errors: errors[result.kind]
        });
      }
      await save(
        { gatekeeper },
        password ? { gatekeeperPassword: password } : {}
      );
      return { section: 'gatekeeper', saved: true, testStatus: 'connected' };
    } catch (error) {
      return failure('gatekeeper', values, error);
    }
  },

  sources: async ({ request }) => {
    const form = await request.formData();
    const values = {
      curatedListEnabled: checked(form, 'curatedListEnabled'),
      curatedListUrls: text(form, 'curatedListUrls'),
      metadefenderEnabled: checked(form, 'metadefenderEnabled'),
      metadefenderBaseUrl: text(form, 'metadefenderBaseUrl'),
      aiEnabled: checked(form, 'aiEnabled'),
      aiBaseUrl: text(form, 'aiBaseUrl'),
      aiModel: text(form, 'aiModel'),
      virustotalEnabled: checked(form, 'virustotalEnabled'),
      virustotalBaseUrl: text(form, 'virustotalBaseUrl')
    };
    const replacements = Object.fromEntries(
      [
        ['metadefenderApiKey', raw(form, 'metadefenderApiKey')],
        ['aiApiKey', raw(form, 'aiApiKey')],
        ['virustotalApiKey', raw(form, 'virustotalApiKey')]
      ].filter(([, value]) => value)
    ) as SettingsSecrets;
    try {
      const stored = await current();
      await save(
        {
          sources: {
            curated_list: {
              enabled: values.curatedListEnabled,
              baseUrl: null
            },
            metadefender: {
              enabled: values.metadefenderEnabled,
              baseUrl: optional(values.metadefenderBaseUrl)
            },
            ai: {
              ...stored.sources.ai,
              enabled: values.aiEnabled,
              baseUrl: optional(values.aiBaseUrl),
              model: optional(values.aiModel)
            },
            virustotal: {
              enabled: values.virustotalEnabled,
              baseUrl: optional(values.virustotalBaseUrl)
            }
          },
          curatedListUrls: values.curatedListUrls
            .split(/\r?\n/)
            .map((url) => url.trim())
            .filter(Boolean)
        },
        replacements
      );
      return { section: 'sources', saved: true };
    } catch (error) {
      return failure('sources', values, error);
    }
  },

  quotas: async ({ request }) => {
    const form = await request.formData();
    const values = Object.fromEntries(form.entries()) as Record<string, string>;
    try {
      const stored = await current();
      const quotas = Object.fromEntries(
        sources.map(([source, prefix]) => [
          source,
          {
            ...stored.quotas[source],
            perMinute: numeric(text(form, `${prefix}PerMinute`)),
            perDay: numeric(text(form, `${prefix}PerDay`)),
            perMonth: numeric(text(form, `${prefix}PerMonth`)),
            ...(source === 'ai' && {
              dailyCostCeilingUsd: numeric(text(form, 'aiDailyCostCeilingUsd'))
            })
          }
        ])
      ) as StoredSettings['quotas'];
      await save({
        quotas,
        sources: {
          ...stored.sources,
          ai: {
            ...stored.sources.ai,
            priceInputPerMTok: numeric(text(form, 'aiPriceInputPerMTok')),
            priceOutputPerMTok: numeric(text(form, 'aiPriceOutputPerMTok'))
          }
        }
      });
      return { section: 'quotas', saved: true };
    } catch (error) {
      return failure('quotas', values, error);
    }
  },

  weights: async ({ request }) => {
    const form = await request.formData();
    const values = Object.fromEntries(form.entries()) as Record<string, string>;
    try {
      await current();
      await save({
        weights: Object.fromEntries(
          sources.map(([source, prefix]) => [
            source,
            Number(text(form, `${prefix}Weight`))
          ])
        ) as StoredSettings['weights']
      });
      return { section: 'weights', saved: true };
    } catch (error) {
      return failure('weights', values, error);
    }
  },

  system: async ({ request }) => {
    const form = await request.formData();
    const values = Object.fromEntries(form.entries()) as Record<string, string>;
    try {
      await current();
      await save({
        activated: checked(form, 'activated'),
        scheduler: {
          ingestIntervalMinutes: Number(text(form, 'ingestIntervalMinutes')),
          firstRunLookbackHours: Number(text(form, 'firstRunLookbackHours')),
          firstRunCap: Number(text(form, 'firstRunCap')),
          maxReviewWaitHours: Number(text(form, 'maxReviewWaitHours')),
          blocklistPath: text(form, 'blocklistPath')
        }
      });
      return { section: 'system', saved: true };
    } catch (error) {
      return failure('system', values, error);
    }
  },

  signout: async ({ cookies }) => {
    const token = cookies.get(SESSION_COOKIE);
    if (token) await destroySession(db, schema, token);
    cookies.delete(SESSION_COOKIE, { path: '/' });
    redirect(303, '/login?signedout=1');
  }
};

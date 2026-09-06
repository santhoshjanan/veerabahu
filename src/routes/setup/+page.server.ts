import { fail, redirect } from '@sveltejs/kit';
import { db, schema } from '$lib/server/db/index';
import {
  createSession,
  getSession,
  hasAdmin,
  requireAdmin,
  SESSION_COOKIE,
  SESSION_TTL_MS
} from '$lib/server/auth';
import { hashPassword, parseMasterKey } from '$lib/server/settings/crypto';
import { testGatekeeper } from '$lib/server/settings/connection-test';
import { runtime } from '$lib/server/settings/runtime';
import {
  getSafeSettings,
  getSecret,
  getSettings,
  getStoredSettings,
  saveSetupSection,
  SetupCompleteError
} from '$lib/server/settings/store';
import {
  settingsSchema,
  validateSettings
} from '$lib/server/settings/validate';
import { ZodError } from 'zod';
import type {
  SafeSettings,
  SettingsSecretName,
  StoredSettings
} from '$lib/server/settings/types';
import type { Actions, PageServerLoad } from './$types';
import { getSetupView } from './setup-view';

const key = () => parseMasterKey(process.env.VB_MASTER_KEY ?? '');
const text = (form: FormData, name: string) =>
  String(form.get(name) ?? '').trim();
const raw = (form: FormData, name: string) => String(form.get(name) ?? '');
const checked = (form: FormData, name: string) => form.has(name);
const optional = (value: string) => value || null;
const number = (value: string) => (value === '' ? null : Number(value));
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Unable to save these settings';

const fields: Record<string, string> = {
  type: 'type',
  baseUrl: 'baseUrl',
  username: 'username',
  'sources.curated_list.baseUrl': 'curatedListUrls',
  'sources.metadefender.baseUrl': 'metadefenderBaseUrl',
  'sources.ai.baseUrl': 'aiBaseUrl',
  'sources.ai.model': 'aiModel',
  'sources.ai.priceInputPerMTok': 'aiPriceInputPerMTok',
  'sources.ai.priceOutputPerMTok': 'aiPriceOutputPerMTok',
  'sources.virustotal.baseUrl': 'virustotalBaseUrl',
  'quotas.ai.dailyCostCeilingUsd': 'aiDailyCostCeilingUsd'
};

const sourceFields = {
  curated_list: 'curatedList',
  metadefender: 'metadefender',
  ai: 'ai',
  virustotal: 'virustotal'
} as const;

function fieldErrors(error: unknown): Record<string, string> {
  const errors: Record<string, string> = {};
  if (error instanceof ZodError) {
    for (const issue of error.issues) {
      const path = issue.path.join('.');
      const quota = /^quotas\.([^.]+)\.(perMinute|perDay|perMonth)$/.exec(path);
      const weight = /^weights\.([^.]+)$/.exec(path);
      const name = quota
        ? `${sourceFields[quota[1] as keyof typeof sourceFields]}${quota[2][0].toUpperCase()}${quota[2].slice(1)}`
        : weight
          ? `${sourceFields[weight[1] as keyof typeof sourceFields]}Weight`
          : path.startsWith('curatedListUrls.')
            ? 'curatedListUrls'
            : fields[path];
      if (name && !errors[name]) errors[name] = issue.message;
    }
  }
  const detail = message(error);
  if (/reputation source must be enabled/i.test(detail))
    errors.curatedListEnabled = 'Enable at least one reputation source';
  if (/enabled source weight/i.test(detail))
    errors.curatedListWeight =
      'Give at least one enabled source a weight above zero';
  if (/Gatekeeper password is required/i.test(detail))
    errors.password = 'Gatekeeper password is required';
  for (const [source, field] of [
    ['metadefender', 'metadefenderApiKey'],
    ['ai', 'aiApiKey'],
    ['virustotal', 'virustotalApiKey']
  ]) {
    if (new RegExp(`${source} endpoint`, 'i').test(detail))
      errors[`${sourceFields[source as keyof typeof sourceFields]}BaseUrl`] =
        'Endpoint is required when enabled';
    if (new RegExp(`${source} credential`, 'i').test(detail))
      errors[field] = 'Credential is required when enabled';
  }
  if (/AI model is required/i.test(detail))
    errors.aiModel = 'Model is required when enabled';
  if (/Curated list URLs are required/i.test(detail))
    errors.curatedListUrls =
      'Enter at least one list URL or disable curated lists';
  if (/AI input and output prices/i.test(detail))
    errors.aiPriceInputPerMTok = errors.aiPriceOutputPerMTok =
      'Both prices are required with a positive daily cost ceiling';
  return Object.keys(errors).length ? errors : { _form: detail };
}

function sectionFailure(step: number, values: unknown, error: unknown) {
  const errors = fieldErrors(error);
  const priceError = errors.aiPriceInputPerMTok ?? errors.aiPriceOutputPerMTok;
  if (step !== 4 && priceError)
    errors._form = `Quota and scoring: ${priceError}`;
  return fail(error instanceof SetupCompleteError ? 409 : 400, {
    step,
    ...(values !== null && values !== undefined ? { values } : {}),
    errors,
    ...(errors._form && { error: errors._form })
  });
}

function cookie(cookies: any, url: URL, token: string) {
  cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    secure: url.protocol === 'https:',
    maxAge: SESSION_TTL_MS / 1000
  });
}

function requireStep(settings: SafeSettings | null, completed: number) {
  if (settings?.onboardingComplete)
    throw new SetupCompleteError('Setup is already complete');
  if (!settings || settings.onboardingStep < completed)
    throw new Error('Complete the previous setup step first');
  return settings;
}

function configuredSecrets(settings: SafeSettings) {
  const names = new Set<SettingsSecretName>();
  if (settings.gatekeeper?.secretConfigured) names.add('gatekeeperPassword');
  if (settings.sources.metadefender.secretConfigured)
    names.add('metadefenderApiKey');
  if (settings.sources.ai.secretConfigured) names.add('aiApiKey');
  if (settings.sources.virustotal.secretConfigured)
    names.add('virustotalApiKey');
  return names;
}

export const load: PageServerLoad = async ({ locals }) => {
  if (await hasAdmin(db, schema)) requireAdmin(locals.adminSession);
  const view = await getSetupView();
  if (view.settings?.onboardingComplete) redirect(303, '/');
  return view;
};

export const actions: Actions = {
  access: async ({ request, cookies, url, locals }) => {
    if (await hasAdmin(db, schema)) requireAdmin(locals.adminSession);
    const form = await request.formData();
    const current = await getSafeSettings(db, schema, key());
    if (current?.onboardingComplete)
      return sectionFailure(
        1,
        null,
        new SetupCompleteError('Setup is already complete')
      );
    const password = raw(form, 'password');
    const confirmation = raw(form, 'passwordConfirm');
    if (password.length < 12 || password !== confirmation) {
      return fail(400, {
        step: 1,
        errors:
          password.length < 12
            ? { password: 'Use at least 12 characters' }
            : { passwordConfirm: 'Passwords do not match' }
      });
    }

    if (current && current.onboardingStep >= 1)
      return fail(409, {
        step: 1,
        errors: { _form: 'Secure access is already configured' },
        error: 'Secure access is already configured'
      });

    try {
      const record = hashPassword(password);
      await saveSetupSection(db, schema, key(), {
        patch: { onboardingStep: 1 },
        admin: { salt: record.salt, passwordHash: record.hash }
      });
      const token = await createSession(db, schema);
      locals.adminSession = await getSession(db, schema, token);
      cookie(cookies, url, token);
      return { step: 1, nextStep: 2, saved: true };
    } catch (error) {
      return sectionFailure(1, null, error);
    }
  },

  gatekeeper: async ({ request, locals }) => {
    requireAdmin(locals.adminSession);
    const form = await request.formData();
    const values = {
      type: text(form, 'type'),
      baseUrl: text(form, 'baseUrl'),
      username: text(form, 'username')
    };
    const password = raw(form, 'password');

    try {
      requireStep(await getSafeSettings(db, schema, key()), 1);
      const gatekeeper = settingsSchema.shape.gatekeeper.unwrap().parse({
        type: values.type,
        baseUrl: values.baseUrl,
        ...(values.username && { username: values.username })
      });
      const credential =
        password || (await getSecret(db, schema, key(), 'gatekeeperPassword'));
      if (!credential) throw new Error('Gatekeeper password is required');

      const result = await testGatekeeper({ gatekeeper }, credential);
      if (result.kind !== 'connected') {
        const errorByStatus = {
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
          step: 2,
          values,
          testStatus: result.kind,
          errors: errorByStatus[result.kind]
        });
      }

      await saveSetupSection(db, schema, key(), {
        patch: (latest) => ({
          gatekeeper,
          onboardingStep: Math.max(latest.onboardingStep, 2)
        }),
        secrets: password ? { gatekeeperPassword: password } : {}
      });
      return {
        step: 2,
        nextStep: 3,
        saved: true,
        testStatus: 'connected' as const
      };
    } catch (error) {
      return sectionFailure(2, values, error);
    }
  },

  sources: async ({ request, locals }) => {
    requireAdmin(locals.adminSession);
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
    const secrets = {
      metadefenderApiKey: raw(form, 'metadefenderApiKey'),
      aiApiKey: raw(form, 'aiApiKey'),
      virustotalApiKey: raw(form, 'virustotalApiKey')
    } as const;

    try {
      const safe = requireStep(await getSafeSettings(db, schema, key()), 2);
      const stored = await getStoredSettings(db, schema);
      if (!stored) throw new Error('Setup settings are unavailable');
      const sources: StoredSettings['sources'] = {
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
      };
      const available = configuredSecrets(safe);
      for (const [name, value] of Object.entries(secrets) as [
        SettingsSecretName,
        string
      ][]) {
        if (value) available.add(name);
      }
      const patch = {
        sources,
        curatedListUrls: values.curatedListUrls
          .split(/\r?\n/)
          .map((url) => url.trim())
          .filter(Boolean),
        onboardingStep: Math.max(stored.onboardingStep, 3)
      };
      validateSettings({ ...stored, ...patch }, available);

      const replacements = Object.fromEntries(
        Object.entries(secrets).filter(([, value]) => value)
      );
      await saveSetupSection(db, schema, key(), {
        patch: (latest) => ({
          ...patch,
          onboardingStep: Math.max(latest.onboardingStep, 3),
          sources: {
            ...sources,
            ai: {
              ...sources.ai,
              priceInputPerMTok: latest.sources.ai.priceInputPerMTok,
              priceOutputPerMTok: latest.sources.ai.priceOutputPerMTok
            }
          }
        }),
        secrets: replacements
      });
      return { step: 3, nextStep: 4, saved: true };
    } catch (error) {
      return sectionFailure(3, values, error);
    }
  },

  quotas: async ({ request, locals }) => {
    requireAdmin(locals.adminSession);
    const form = await request.formData();
    const values = Object.fromEntries(form.entries()) as Record<string, string>;
    try {
      const safe = requireStep(await getSafeSettings(db, schema, key()), 3);
      const stored = await getStoredSettings(db, schema);
      if (!stored) throw new Error('Setup settings are unavailable');
      const sourceNames = [
        'curated_list',
        'metadefender',
        'ai',
        'virustotal'
      ] as const;
      const fieldNames = {
        curated_list: 'curatedList',
        metadefender: 'metadefender',
        ai: 'ai',
        virustotal: 'virustotal'
      } as const;
      const quotas = Object.fromEntries(
        sourceNames.map((source) => {
          const prefix = fieldNames[source];
          return [
            source,
            {
              perMinute: number(text(form, `${prefix}PerMinute`)),
              perDay: number(text(form, `${prefix}PerDay`)),
              perMonth: number(text(form, `${prefix}PerMonth`)),
              dailyCostCeilingUsd:
                source === 'ai'
                  ? number(text(form, 'aiDailyCostCeilingUsd'))
                  : stored.quotas[source].dailyCostCeilingUsd
            }
          ];
        })
      ) as StoredSettings['quotas'];
      const weights = Object.fromEntries(
        sourceNames.map((source) => [
          source,
          Number(text(form, `${fieldNames[source]}Weight`))
        ])
      ) as StoredSettings['weights'];
      const sources = {
        ...stored.sources,
        ai: {
          ...stored.sources.ai,
          priceInputPerMTok: number(text(form, 'aiPriceInputPerMTok')),
          priceOutputPerMTok: number(text(form, 'aiPriceOutputPerMTok'))
        }
      };
      const patch = {
        quotas,
        weights,
        sources,
        onboardingStep: Math.max(stored.onboardingStep, 4)
      };
      validateSettings({ ...stored, ...patch }, configuredSecrets(safe));
      await saveSetupSection(db, schema, key(), {
        patch: (latest) => ({
          ...patch,
          onboardingStep: Math.max(latest.onboardingStep, 4),
          sources: {
            ...latest.sources,
            ai: {
              ...latest.sources.ai,
              priceInputPerMTok: sources.ai.priceInputPerMTok,
              priceOutputPerMTok: sources.ai.priceOutputPerMTok
            }
          }
        })
      });
      return { step: 4, nextStep: 5, saved: true };
    } catch (error) {
      return sectionFailure(4, values, error);
    }
  },

  activate: async ({ locals }) => {
    requireAdmin(locals.adminSession);
    try {
      const settings = await getSettings(db, schema, key());
      if (settings?.onboardingComplete)
        return sectionFailure(
          5,
          null,
          new SetupCompleteError('Setup is already complete')
        );
      if (!settings?.gatekeeper || settings.onboardingStep < 4)
        return fail(400, {
          step: 5,
          errors: {
            _form: 'Complete and test every setup step before activation'
          },
          error: 'Complete and test every setup step before activation'
        });
      await saveSetupSection(db, schema, key(), {
        patch: {
          onboardingStep: 5,
          onboardingComplete: true,
          activated: true
        }
      });
      try {
        await runtime.restart();
      } catch (error) {
        await saveSetupSection(db, schema, key(), {
          patch: {
            onboardingStep: 4,
            onboardingComplete: false,
            activated: false
          },
          expectedOnboardingComplete: true
        });
        return fail(500, {
          step: 5,
          errors: { _form: message(error) },
          error: message(error)
        });
      }
      redirect(303, '/');
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'status' in error &&
        (error as { status: number }).status === 303
      )
        throw error;
      return sectionFailure(5, null, error);
    }
  }
};

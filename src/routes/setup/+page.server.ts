import { fail, redirect } from '@sveltejs/kit';
import { db, schema } from '$lib/server/db/index';
import {
  createSession,
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
  replaceSecret,
  saveSettings
} from '$lib/server/settings/store';
import {
  settingsSchema,
  validateSettings
} from '$lib/server/settings/validate';
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

export const load: PageServerLoad = async () => {
  const view = await getSetupView();
  if (view.settings?.onboardingComplete) redirect(303, '/');
  return view;
};

export const actions: Actions = {
  access: async ({ request, cookies, url }) => {
    const form = await request.formData();
    const password = raw(form, 'password');
    const confirmation = raw(form, 'passwordConfirm');
    if (password.length < 12 || password !== confirmation) {
      return fail(400, {
        step: 1,
        error:
          password.length < 12
            ? 'Use at least 12 characters'
            : 'Passwords do not match'
      });
    }

    const current = await getSafeSettings(db, schema, key());
    if (current && current.onboardingStep >= 1)
      return fail(409, {
        step: 1,
        error: 'Secure access is already configured'
      });

    try {
      const record = hashPassword(password);
      const at = Date.now();
      await db.insert(schema.localAdmin).values({
        id: 1,
        salt: record.salt,
        passwordHash: record.hash,
        createdAt: at,
        updatedAt: at
      });
      await saveSettings(db, schema, key(), { onboardingStep: 1 });
      cookie(cookies, url, await createSession(db, schema));
      return { step: 1, nextStep: 2, saved: true };
    } catch (error) {
      return fail(400, { step: 1, error: message(error) });
    }
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
      const current = requireStep(await getSafeSettings(db, schema, key()), 1);
      const gatekeeper = settingsSchema.shape.gatekeeper.unwrap().parse({
        type: values.type,
        baseUrl: values.baseUrl,
        ...(values.username && { username: values.username })
      });
      const credential =
        password || (await getSecret(db, schema, key(), 'gatekeeperPassword'));
      if (!credential) throw new Error('Gatekeeper password is required');

      const result = await testGatekeeper({ gatekeeper }, credential);
      if (result.kind !== 'connected')
        return fail(400, { step: 2, values, testStatus: result.kind });

      if (password)
        await replaceSecret(db, schema, key(), 'gatekeeperPassword', password);
      await saveSettings(db, schema, key(), {
        gatekeeper,
        onboardingStep: Math.max(current.onboardingStep, 2)
      });
      return {
        step: 2,
        nextStep: 3,
        saved: true,
        testStatus: 'connected' as const
      };
    } catch (error) {
      return fail(400, { step: 2, values, error: message(error) });
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

      for (const [name, value] of Object.entries(secrets) as [
        SettingsSecretName,
        string
      ][]) {
        if (value) await replaceSecret(db, schema, key(), name, value);
      }
      await saveSettings(db, schema, key(), patch);
      return { step: 3, nextStep: 4, saved: true };
    } catch (error) {
      return fail(400, { step: 3, values, error: message(error) });
    }
  },

  quotas: async ({ request }) => {
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
      await saveSettings(db, schema, key(), patch);
      return { step: 4, nextStep: 5, saved: true };
    } catch (error) {
      return fail(400, { step: 4, values, error: message(error) });
    }
  },

  activate: async () => {
    try {
      const settings = await getSettings(db, schema, key());
      if (!settings?.gatekeeper || settings.onboardingStep < 4)
        return fail(400, {
          step: 5,
          error: 'Complete and test every setup step before activation'
        });
      await saveSettings(db, schema, key(), {
        onboardingStep: 5,
        onboardingComplete: true,
        activated: true
      });
      try {
        await runtime.restart();
      } catch (error) {
        await saveSettings(db, schema, key(), {
          onboardingStep: 4,
          onboardingComplete: false,
          activated: false
        });
        return fail(500, { step: 5, error: message(error) });
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
      return fail(400, { step: 5, error: message(error) });
    }
  }
};

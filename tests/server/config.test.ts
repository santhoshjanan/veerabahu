import { describe, it, expect } from 'vitest';
import { loadConfig } from '$lib/server/config';
import { toRuntimeConfig } from '$lib/server/config';
import type { StoredSettings } from '$lib/server/settings/types';

const base = {
  VB_PIHOLE_BASE_URL: 'http://pi.hole/api',
  VB_PIHOLE_APP_PASSWORD: 'secret'
};

describe('loadConfig', () => {
  it('parses the required Pi-hole config and applies defaults', () => {
    const c = loadConfig({ ...base, VB_BLOCKLIST_PATH: '/legacy-custom.txt' });
    expect(c.pihole).toEqual({
      baseUrl: 'http://pi.hole/api',
      appPassword: 'secret'
    });
    expect(c.databaseUrl).toBe('file:./data/veerabahu.db');
    expect(c.ingestIntervalMs).toBe(15 * 60_000);
    expect(c.firstRunLookbackMs).toBe(24 * 3_600_000);
    expect(c.firstRunCap).toBe(5000);
    expect(c.maxReviewWaitMs).toBe(6 * 3_600_000);
    expect(c.blocklistPath).toBe('/blocklist.txt');
    expect(c.port).toBe(3000);
  });

  it('throws when a required var is missing', () => {
    expect(() => loadConfig({ VB_PIHOLE_BASE_URL: 'x' })).toThrow(
      /VB_PIHOLE_APP_PASSWORD/
    );
  });

  it('disables metadefender and llm when their vars are absent', () => {
    const c = loadConfig(base);
    expect(c.metadefender).toBeNull();
    expect(c.llm).toBeNull();
  });

  it('enables llm only when base url, key and model are all present', () => {
    expect(
      loadConfig({ ...base, VB_LLM_BASE_URL: 'http://x', VB_LLM_API_KEY: 'k' })
        .llm
    ).toBeNull();
    const c = loadConfig({
      ...base,
      VB_LLM_BASE_URL: 'http://localhost:11434/v1',
      VB_LLM_API_KEY: 'ollama',
      VB_LLM_MODEL: 'llama3.1'
    });
    expect(c.llm).toMatchObject({
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.1'
    });
  });

  it('keeps virustotal null when key present but not enabled', () => {
    expect(
      loadConfig({ ...base, VB_VIRUSTOTAL_API_KEY: 'k' }).virustotal
    ).toBeNull();
    expect(
      loadConfig({
        ...base,
        VB_VIRUSTOTAL_API_KEY: 'k',
        VB_VIRUSTOTAL_ENABLED: 'true'
      }).virustotal
    ).toEqual({ apiKey: 'k' });
  });

  it('splits VB_CURATED_LIST_URLS on commas and whitespace', () => {
    const c = loadConfig({
      ...base,
      VB_CURATED_LIST_URLS: 'https://a/x , https://b/y'
    });
    expect(c.curatedListUrls).toEqual(['https://a/x', 'https://b/y']);
  });
});

describe('toRuntimeConfig', () => {
  it('converts validated stored values and decrypted credentials', () => {
    const stored: StoredSettings = {
      version: 1,
      onboardingStep: 5,
      onboardingComplete: true,
      activated: true,
      gatekeeper: { type: 'pihole', baseUrl: 'http://pi.hole/api/' },
      sources: {
        curated_list: {
          enabled: true,
          baseUrl: null
        },
        metadefender: {
          enabled: true,
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
        ingestIntervalMinutes: 7,
        firstRunLookbackHours: 12,
        firstRunCap: 100,
        maxReviewWaitHours: 4,
        blocklistPath: '/custom.txt'
      },
      curatedListUrls: ['https://example.com/list.txt']
    };

    const runtime = toRuntimeConfig(
      stored,
      {
        gatekeeperPassword: 'gate-secret',
        metadefenderApiKey: 'md-secret'
      },
      { databaseUrl: 'file:test.db', port: 4000 }
    );

    expect(runtime.pihole).toEqual({
      baseUrl: 'http://pi.hole/api',
      appPassword: 'gate-secret'
    });
    expect(runtime.metadefender).toEqual({ apiKey: 'md-secret' });
    expect(runtime.ingestIntervalMs).toBe(7 * 60_000);
    expect(runtime.firstRunLookbackMs).toBe(12 * 3_600_000);
    expect(runtime.curatedListUrls).toEqual(['https://example.com/list.txt']);
    expect(runtime.databaseUrl).toBe('file:test.db');
    expect(runtime.port).toBe(4000);
    expect(runtime.blocklistPath).toBe('/blocklist.txt');
  });

  it('preserves an AdGuard gatekeeper discriminator without a Pi-hole alias', () => {
    const stored: StoredSettings = {
      version: 1,
      onboardingStep: 5,
      onboardingComplete: true,
      activated: true,
      gatekeeper: { type: 'adguard', baseUrl: 'http://adguard.local/' },
      sources: {
        curated_list: { enabled: true, baseUrl: null },
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

    const runtime = toRuntimeConfig(stored, {
      gatekeeperPassword: 'secret'
    });

    expect(runtime.gatekeeper).toEqual({
      type: 'adguard',
      baseUrl: 'http://adguard.local',
      credential: 'secret'
    });
    expect(runtime.pihole).toBeNull();
  });
});

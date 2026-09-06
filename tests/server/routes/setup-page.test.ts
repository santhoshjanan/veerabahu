import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from '../../../src/routes/setup/+page.svelte';
import type { SafeSettings } from '$lib/server/settings/types';

const settings: SafeSettings = {
  version: 1,
  onboardingStep: 4,
  onboardingComplete: false,
  activated: false,
  gatekeeper: {
    type: 'adguard',
    baseUrl: 'http://adguard.local',
    username: 'operator',
    secretConfigured: true
  },
  sources: {
    curated_list: {
      enabled: true,
      baseUrl: null,
      secretConfigured: false
    },
    metadefender: {
      enabled: false,
      baseUrl: 'https://api.metadefender.com/v4',
      secretConfigured: false
    },
    ai: {
      enabled: false,
      baseUrl: null,
      model: null,
      priceInputPerMTok: null,
      priceOutputPerMTok: null,
      secretConfigured: false
    },
    virustotal: {
      enabled: false,
      baseUrl: 'https://www.virustotal.com/api/v3',
      secretConfigured: false
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

describe('setup page', () => {
  it('keeps the successful connection status visible after advancing', () => {
    const { body } = render(Page, {
      props: {
        data: { step: 2, settings },
        form: { step: 2, nextStep: 3, testStatus: 'connected' }
      }
    });

    expect(body).toContain('Connected. Gatekeeper read access is working.');
  });

  it('reviews the AdGuard username and labels only curated lists as local', () => {
    const { body } = render(Page, {
      props: { data: { step: 5, settings }, form: null }
    });

    expect(body).toMatch(/<dt[^>]*>Username<\/dt><dd[^>]*>operator<\/dd>/);
    expect(body).toMatch(
      /<th[^>]*>Curated lists<\/th><td[^>]*>Enabled<\/td><td[^>]*>Local<\/td>/
    );
    expect(body).toMatch(
      /<th[^>]*>AI provider<\/th><td[^>]*>Disabled<\/td><td[^>]*>Not configured<\/td>/
    );
  });
});

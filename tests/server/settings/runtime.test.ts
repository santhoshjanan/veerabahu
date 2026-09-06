import { describe, expect, it, vi } from 'vitest';
import { makeRuntime } from '$lib/server/settings/runtime';
import type { StoredSettings } from '$lib/server/settings/types';

const settings: StoredSettings = {
  version: 1,
  onboardingStep: 4,
  onboardingComplete: false,
  activated: false,
  gatekeeper: { type: 'pihole', baseUrl: 'http://pi.hole' },
  sources: {
    curated_list: { enabled: true, baseUrl: null },
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
      perMinute: 2,
      perDay: 20,
      perMonth: 200,
      dailyCostCeilingUsd: null
    },
    ai: {
      perMinute: null,
      perDay: null,
      perMonth: null,
      dailyCostCeilingUsd: 1
    },
    virustotal: {
      perMinute: 4,
      perDay: 500,
      perMonth: 15_500,
      dailyCostCeilingUsd: null
    }
  },
  weights: { curated_list: 2, metadefender: 3, ai: 4, virustotal: 5 },
  scheduler: {
    ingestIntervalMinutes: 15,
    firstRunLookbackHours: 24,
    firstRunCap: 5000,
    maxReviewWaitHours: 6,
    blocklistPath: '/blocklist.txt'
  },
  curatedListUrls: ['https://example.com/domains.txt']
};

describe('settings runtime', () => {
  it('serializes concurrent starts and restarts without orphaning workers', async () => {
    let live = 0;
    let maximum = 0;
    const runtime = makeRuntime({
      loadSettings: async () => ({
        ...settings,
        onboardingComplete: true,
        activated: true
      }),
      loadSecret: async () => 'secret',
      startScheduler: async () => {
        maximum = Math.max(maximum, ++live);
        await Promise.resolve();
        return {
          stop: () => {
            live--;
          }
        };
      }
    });
    await Promise.all([
      runtime.startIfActive(),
      runtime.startIfActive(),
      runtime.restart(),
      runtime.restart()
    ]);
    expect(maximum).toBe(1);
    await runtime.stop();
    expect(live).toBe(0);
  });

  it('stops a scheduler whose startup is still pending', async () => {
    let finish!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const starting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let live = 0;
    const runtime = makeRuntime({
      loadSettings: async () => ({
        ...settings,
        onboardingComplete: true,
        activated: true
      }),
      loadSecret: async () => 'secret',
      startScheduler: async () => {
        entered();
        await pending;
        live++;
        return {
          stop: () => {
            live--;
          }
        };
      }
    });
    const start = runtime.startIfActive();
    await starting;
    const stop = runtime.stop();
    finish();
    await Promise.all([start, stop]);
    expect(live).toBe(0);
  });

  it('disables damaged optional credentials while retaining usable sources', async () => {
    let enabled: string[] = [];
    const runtime = makeRuntime({
      loadSettings: async () => ({
        ...settings,
        onboardingComplete: true,
        activated: true
      }),
      loadSecret: async (name) => {
        if (name === 'metadefenderApiKey')
          throw new Error('Cannot decrypt credential');
        return 'secret';
      },
      startScheduler: async (config) => {
        enabled = config.enabledSources;
        return { stop() {} };
      }
    });
    await runtime.startIfActive();
    expect(enabled).toEqual(['curated_list']);
  });
  it('does not start an incomplete installation', async () => {
    const startScheduler = vi.fn();
    const loadSecret = vi.fn();
    const runtime = makeRuntime({
      loadSettings: async () => settings,
      loadSecret,
      startScheduler
    });

    await runtime.startIfActive();

    expect(startScheduler).not.toHaveBeenCalled();
    expect(loadSecret).not.toHaveBeenCalled();
  });

  it('decrypts only active credentials and starts from stored settings', async () => {
    const active = {
      ...settings,
      onboardingComplete: true,
      activated: true
    };
    const loadSecret = vi.fn(async (name: string) => `${name}-secret`);
    const startScheduler = vi.fn(async () => ({ stop: vi.fn() }));
    const runtime = makeRuntime({
      loadSettings: async () => active,
      loadSecret,
      startScheduler
    });

    await runtime.startIfActive();

    expect(loadSecret.mock.calls.map(([name]) => name)).toEqual([
      'gatekeeperPassword',
      'metadefenderApiKey'
    ]);
    expect(startScheduler).toHaveBeenCalledWith(
      expect.objectContaining({
        weights: active.weights,
        quotas: expect.objectContaining({
          metadefender: {
            perMinute: 2,
            perDay: 20,
            perMonth: 200,
            dailyCostCeiling: null
          }
        })
      })
    );
  });

  it('carries disabled curated lists out of the active source set', async () => {
    const active = {
      ...settings,
      onboardingComplete: true,
      activated: true,
      sources: {
        ...settings.sources,
        curated_list: { ...settings.sources.curated_list, enabled: false }
      }
    };
    const startScheduler = vi.fn(async () => ({ stop: vi.fn() }));
    const runtime = makeRuntime({
      loadSettings: async () => active,
      loadSecret: async (name) => `${name}-secret`,
      startScheduler
    });

    await runtime.startIfActive();

    expect(startScheduler).toHaveBeenCalledWith(
      expect.objectContaining({ enabledSources: ['metadefender'] })
    );
  });

  it('stops the old scheduler before restarting', async () => {
    const stop = vi.fn();
    const startScheduler = vi.fn(async () => ({ stop }));
    const runtime = makeRuntime({
      loadSettings: async () => ({
        ...settings,
        onboardingComplete: true,
        activated: true
      }),
      loadSecret: async (name) => `${name}-secret`,
      startScheduler
    });

    await runtime.startIfActive();
    await runtime.restart();

    expect(stop).toHaveBeenCalledOnce();
    expect(startScheduler).toHaveBeenCalledTimes(2);
  });
});

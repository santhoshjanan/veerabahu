import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '$lib/server/config';

const mocks = vi.hoisted(() => ({
  runMigrations: vi.fn(async () => {}),
  startIngestion: vi.fn(),
  stopIngestion: vi.fn(),
  startDrainer: vi.fn(),
  stopDrainer: vi.fn()
}));

vi.mock('$lib/server/db/migrate', () => ({
  runMigrations: mocks.runMigrations
}));
vi.mock('$lib/server/reputation/registry', () => ({
  buildEnabledSources: () => ({ inline: null, paced: [], curated: null })
}));
vi.mock('$lib/server/adapters/gatekeeper/pihole', () => ({
  makePiholeAdapter: () => ({})
}));
vi.mock('$lib/server/ingestion/scheduler', () => ({
  makeIngestion: () => ({
    start: mocks.startIngestion,
    stop: mocks.stopIngestion
  })
}));
vi.mock('$lib/server/governor/drainer', () => ({
  makeDrainer: () => ({
    start: mocks.startDrainer,
    stop: mocks.stopDrainer
  })
}));

import { startBackground } from '$lib/server/bootstrap';

describe('legacy background startup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs migrations before starting scheduler loops', async () => {
    const handle = await startBackground({
      cfg: loadConfig({
        VB_PIHOLE_BASE_URL: 'http://pi.hole',
        VB_PIHOLE_APP_PASSWORD: 'secret'
      })
    });

    expect(mocks.runMigrations).toHaveBeenCalledOnce();
    expect(mocks.runMigrations.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.startIngestion.mock.invocationCallOrder[0]
    );
    handle.stop();
  });
});

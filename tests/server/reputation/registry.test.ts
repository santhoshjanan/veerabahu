import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db';
import { buildEnabledSources } from '$lib/server/reputation/registry';
import { loadConfig } from '$lib/server/config';

let closer: (() => void) | null = null;
afterEach(() => {
  closer?.();
  closer = null;
});

const baseEnv = {
  VB_PIHOLE_BASE_URL: 'http://x',
  VB_PIHOLE_APP_PASSWORD: 'p',
  VB_CURATED_LIST_URLS: 'http://x/l.txt'
};

describe('buildEnabledSources', () => {
  it('returns only curated when no source creds are set', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const { inline, paced } = buildEnabledSources(loadConfig(baseEnv), t.db, t.schema);
    expect(inline.name).toBe('curated_list');
    expect(paced).toHaveLength(0);
  });

  it('includes metadefender + ai + virustotal when all are configured', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const cfg = loadConfig({
      ...baseEnv,
      VB_METADEFENDER_API_KEY: 'm',
      VB_LLM_BASE_URL: 'http://l/v1',
      VB_LLM_API_KEY: 'k',
      VB_LLM_MODEL: 'x',
      VB_VIRUSTOTAL_API_KEY: 'v',
      VB_VIRUSTOTAL_ENABLED: 'true'
    });
    const { paced, curated } = buildEnabledSources(cfg, t.db, t.schema);
    expect(paced.map((s) => s.name).sort()).toEqual(['ai', 'metadefender', 'virustotal']);
    expect(typeof curated.refresh).toBe('function');
    expect(typeof curated.loadFromDb).toBe('function');
  });
});

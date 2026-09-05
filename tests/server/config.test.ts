import { describe, it, expect } from 'vitest';
import { loadConfig } from '$lib/server/config';

const base = {
  VB_PIHOLE_BASE_URL: 'http://pi.hole/api',
  VB_PIHOLE_APP_PASSWORD: 'secret'
};

describe('loadConfig', () => {
  it('parses the required Pi-hole config and applies defaults', () => {
    const c = loadConfig(base);
    expect(c.pihole).toEqual({ baseUrl: 'http://pi.hole/api', appPassword: 'secret' });
    expect(c.databaseUrl).toBe('file:./data/veerabahu.db');
    expect(c.ingestIntervalMs).toBe(15 * 60_000);
    expect(c.firstRunLookbackMs).toBe(24 * 3_600_000);
    expect(c.firstRunCap).toBe(5000);
    expect(c.maxReviewWaitMs).toBe(6 * 3_600_000);
    expect(c.blocklistPath).toBe('/blocklist.txt');
    expect(c.port).toBe(3000);
  });

  it('throws when a required var is missing', () => {
    expect(() => loadConfig({ VB_PIHOLE_BASE_URL: 'x' })).toThrow(/VB_PIHOLE_APP_PASSWORD/);
  });

  it('disables metadefender and llm when their vars are absent', () => {
    const c = loadConfig(base);
    expect(c.metadefender).toBeNull();
    expect(c.llm).toBeNull();
  });

  it('enables llm only when base url, key and model are all present', () => {
    expect(loadConfig({ ...base, VB_LLM_BASE_URL: 'http://x', VB_LLM_API_KEY: 'k' }).llm).toBeNull();
    const c = loadConfig({
      ...base,
      VB_LLM_BASE_URL: 'http://localhost:11434/v1',
      VB_LLM_API_KEY: 'ollama',
      VB_LLM_MODEL: 'llama3.1'
    });
    expect(c.llm).toMatchObject({ baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' });
  });

  it('keeps virustotal null when key present but not enabled', () => {
    expect(loadConfig({ ...base, VB_VIRUSTOTAL_API_KEY: 'k' }).virustotal).toBeNull();
    expect(
      loadConfig({ ...base, VB_VIRUSTOTAL_API_KEY: 'k', VB_VIRUSTOTAL_ENABLED: 'true' }).virustotal
    ).toEqual({ apiKey: 'k' });
  });

  it('splits VB_CURATED_LIST_URLS on commas and whitespace', () => {
    const c = loadConfig({ ...base, VB_CURATED_LIST_URLS: 'https://a/x , https://b/y' });
    expect(c.curatedListUrls).toEqual(['https://a/x', 'https://b/y']);
  });
});

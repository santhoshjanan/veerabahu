import { describe, it, expect } from 'vitest';
import { makeMetaDefenderSource } from '$lib/server/reputation/metadefender';
import type { AssessmentInput } from '$lib/server/reputation/types';

const input = {
  domain: 'bad.test',
  hitCount: 1,
  distinctClientCount: 1,
  curatedListHits: [],
  enrichment: { dns: null }
} as AssessmentInput;

const withBody = (body: unknown, status = 200) =>
  (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('MetaDefenderSource', () => {
  it('blocks when detected_by >= 1', async () => {
    const src = makeMetaDefenderSource({
      apiKey: 'k',
      fetchImpl: withBody({
        lookup_results: {
          detected_by: 3,
          sources: [{ provider: 'X', assessment: 'phishing', status: 1 }]
        }
      })
    });
    const v = await src.assess(input);
    expect(v.verdict).toBe('block');
    expect(v.confidence).toBeCloseTo(3 / 5);
    expect(v.category).toBe('phishing');
    expect(src.limits).toEqual({ perMinute: null, perDay: 4000 });
    expect(src.weight).toBe(1.0);
  });

  it('allows when detected_by === 0', async () => {
    const src = makeMetaDefenderSource({
      apiKey: 'k',
      fetchImpl: withBody({ lookup_results: { detected_by: 0, sources: [] } })
    });
    expect((await src.assess(input)).verdict).toBe('allow');
  });

  it('throws on HTTP error', async () => {
    const src = makeMetaDefenderSource({
      apiKey: 'k',
      fetchImpl: withBody({}, 429)
    });
    await expect(src.assess(input)).rejects.toThrow(/429/);
  });
});

import { describe, it, expect } from 'vitest';
import { makeVirusTotalSource } from '$lib/server/reputation/virustotal';
import type { AssessmentInput } from '$lib/server/reputation/types';

const input = {
  domain: 'bad.test',
  hitCount: 1,
  distinctClientCount: 1,
  curatedListHits: [],
  enrichment: { dns: null }
} as AssessmentInput;

const withBody = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('VirusTotalSource', () => {
  it('blocks when malicious+suspicious >= 1 and sets limits', async () => {
    const src = makeVirusTotalSource({
      apiKey: 'k',
      fetchImpl: withBody({
        data: {
          attributes: {
            last_analysis_stats: { malicious: 4, suspicious: 2, harmless: 10, undetected: 5 },
            categories: { X: 'advertising' }
          }
        }
      })
    });
    const v = await src.assess(input);
    expect(v.verdict).toBe('block');
    expect(v.confidence).toBeCloseTo((4 + 1) / 5); // 4 + 0.5*2 = 5
    expect(v.category).toBe('advertising');
    expect(src.limits).toEqual({ perMinute: 4, perDay: 500 });
    expect(src.weight).toBe(1.0);
  });

  it('allows when clean', async () => {
    const src = makeVirusTotalSource({
      apiKey: 'k',
      fetchImpl: withBody({
        data: { attributes: { last_analysis_stats: { malicious: 0, suspicious: 0, harmless: 80, undetected: 4 } } }
      })
    });
    expect((await src.assess(input)).verdict).toBe('allow');
  });

  it('throws on HTTP error', async () => {
    const src = makeVirusTotalSource({ apiKey: 'k', fetchImpl: withBody({}, 401) });
    await expect(src.assess(input)).rejects.toThrow(/401/);
  });
});

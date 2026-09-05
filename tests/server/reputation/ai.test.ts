import { describe, it, expect } from 'vitest';
import { makeAiSource, buildContext } from '$lib/server/reputation/ai';
import type { AssessmentInput } from '$lib/server/reputation/types';

const input: AssessmentInput = {
  domain: 'metrics.ads.test',
  hitCount: 12,
  distinctClientCount: 3,
  curatedListHits: ['oisd'],
  enrichment: { dns: { a: ['1.1.1.1'], cname: ['x'], ns: ['ns1'] } }
};

describe('buildContext', () => {
  it('produces a compact single-block string with the signals', () => {
    const c = buildContext(input);
    expect(c).toContain('hits=12');
    expect(c).toContain('clients=3');
    expect(c).toContain('curated_hits=oisd');
    expect(c).toContain('dns_a=1.1.1.1');
    expect(c).toContain('dns_cname=x');
    expect(c).toContain('dns_ns=ns1');
  });

  it('falls back gracefully when dns enrichment is missing', () => {
    const c = buildContext({
      ...input,
      curatedListHits: [],
      enrichment: { dns: null }
    });
    expect(c).toContain('curated_hits=none');
    expect(c).toContain('dns_a=none');
  });
});

describe('makeAiSource', () => {
  const provider = {
    assess: async () => ({
      verdict: 'block' as const,
      category: 'tracker',
      confidence: 0.77,
      reasoning: 'r',
      usage: { inputTokens: 200, outputTokens: 50 }
    })
  };

  it('maps the provider result and computes cost from prices', async () => {
    const src = makeAiSource({
      provider,
      priceInputPerMTok: 3,
      priceOutputPerMTok: 15
    });
    const v = await src.assess(input);
    expect(v).toMatchObject({
      verdict: 'block',
      category: 'tracker',
      confidence: 0.77
    });
    // 200/1e6*3 + 50/1e6*15 = 0.0006 + 0.00075 = 0.00135
    expect(v.usage!.costUsd).toBeCloseTo(0.00135, 8);
    expect(src.weight).toBe(0.6);
    expect(src.limits).toEqual({ perMinute: null, perDay: null });
  });

  it('reports zero cost when prices are not configured', async () => {
    const src = makeAiSource({
      provider,
      priceInputPerMTok: null,
      priceOutputPerMTok: null
    });
    const v = await src.assess(input);
    expect(v.usage!.costUsd).toBe(0);
  });
});

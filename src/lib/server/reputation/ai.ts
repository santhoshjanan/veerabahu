import {
  NO_LIMITS,
  type AssessmentInput,
  type ReputationSource,
  type SourceVerdict
} from './types';
import type { LlmProvider } from '../llm/types';

export function buildContext(input: AssessmentInput): string {
  const d = input.enrichment.dns;
  return [
    `hits=${input.hitCount}`,
    `clients=${input.distinctClientCount}`,
    `curated_hits=${input.curatedListHits.join(',') || 'none'}`,
    `dns_a=${d?.a.join(',') || 'none'}`,
    `dns_cname=${d?.cname.join(',') || 'none'}`,
    `dns_ns=${d?.ns.join(',') || 'none'}`
  ].join('\n');
}

export function makeAiSource(cfg: {
  provider: LlmProvider;
  priceInputPerMTok: number | null;
  priceOutputPerMTok: number | null;
}): ReputationSource {
  return {
    name: 'ai',
    weight: 0.6,
    limits: NO_LIMITS,
    async assess(input): Promise<SourceVerdict> {
      const r = await cfg.provider.assess({
        domain: input.domain,
        context: buildContext(input)
      });
      const costUsd =
        cfg.priceInputPerMTok != null && cfg.priceOutputPerMTok != null
          ? (r.usage.inputTokens / 1e6) * cfg.priceInputPerMTok +
            (r.usage.outputTokens / 1e6) * cfg.priceOutputPerMTok
          : 0;
      return {
        verdict: r.verdict,
        confidence: r.confidence,
        category: r.category,
        detail: r.reasoning.slice(0, 500),
        raw: r,
        usage: {
          inputTokens: r.usage.inputTokens,
          outputTokens: r.usage.outputTokens,
          costUsd
        }
      };
    }
  };
}

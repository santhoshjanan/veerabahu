export interface SourceLimits {
  perMinute: number | null;
  perDay: number | null;
  perMonth?: number | null;
  dailyCostCeiling?: number | null;
}

export interface AssessmentInput {
  domain: string;
  hitCount: number;
  distinctClientCount: number;
  curatedListHits: string[];
  enrichment: {
    dns: { a: string[]; cname: string[]; ns: string[] } | null;
  };
}

export interface SourceVerdict {
  verdict: 'block' | 'allow' | 'unsure';
  confidence: number;
  category: string | null;
  detail: string | null;
  raw: unknown;
  usage?: { inputTokens: number; outputTokens: number; costUsd: number };
}

export interface ReputationSource {
  readonly name: 'curated_list' | 'metadefender' | 'ai' | 'virustotal';
  readonly weight: number;
  readonly limits: SourceLimits;
  assess(input: AssessmentInput): Promise<SourceVerdict>;
}

export const NO_LIMITS: SourceLimits = { perMinute: null, perDay: null };

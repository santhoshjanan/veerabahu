export interface LlmAssessResult {
  verdict: 'block' | 'allow' | 'unsure';
  category: string | null;
  confidence: number;
  reasoning: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface LlmProvider {
  assess(req: { domain: string; context: string }): Promise<LlmAssessResult>;
}

export class LlmParseError extends Error {}

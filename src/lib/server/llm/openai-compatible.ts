import { z } from 'zod';
import { LlmParseError, type LlmAssessResult, type LlmProvider } from './types';

const Reply = z.object({
  verdict: z.enum(['block', 'allow', 'unsure']),
  category: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().default('')
});

const SYSTEM = `You are a DNS domain reputation classifier for an ad/tracker/malware blocklist.
Given a domain and context, decide whether it should be blocked.
Reply with a JSON object: {"verdict":"block"|"allow"|"unsure","category":string|null,"confidence":0..1,"reasoning":string}.`;

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* fall through */
    }
  }
  const brace = trimmed.match(/\{[\s\S]*\}/);
  if (brace) {
    try {
      return JSON.parse(brace[0]);
    } catch {
      /* fall through */
    }
  }
  return undefined;
}

export function makeOpenAiCompatibleProvider(cfg: {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): LlmProvider {
  const doFetch = cfg.fetchImpl ?? fetch;
  const timeout = cfg.timeoutMs ?? 30_000;

  async function call(messages: unknown[]): Promise<{
    content: string;
    usage: { inputTokens: number; outputTokens: number };
  }> {
    const res = await doFetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({ model: cfg.model, temperature: 0, messages }),
      signal: AbortSignal.timeout(timeout)
    });
    if (!res.ok) throw new LlmParseError(`LLM HTTP ${res.status}`);
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      content: body.choices?.[0]?.message?.content ?? '',
      usage: {
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0
      }
    };
  }

  return {
    async assess(req): Promise<LlmAssessResult> {
      const user = `Domain: ${req.domain}\nContext:\n${req.context}`;
      const systems = [
        SYSTEM,
        SYSTEM + '\nReturn ONLY minified JSON. No prose, no code fences.'
      ];

      let lastUsage = { inputTokens: 0, outputTokens: 0 };
      for (const system of systems) {
        const { content, usage } = await call([
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]);
        lastUsage = usage;
        const parsed = Reply.safeParse(extractJson(content));
        if (parsed.success) {
          return {
            verdict: parsed.data.verdict,
            category: parsed.data.category,
            confidence: parsed.data.confidence,
            reasoning: parsed.data.reasoning,
            usage
          };
        }
      }
      throw new LlmParseError(
        `LLM reply not parseable after retry (tokens in=${lastUsage.inputTokens})`
      );
    }
  };
}

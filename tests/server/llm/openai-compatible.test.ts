import { describe, it, expect } from 'vitest';
import { makeOpenAiCompatibleProvider } from '$lib/server/llm/openai-compatible';
import { LlmParseError } from '$lib/server/llm/types';

const mkFetch = (bodies: string[]) => {
  let i = 0;
  return (async (_url: string, init: RequestInit) => {
    const content = bodies[Math.min(i++, bodies.length - 1)];
    return new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 }
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;
};

const provider = (f: typeof fetch) =>
  makeOpenAiCompatibleProvider({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm', fetchImpl: f });

describe('OpenAiCompatibleProvider', () => {
  it('parses a clean JSON reply and returns usage', async () => {
    const p = provider(
      mkFetch([
        '{"verdict":"block","category":"ad","confidence":0.8,"reasoning":"tracker domain"}'
      ])
    );
    const r = await p.assess({ domain: 'ads.x.com', context: 'hits=5' });
    expect(r).toEqual({
      verdict: 'block',
      category: 'ad',
      confidence: 0.8,
      reasoning: 'tracker domain',
      usage: { inputTokens: 100, outputTokens: 20 }
    });
  });

  it('recovers by retrying once when the first reply has prose around the JSON', async () => {
    const p = provider(
      mkFetch([
        'Sure! Here you go:\n```json\n{"verdict":"allow","confidence":0.2}\n``` hope that helps',
        '{"verdict":"allow","category":null,"confidence":0.2,"reasoning":""}'
      ])
    );
    const r = await p.assess({ domain: 'cdn.x.com', context: '' });
    expect(r.verdict).toBe('allow');
  });

  it('throws LlmParseError when both attempts are unusable', async () => {
    const p = provider(mkFetch(['not json at all', 'still not json']));
    await expect(p.assess({ domain: 'x.com', context: '' })).rejects.toBeInstanceOf(LlmParseError);
  });

  it('defaults usage to zero when the server omits it', async () => {
    const f = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"verdict":"unsure","confidence":0.5}' } }]
        }),
        { status: 200 }
      )) as unknown as typeof fetch;
    const r = await provider(f).assess({ domain: 'x.com', context: '' });
    expect(r.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

import type { ReputationSource, SourceVerdict } from './types';

export function makeMetaDefenderSource(cfg: {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): ReputationSource {
  const doFetch = cfg.fetchImpl ?? fetch;
  const baseUrl = (cfg.baseUrl ?? 'https://api.metadefender.com/v4').replace(
    /\/+$/,
    ''
  );
  return {
    name: 'metadefender',
    weight: 1.0,
    limits: { perMinute: null, perDay: 4000 },
    async assess(input): Promise<SourceVerdict> {
      const res = await doFetch(
        `${baseUrl}/domain/${encodeURIComponent(input.domain)}`,
        { headers: { apikey: cfg.apiKey }, signal: AbortSignal.timeout(15_000) }
      );
      if (!res.ok) throw new Error(`MetaDefender HTTP ${res.status}`);
      const body = (await res.json()) as {
        lookup_results?: {
          detected_by?: number;
          sources?: Array<{ assessment?: string; status?: number }>;
        };
      };
      const detected = body.lookup_results?.detected_by ?? 0;
      if (detected >= 1) {
        const mal = body.lookup_results?.sources?.find(
          (s) => (s.status ?? 0) === 1
        );
        return {
          verdict: 'block',
          confidence: Math.min(1, detected / 5),
          category: mal?.assessment ?? 'malware',
          detail: `${detected} MetaDefender source(s) flagged this`,
          raw: body
        };
      }
      return {
        verdict: 'allow',
        confidence: 0.5,
        category: null,
        detail: 'no MetaDefender detections',
        raw: body
      };
    }
  };
}

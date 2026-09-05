import type { ReputationSource, SourceVerdict } from './types';

export function makeVirusTotalSource(cfg: { apiKey: string; fetchImpl?: typeof fetch }): ReputationSource {
  const doFetch = cfg.fetchImpl ?? fetch;
  return {
    name: 'virustotal',
    weight: 1.0,
    limits: { perMinute: 4, perDay: 500 },
    async assess(input): Promise<SourceVerdict> {
      const res = await doFetch(
        `https://www.virustotal.com/api/v3/domains/${encodeURIComponent(input.domain)}`,
        { headers: { 'x-apikey': cfg.apiKey }, signal: AbortSignal.timeout(15_000) }
      );
      if (!res.ok) throw new Error(`VirusTotal HTTP ${res.status}`);
      const body = (await res.json()) as {
        data?: { attributes?: { last_analysis_stats?: Record<string, number>; categories?: Record<string, string> } };
      };
      const s = body.data?.attributes?.last_analysis_stats ?? {};
      const mal = s.malicious ?? 0;
      const susp = s.suspicious ?? 0;
      if (mal + susp >= 1) {
        const category = Object.values(body.data?.attributes?.categories ?? {})[0] ?? 'malware';
        return {
          verdict: 'block',
          confidence: Math.min(1, (mal + 0.5 * susp) / 5),
          category,
          detail: `VirusTotal: ${mal} malicious / ${susp} suspicious`,
          raw: body
        };
      }
      return { verdict: 'allow', confidence: 0.5, category: null, detail: 'VirusTotal: clean', raw: body };
    }
  };
}

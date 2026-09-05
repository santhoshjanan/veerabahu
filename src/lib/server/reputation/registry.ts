import type { Config } from '../config';
import { makeCuratedListSource } from './curated-list';
import { makeMetaDefenderSource } from './metadefender';
import { makeAiSource } from './ai';
import { makeVirusTotalSource } from './virustotal';
import { makeOpenAiCompatibleProvider } from '../llm/openai-compatible';
import type { ReputationSource } from './types';

export function buildEnabledSources(cfg: Config, db: any, schema: any) {
  const curated = makeCuratedListSource(db, schema, {
    urls: cfg.curatedListUrls
  });
  const paced: ReputationSource[] = [];

  if (cfg.metadefender)
    paced.push(makeMetaDefenderSource({ apiKey: cfg.metadefender.apiKey }));
  if (cfg.llm) {
    const provider = makeOpenAiCompatibleProvider({
      baseUrl: cfg.llm.baseUrl,
      apiKey: cfg.llm.apiKey,
      model: cfg.llm.model
    });
    paced.push(
      makeAiSource({
        provider,
        priceInputPerMTok: cfg.llm.priceInputPerMTok,
        priceOutputPerMTok: cfg.llm.priceOutputPerMTok
      })
    );
  }
  if (cfg.virustotal)
    paced.push(makeVirusTotalSource({ apiKey: cfg.virustotal.apiKey }));

  return { inline: curated as ReputationSource, paced, curated };
}

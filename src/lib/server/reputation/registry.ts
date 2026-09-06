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

  const configured = (source: ReputationSource): ReputationSource =>
    Object.assign(source, {
      weight: cfg.weights[source.name],
      limits: cfg.quotas[source.name]
    });

  if (cfg.metadefender)
    paced.push(
      configured(
        makeMetaDefenderSource({
          apiKey: cfg.metadefender.apiKey,
          baseUrl: cfg.sourceBaseUrls.metadefender ?? undefined
        })
      )
    );
  if (cfg.llm) {
    const provider = makeOpenAiCompatibleProvider({
      baseUrl: cfg.llm.baseUrl,
      apiKey: cfg.llm.apiKey,
      model: cfg.llm.model
    });
    paced.push(
      configured(
        makeAiSource({
          provider,
          priceInputPerMTok: cfg.llm.priceInputPerMTok,
          priceOutputPerMTok: cfg.llm.priceOutputPerMTok
        })
      )
    );
  }
  if (cfg.virustotal)
    paced.push(
      configured(
        makeVirusTotalSource({
          apiKey: cfg.virustotal.apiKey,
          baseUrl: cfg.sourceBaseUrls.virustotal ?? undefined
        })
      )
    );

  return { inline: configured(curated), paced, curated };
}

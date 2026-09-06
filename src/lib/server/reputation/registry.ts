import type { Config } from '../config';
import { makeCuratedListSource } from './curated-list';
import { makeMetaDefenderSource } from './metadefender';
import { makeAiSource } from './ai';
import { makeVirusTotalSource } from './virustotal';
import { makeOpenAiCompatibleProvider } from '../llm/openai-compatible';
import type { ReputationSource } from './types';

export function buildEnabledSources(cfg: Config, db: any, schema: any) {
  const enabled = new Set(cfg.enabledSources);
  const curated = enabled.has('curated_list')
    ? makeCuratedListSource(db, schema, { urls: cfg.curatedListUrls })
    : null;
  const paced: ReputationSource[] = [];

  const configured = (source: ReputationSource): ReputationSource =>
    Object.assign(source, {
      weight: cfg.weights[source.name],
      limits: cfg.quotas[source.name]
    });

  if (enabled.has('metadefender') && cfg.metadefender)
    paced.push(
      configured(
        makeMetaDefenderSource({
          apiKey: cfg.metadefender.apiKey,
          baseUrl: cfg.sourceBaseUrls.metadefender ?? undefined
        })
      )
    );
  if (enabled.has('ai') && cfg.llm) {
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
  if (enabled.has('virustotal') && cfg.virustotal)
    paced.push(
      configured(
        makeVirusTotalSource({
          apiKey: cfg.virustotal.apiKey,
          baseUrl: cfg.sourceBaseUrls.virustotal ?? undefined
        })
      )
    );

  return { inline: curated ? configured(curated) : null, paced, curated };
}

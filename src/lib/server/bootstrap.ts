import { loadConfig } from './config';
import { db, schema } from './db/index';
import { runMigrations } from './db/migrate';
import { makePiholeAdapter } from './adapters/gatekeeper/pihole';
import { buildEnabledSources } from './reputation/registry';
import { makeDnsLookup } from './enrichment/dns';
import { makeIngestion } from './ingestion/scheduler';
import { makeDrainer } from './governor/drainer';
import type { SourceName } from './db/types';

let started: { stop: () => void } | null = null;

export async function startBackground(opts?: {
  disabled?: boolean;
}): Promise<{ stop: () => void }> {
  const disabled =
    opts?.disabled ?? process.env.VB_DISABLE_SCHEDULERS === 'true';
  if (disabled) return { stop: () => {} };
  if (started) return started;

  const cfg = loadConfig(process.env as Record<string, string | undefined>);
  await runMigrations();

  const { paced, curated } = buildEnabledSources(cfg, db, schema);
  const eligible: SourceName[] = ['curated_list', ...paced.map((s) => s.name)];

  await curated.loadFromDb();
  void curated.refresh().catch(() => {});

  const dns = makeDnsLookup();
  const enrich = async (domain: string) => ({ dns: await dns(domain) });

  const adapter = makePiholeAdapter({
    baseUrl: cfg.pihole.baseUrl,
    appPassword: cfg.pihole.appPassword
  });

  const ingestion = makeIngestion({
    db,
    schema,
    cfg,
    adapter,
    curated,
    eligibleSourceNames: eligible
  });

  const drainer = makeDrainer({
    db,
    schema,
    cfg,
    pacedSources: paced,
    eligibleSourceNames: eligible,
    enrich,
    curatedHits: (d) => (curated.has(d) ? ['curated'] : [])
  });

  ingestion.start();
  drainer.start();

  started = {
    stop: () => {
      ingestion.stop();
      drainer.stop();
      started = null;
    }
  };

  return started;
}

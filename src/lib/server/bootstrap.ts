import { loadConfig, type Config } from './config';
import { db, schema } from './db/index';
import { runMigrations } from './db/migrate';
import type { GatekeeperAdapter } from './adapters/gatekeeper/types';
import { makePiholeAdapter } from './adapters/gatekeeper/pihole';
import { makeAdguardAdapter } from './adapters/gatekeeper/adguard';
import { buildEnabledSources } from './reputation/registry';
import { makeDnsLookup } from './enrichment/dns';
import { makeIngestion } from './ingestion/scheduler';
import { makeDrainer } from './governor/drainer';
import type { SourceName } from './db/types';

export async function startBackground(opts?: {
  disabled?: boolean;
  cfg?: Config;
  adapter?: GatekeeperAdapter;
}): Promise<{ stop: () => void | Promise<void> }> {
  const disabled =
    opts?.disabled ?? process.env.VB_DISABLE_SCHEDULERS === 'true';
  if (disabled) return { stop: () => {} };
  const cfg =
    opts?.cfg ?? loadConfig(process.env as Record<string, string | undefined>);
  await runMigrations();

  const { paced, curated } = buildEnabledSources(cfg, db, schema);
  const eligible: SourceName[] = [
    ...(curated ? (['curated_list'] as const) : []),
    ...paced.map((s) => s.name)
  ];

  if (curated) {
    await curated.loadFromDb();
    void curated.refresh().catch(() => {});
  }

  const dns = makeDnsLookup();
  const enrich = async (domain: string) => ({ dns: await dns(domain) });

  const adapter = opts?.adapter ?? makeConfiguredGatekeeperAdapter(cfg);

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
    curatedHits: (d) => (curated?.has(d) ? ['curated'] : [])
  });

  ingestion.start();
  drainer.start();

  return {
    stop: async () => {
      await Promise.all([ingestion.stop(), drainer.stop()]);
    }
  };
}

export function makeConfiguredGatekeeperAdapter(
  cfg: Config
): GatekeeperAdapter {
  return cfg.gatekeeper.type === 'adguard'
    ? makeAdguardAdapter({
        baseUrl: cfg.gatekeeper.baseUrl,
        password: cfg.gatekeeper.credential,
        username: cfg.gatekeeper.username
      })
    : makePiholeAdapter({
        baseUrl: cfg.pihole!.baseUrl,
        appPassword: cfg.pihole!.appPassword
      });
}

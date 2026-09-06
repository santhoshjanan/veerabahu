import { toRuntimeConfig, type Config } from '../config';
import type {
  SettingsSecretName,
  SettingsSecrets,
  StoredSettings
} from './types';
import type { GatekeeperAdapter } from '../adapters/gatekeeper/types';

interface RuntimeHandle {
  stop(): void;
}

interface RuntimeDeps {
  loadSettings(): Promise<StoredSettings | null>;
  loadSecret(name: SettingsSecretName): Promise<string | null>;
  startScheduler(config: Config): Promise<RuntimeHandle>;
}

const sourceSecrets = {
  metadefender: 'metadefenderApiKey',
  ai: 'aiApiKey',
  virustotal: 'virustotalApiKey'
} as const;

export function makeRuntime(deps: RuntimeDeps) {
  let started: RuntimeHandle | null = null;

  async function startIfActive(): Promise<void> {
    if (started) return;
    const settings = await deps.loadSettings();
    if (!settings?.onboardingComplete || !settings.activated) return;

    const secrets: SettingsSecrets = {};
    const gatekeeperPassword = await deps.loadSecret('gatekeeperPassword');
    if (gatekeeperPassword) secrets.gatekeeperPassword = gatekeeperPassword;
    for (const [source, secret] of Object.entries(sourceSecrets) as [
      keyof typeof sourceSecrets,
      (typeof sourceSecrets)[keyof typeof sourceSecrets]
    ][]) {
      if (!settings.sources[source].enabled) continue;
      const value = await deps.loadSecret(secret);
      if (value) secrets[secret] = value;
    }

    started = await deps.startScheduler(toRuntimeConfig(settings, secrets));
  }

  function stop(): void {
    started?.stop();
    started = null;
  }

  return {
    startIfActive,
    async restart(): Promise<void> {
      stop();
      await startIfActive();
    },
    stop
  };
}

export const runtime = makeRuntime({
  async loadSettings() {
    const [{ db, schema }, { runMigrations }, { parseMasterKey }, store] =
      await Promise.all([
        import('../db'),
        import('../db/migrate'),
        import('./crypto'),
        import('./store')
      ]);
    await runMigrations();
    parseMasterKey(process.env.VB_MASTER_KEY ?? '');
    return store.getStoredSettings(db, schema);
  },
  async loadSecret(name) {
    const [{ db, schema }, { parseMasterKey }, store] = await Promise.all([
      import('../db'),
      import('./crypto'),
      import('./store')
    ]);
    return store.getSecret(
      db,
      schema,
      parseMasterKey(process.env.VB_MASTER_KEY ?? ''),
      name
    );
  },
  async startScheduler(config) {
    const [{ startBackground }, { makePiholeAdapter }, { makeAdguardAdapter }] =
      await Promise.all([
        import('../bootstrap'),
        import('../adapters/gatekeeper/pihole'),
        import('../adapters/gatekeeper/adguard')
      ]);
    const adapter: GatekeeperAdapter =
      config.gatekeeper.type === 'adguard'
        ? makeAdguardAdapter({
            baseUrl: config.gatekeeper.baseUrl,
            password: config.gatekeeper.credential,
            username: config.gatekeeper.username
          })
        : makePiholeAdapter({
            baseUrl: config.pihole!.baseUrl,
            appPassword: config.pihole!.appPassword
          });
    return startBackground({ cfg: config, adapter });
  }
});

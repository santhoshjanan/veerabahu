export type GatekeeperType = 'pihole' | 'adguard';

export type SettingsSecretName =
  'gatekeeperPassword' | 'metadefenderApiKey' | 'aiApiKey' | 'virustotalApiKey';

export interface SourceLimits {
  perMinute: number | null;
  perDay: number | null;
  perMonth: number | null;
  dailyCostCeilingUsd: number | null;
}

export interface SourceSettings {
  enabled: boolean;
  baseUrl: string | null;
}

export interface AiSourceSettings extends SourceSettings {
  model: string | null;
  priceInputPerMTok: number | null;
  priceOutputPerMTok: number | null;
}

export interface StoredSettings {
  version: 1;
  onboardingStep: number;
  onboardingComplete: boolean;
  activated: boolean;
  gatekeeper: { type: GatekeeperType; baseUrl: string } | null;
  sources: {
    curated_list: SourceSettings;
    metadefender: SourceSettings;
    ai: AiSourceSettings;
    virustotal: SourceSettings;
  };
  quotas: Record<
    'curated_list' | 'metadefender' | 'ai' | 'virustotal',
    SourceLimits
  >;
  weights: Record<
    'curated_list' | 'metadefender' | 'ai' | 'virustotal',
    number
  >;
  scheduler: {
    ingestIntervalMinutes: number;
    firstRunLookbackHours: number;
    firstRunCap: number;
    maxReviewWaitHours: number;
    blocklistPath: string;
  };
  curatedListUrls: string[];
}

type SafeSource<T extends SourceSettings> = T & {
  secretConfigured: boolean;
};

export type SafeSettings = Omit<StoredSettings, 'gatekeeper' | 'sources'> & {
  gatekeeper:
    | (NonNullable<StoredSettings['gatekeeper']> & {
        secretConfigured: boolean;
      })
    | null;
  sources: {
    curated_list: SafeSource<SourceSettings>;
    metadefender: SafeSource<SourceSettings>;
    ai: SafeSource<AiSourceSettings>;
    virustotal: SafeSource<SourceSettings>;
  };
};

export type SettingsSecrets = Partial<Record<SettingsSecretName, string>>;

export type SettingsPatch = Partial<StoredSettings>;

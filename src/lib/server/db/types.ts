import type { InferSelectModel } from 'drizzle-orm';
import type * as sqliteSchema from './schema.sqlite';

export type DomainState =
  | 'observed'
  | 'assessing'
  | 'pending_review'
  | 'auto_cleared'
  | 'approved'
  | 'rejected';

export type SourceName = 'curated_list' | 'metadefender' | 'ai' | 'virustotal';

export type VerdictValue = 'block' | 'allow' | 'unsure' | 'error';

export const DOMAIN_STATES: DomainState[] = [
  'observed',
  'assessing',
  'pending_review',
  'auto_cleared',
  'approved',
  'rejected'
];
export const SOURCE_NAMES: SourceName[] = ['curated_list', 'metadefender', 'ai', 'virustotal'];
export const VERDICT_VALUES: VerdictValue[] = ['block', 'allow', 'unsure', 'error'];

// Row types — both dialects have identical column sets (enforced by schema parity test),
// so the SQLite schema is the single source of truth for app-facing row shapes.
export type DomainRow = InferSelectModel<typeof sqliteSchema.domains>;
export type VerdictRow = InferSelectModel<typeof sqliteSchema.verdicts>;
export type SourceRateStateRow = InferSelectModel<typeof sqliteSchema.sourceRateState>;
export type AllowlistRow = InferSelectModel<typeof sqliteSchema.allowlist>;
export type CuratedDomainRow = InferSelectModel<typeof sqliteSchema.curatedDomains>;
export type CuratedListRow = InferSelectModel<typeof sqliteSchema.curatedLists>;
export type AuditLogRow = InferSelectModel<typeof sqliteSchema.auditLog>;
export type BlocklistFetchLogRow = InferSelectModel<typeof sqliteSchema.blocklistFetchLog>;
export type IngestStateRow = InferSelectModel<typeof sqliteSchema.ingestState>;

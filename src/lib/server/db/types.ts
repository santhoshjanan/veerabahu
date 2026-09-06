import type { InferSelectModel } from 'drizzle-orm';
import type * as sqliteSchema from './schema.sqlite';

// Domain enums live in a client-safe module; re-exported here so server-side
// importers of $lib/server/db/types keep working unchanged.
// Relative path (not $lib) so the chain resolves under non-Vite loaders too
// (e.g. Playwright's globalSetup transpiling tests/e2e/seed.ts → schema → types).
export type {
  DomainState,
  SourceName,
  VerdictValue
} from '../../domain-constants';
export {
  DOMAIN_STATES,
  SOURCE_NAMES,
  VERDICT_VALUES
} from '../../domain-constants';

// Row types — both dialects have identical column sets (enforced by schema parity test),
// so the SQLite schema is the single source of truth for app-facing row shapes.
export type DomainRow = InferSelectModel<typeof sqliteSchema.domains>;
export type VerdictRow = InferSelectModel<typeof sqliteSchema.verdicts>;
export type SourceRateStateRow = InferSelectModel<
  typeof sqliteSchema.sourceRateState
>;
export type AllowlistRow = InferSelectModel<typeof sqliteSchema.allowlist>;
export type CuratedDomainRow = InferSelectModel<
  typeof sqliteSchema.curatedDomains
>;
export type CuratedListRow = InferSelectModel<typeof sqliteSchema.curatedLists>;
export type AuditLogRow = InferSelectModel<typeof sqliteSchema.auditLog>;
export type BlocklistFetchLogRow = InferSelectModel<
  typeof sqliteSchema.blocklistFetchLog
>;
export type IngestStateRow = InferSelectModel<typeof sqliteSchema.ingestState>;
export type AppConfigRow = InferSelectModel<typeof sqliteSchema.appConfig>;
export type ConfigSecretRow = InferSelectModel<
  typeof sqliteSchema.configSecrets
>;
export type LocalAdminRow = InferSelectModel<typeof sqliteSchema.localAdmin>;
export type SessionRow = InferSelectModel<typeof sqliteSchema.sessions>;

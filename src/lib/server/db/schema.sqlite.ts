import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  real,
  sqliteTable,
  text,
  primaryKey,
  uniqueIndex
} from 'drizzle-orm/sqlite-core';
import { DOMAIN_STATES, SOURCE_NAMES, VERDICT_VALUES } from './types';

const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);

export const domains = sqliteTable(
  'domains',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    domain: text('domain').notNull().unique(),
    firstSeen: integer('first_seen').notNull(),
    lastSeen: integer('last_seen').notNull(),
    hitCount: integer('hit_count').notNull().default(0),
    state: text('state').notNull().default('observed'),
    score: real('score'),
    decidedAt: integer('decided_at'),
    decisionNote: text('decision_note')
  },
  () => ({
    stateCheck: check('domains_state_check', inList('state', DOMAIN_STATES))
  })
);

export const verdicts = sqliteTable(
  'verdicts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    domainId: integer('domain_id')
      .notNull()
      .references(() => domains.id),
    source: text('source').notNull(),
    verdict: text('verdict').notNull(),
    confidence: real('confidence').notNull(),
    category: text('category'),
    detail: text('detail'),
    raw: text('raw', { mode: 'json' }).notNull(),
    assessedAt: integer('assessed_at').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: real('cost_usd')
  },
  (t) => ({
    uniq: uniqueIndex('verdicts_domain_source_uniq').on(t.domainId, t.source),
    sourceCheck: check('verdicts_source_check', inList('source', SOURCE_NAMES)),
    verdictCheck: check(
      'verdicts_verdict_check',
      inList('verdict', VERDICT_VALUES)
    )
  })
);

export const sourceRateState = sqliteTable('source_rate_state', {
  source: text('source').primaryKey(),
  tokens: real('tokens').notNull(),
  lastRefill: integer('last_refill').notNull(),
  dayCount: integer('day_count').notNull().default(0),
  dayStart: integer('day_start').notNull(),
  monthCount: integer('month_count').notNull().default(0),
  monthStart: integer('month_start').notNull(),
  lastCallAt: integer('last_call_at'),
  pausedUntil: integer('paused_until')
});

export const allowlist = sqliteTable('allowlist', {
  domain: text('domain').primaryKey(),
  reason: text('reason').notNull(),
  addedAt: integer('added_at').notNull()
});

export const curatedDomains = sqliteTable(
  'curated_domains',
  {
    domain: text('domain').notNull(),
    sourceList: text('source_list').notNull()
  },
  (t) => ({ pk: primaryKey({ columns: [t.domain, t.sourceList] }) })
);

export const curatedLists = sqliteTable('curated_lists', {
  name: text('name').primaryKey(),
  url: text('url').notNull(),
  lastFetched: integer('last_fetched'),
  entryCount: integer('entry_count').notNull().default(0),
  lastError: text('last_error')
});

export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: integer('at').notNull(),
  actor: text('actor').notNull(),
  domainId: integer('domain_id'),
  event: text('event').notNull(),
  data: text('data', { mode: 'json' }).notNull()
});

export const blocklistFetchLog = sqliteTable('blocklist_fetch_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: integer('at').notNull(),
  ip: text('ip').notNull(),
  userAgent: text('user_agent'),
  status: integer('status').notNull()
});

export const ingestState = sqliteTable('ingest_state', {
  id: integer('id').primaryKey(),
  cursor: text('cursor'),
  lastIngestAt: integer('last_ingest_at'),
  firstRunDone: integer('first_run_done', { mode: 'boolean' })
    .notNull()
    .default(false)
});

export const appConfig = sqliteTable('app_config', {
  id: integer('id').primaryKey(),
  version: integer('version').notNull().default(1),
  config: text('config', { mode: 'json' }).notNull(),
  onboardingStep: integer('onboarding_step').notNull().default(0),
  onboardingComplete: integer('onboarding_complete', { mode: 'boolean' })
    .notNull()
    .default(false),
  activated: integer('activated', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
});

export const configSecrets = sqliteTable('config_secrets', {
  name: text('name').primaryKey(),
  payload: text('payload').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
});

export const localAdmin = sqliteTable('local_admin', {
  id: integer('id').primaryKey(),
  salt: text('salt').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
});

export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
  invalidatedAt: integer('invalidated_at')
});

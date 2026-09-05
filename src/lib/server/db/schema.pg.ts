import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex
} from 'drizzle-orm/pg-core';
import { DOMAIN_STATES, SOURCE_NAMES, VERDICT_VALUES } from './types';

const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);
const ts = (name: string) => bigint(name, { mode: 'number' });

export const domains = pgTable(
  'domains',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    domain: text('domain').notNull().unique(),
    firstSeen: ts('first_seen').notNull(),
    lastSeen: ts('last_seen').notNull(),
    hitCount: integer('hit_count').notNull().default(0),
    state: text('state').notNull().default('observed'),
    score: doublePrecision('score'),
    decidedAt: ts('decided_at'),
    decisionNote: text('decision_note')
  },
  () => ({
    stateCheck: check('domains_state_check', inList('state', DOMAIN_STATES))
  })
);

export const verdicts = pgTable(
  'verdicts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    domainId: integer('domain_id')
      .notNull()
      .references(() => domains.id),
    source: text('source').notNull(),
    verdict: text('verdict').notNull(),
    confidence: doublePrecision('confidence').notNull(),
    category: text('category'),
    detail: text('detail'),
    raw: jsonb('raw').notNull(),
    assessedAt: ts('assessed_at').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: doublePrecision('cost_usd')
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

export const sourceRateState = pgTable('source_rate_state', {
  source: text('source').primaryKey(),
  tokens: doublePrecision('tokens').notNull(),
  lastRefill: ts('last_refill').notNull(),
  dayCount: integer('day_count').notNull().default(0),
  dayStart: ts('day_start').notNull(),
  monthCount: integer('month_count').notNull().default(0),
  monthStart: ts('month_start').notNull(),
  lastCallAt: ts('last_call_at'),
  pausedUntil: ts('paused_until')
});

export const allowlist = pgTable('allowlist', {
  domain: text('domain').primaryKey(),
  reason: text('reason').notNull(),
  addedAt: ts('added_at').notNull()
});

export const curatedDomains = pgTable(
  'curated_domains',
  {
    domain: text('domain').notNull(),
    sourceList: text('source_list').notNull()
  },
  (t) => ({ pk: primaryKey({ columns: [t.domain, t.sourceList] }) })
);

export const curatedLists = pgTable('curated_lists', {
  name: text('name').primaryKey(),
  url: text('url').notNull(),
  lastFetched: ts('last_fetched'),
  entryCount: integer('entry_count').notNull().default(0),
  lastError: text('last_error')
});

export const auditLog = pgTable('audit_log', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  at: ts('at').notNull(),
  actor: text('actor').notNull(),
  domainId: integer('domain_id'),
  event: text('event').notNull(),
  data: jsonb('data').notNull()
});

export const blocklistFetchLog = pgTable('blocklist_fetch_log', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  at: ts('at').notNull(),
  ip: text('ip').notNull(),
  userAgent: text('user_agent'),
  status: integer('status').notNull()
});

export const ingestState = pgTable('ingest_state', {
  id: integer('id').primaryKey(),
  cursor: text('cursor'),
  lastIngestAt: ts('last_ingest_at'),
  firstRunDone: boolean('first_run_done').notNull().default(false)
});

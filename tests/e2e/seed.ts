// tests/e2e/seed.ts — build a deterministic SQLite DB for the E2E preview server.
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../src/lib/server/db/schema.sqlite';
import {
  importEnvironmentOnce,
  saveSetupSection
} from '../../src/lib/server/settings/store';
import { hashPassword } from '../../src/lib/server/settings/crypto';

export const E2E_DB_PATH = 'data/e2e.db';

export async function seedE2eDb(options?: {
  configured: boolean;
  gatekeeperUrl: string;
}): Promise<void> {
  mkdirSync('data', { recursive: true });

  const sqlite = new Database(E2E_DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: './drizzle/sqlite' });
  // Keep the live preview server's SQLite connection on the same file.
  db.transaction((tx) => {
    for (const table of [
      schema.verdicts,
      schema.auditLog,
      schema.allowlist,
      schema.curatedDomains,
      schema.curatedLists,
      schema.domains,
      schema.sourceRateState,
      schema.blocklistFetchLog,
      schema.ingestState,
      schema.sessions,
      schema.localAdmin,
      schema.configSecrets,
      schema.appConfig
    ])
      tx.delete(table).run();
  });
  if (options?.configured) {
    const key = Buffer.alloc(32, 7);
    await importEnvironmentOnce(db, schema, key, {
      VB_PIHOLE_BASE_URL: options.gatekeeperUrl,
      VB_PIHOLE_APP_PASSWORD: 'pihole-app-password',
      VB_CURATED_LIST_URLS: `${options.gatekeeperUrl}/list`
    });
    const password = hashPassword('correct horse battery staple');
    await saveSetupSection(db, schema, key, {
      patch: { onboardingStep: 5, onboardingComplete: true, activated: false },
      admin: { salt: password.salt, passwordHash: password.hash }
    });
  }

  const t = 1_725_000_000_000;
  const [pending] = await db
    .insert(schema.domains)
    .values({
      domain: 'tracker.ads.example',
      firstSeen: t - 3600_000,
      lastSeen: t,
      hitCount: 42,
      state: 'pending_review',
      score: -0.72
    })
    .returning();
  await db.insert(schema.domains).values([
    {
      domain: 'obs-a.example',
      firstSeen: t - 1000,
      lastSeen: t,
      hitCount: 5,
      state: 'observed'
    },
    {
      domain: 'obs-b.cdn.example',
      firstSeen: t - 2000,
      lastSeen: t,
      hitCount: 1,
      state: 'assessing'
    },
    {
      domain: 'blocked.malware.example',
      firstSeen: t - 5000,
      lastSeen: t,
      hitCount: 9,
      state: 'approved',
      decidedAt: t - 100
    },
    {
      domain: 'clean.good.example',
      firstSeen: t - 6000,
      lastSeen: t,
      hitCount: 2,
      state: 'auto_cleared'
    }
  ]);
  await db.insert(schema.verdicts).values([
    {
      domainId: pending.id,
      source: 'metadefender',
      verdict: 'block',
      confidence: 0.9,
      category: 'phishing',
      detail: 'listed',
      raw: { hits: 3 },
      assessedAt: t - 1800_000,
      costUsd: null
    },
    {
      domainId: pending.id,
      source: 'ai',
      verdict: 'block',
      confidence: 0.6,
      category: null,
      detail: 'tracker-like name and young domain',
      raw: { model: 'local' },
      assessedAt: t - 1700_000,
      costUsd: 0.0012
    }
  ]);
  await db.insert(schema.auditLog).values([
    {
      at: t - 1800_000,
      actor: 'system',
      domainId: pending.id,
      event: 'domain.transition',
      data: { to: 'pending_review' }
    },
    {
      at: t - 90_000,
      actor: 'user',
      domainId: null,
      event: 'decision.approve',
      data: { note: 'seed' }
    }
  ]);
  await db.insert(schema.blocklistFetchLog).values({
    at: t - 600_000,
    ip: '10.0.0.2',
    userAgent: 'AdGuardHome',
    status: 200
  });
  await db.insert(schema.curatedLists).values({
    name: 'oisd',
    url: 'https://oisd.nl',
    lastFetched: t - 3600_000,
    entryCount: 180000,
    lastError: null
  });
  await db.insert(schema.sourceRateState).values({
    source: 'metadefender',
    tokens: 20,
    lastRefill: t,
    dayCount: 12,
    dayStart: t,
    monthCount: 12,
    monthStart: t,
    lastCallAt: t - 30_000,
    pausedUntil: null
  });

  sqlite.close();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await seedE2eDb();
}

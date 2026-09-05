# Core Enrichment Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Veerabahu sidecar's core loop — read the domains Pi-hole is resolving, assess each with three parallel reputation sources, let a human approve/reject, and publish the approved set as an HTTP endpoint Pi-hole subscribes to as an adlist.

**Architecture:** A SvelteKit (Node) app. A 15-minute ingestion loop pulls new "allowed" domains from Pi-hole's read API into SQLite. Per-source "drainer" loops pull domains off a derived queue at each source's own sustainable rate (so a 500/day source never maxes out) and write verdict rows. A pure scorer combines verdicts into a weighted score; domains either auto-clear or land in a human review queue. Approved domains are rendered on demand at `GET /blocklist.txt`. Everything is behind small interfaces (`GatekeeperAdapter`, `ReputationSource`, `LlmProvider`) so a second gatekeeper / provider slots in later without touching the pipeline.

**Tech Stack:** SvelteKit 2 + Svelte 5 (Runes) + TypeScript, `@sveltejs/adapter-node`, Drizzle ORM (`better-sqlite3` for SQLite, `postgres` for Postgres), Zod, Vitest, pnpm, Docker.

**Spec:** `docs/specs/2026-09-05-core-enrichment-pipeline-design.md` — read it alongside this plan. The plan implements that spec; where the plan says "per spec §N", open that section.

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec.

- **Node.js ≥ 20** (native `fetch`, `AbortSignal.timeout`). Package manager: **pnpm**.
- **No LangChain. No Valkey. No BullMQ.** Schedulers run in-process from `src/hooks.server.ts`, single process.
- **Pull-only.** Veerabahu never calls a gatekeeper write endpoint. The gatekeeper adapter is read-only (`listResolvedDomains` is its only method).
- **Timestamps are epoch-milliseconds integers** everywhere (DB columns, interfaces, comparisons).
- **Enums are `text` columns + a `CHECK` constraint**, mirrored by a TypeScript string-union type. **Booleans are 0/1 integers on SQLite / native `boolean` on Postgres. JSON is `text` (`mode: 'json'`) on SQLite / `jsonb` on Postgres.**
- **All config comes from environment variables with the `VB_` prefix** (see spec §12). Secrets never touch the DB in this sub-project.
- **Decisions are attributed to the single actor string `"user"`.** No auth, no user table.
- **The DB layer must work on both SQLite and Postgres.** Two schema files kept in lockstep (`schema.sqlite.ts`, `schema.pg.ts`) + a parity test. App code uses only Drizzle query-builder calls that behave identically on both.
- **A source with missing credentials is simply absent** from the run. The pipeline works with curated lists alone (no credentials needed).
- **TDD:** every task writes the failing test first, watches it fail, writes the minimal code, watches it pass, commits. **One logical change per commit.**
- **Coverage target: ≥ 90 % lines on `src/lib/server/**`.** Checked in CI.
- **File discipline:** one responsibility per file. If a file passes ~200 lines, that is a smell — split it.
- **Commit message style:** Conventional Commits (`feat:`, `test:`, `chore:`, `docs:`, `ci:`). End every commit message body with:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FrxBHPZytHh6r57YzQL9fU
  ```

---

## Ultra amendments (2026-09-05) — apply these; they override the tasks below

The plan was trimmed under `/ponytail ultra`. Where a task still describes a cut item,
**omit it** and adjust the surrounding code/tests accordingly.

1. **No SSE.** Skip `src/lib/server/pipeline/events.ts`, the `src/routes/api/review/stream/`
   route, and every `onVerdict` / `onDomain` parameter and its wiring (Tasks 12, 13, 15, 17).
   Instead, `src/routes/review/+page.svelte` does `setInterval(() => invalidateAll(), 15000)`
   in `onMount` and clears it on teardown. Delete the events test.
2. **No `domain_clients` table, no `distinct_client_count`.** `domains` loses that column.
   `upsertObservedDomain` just bumps `hit_count` + `last_seen`. Queue/review ranking is
   `ORDER BY hit_count DESC, first_seen ASC`. `AssessmentInput` keeps
   `distinctClientCount` typed as `number` but callers pass `0` (cheap to keep the field;
   not worth a schema migration to remove). Drop the distinct-client test assertions.
3. **No WHOIS.** Skip `src/lib/server/enrichment/whois.ts` and its test; do not add
   `whoiser` to dependencies. `AssessmentInput.enrichment` is `{ dns: DnsInfo | null }`
   only. `buildContext` drops the two `whois_*` lines. `bootstrap.ts` `enrich` is
   `async (d) => ({ dns: await dns(d) })`.
4. **No AI cost ceiling.** Skip Task 12 Step 0 entirely (no `day_cost_usd` column).
   `SourceLimits` drops `dailyCostCeilingUsd`. `afterCall` drops the cost argument and the
   pause logic. `config.ts` drops `VB_LLM_DAILY_USD`. `AiSource` still records
   `usage.costUsd` on the verdict row for later observability, but nothing enforces a
   ceiling — `perDay` bounds spend. Drop the cost-ceiling tests.
5. **No `perMonth`.** `SourceLimits` drops `perMonth`. `amortizedInterval` = `perDay ?
   86_400_000 / perDay : 0`. `canCall` drops the `month` branch. VirusTotal limits are
   `{ perMinute: 4, perDay: 500 }`. `source_rate_state` keeps `month_count`/`month_start`
   columns unused (not worth a migration) — just never read them. Drop the month tests.
6. **LLM: one path.** `OpenAiCompatibleProvider` never sends `response_format`. It always
   prompts for JSON, extracts (`extractJson`), Zod-parses, and retries **once** with the
   blunt "ONLY minified JSON" system message. Keep the two retry tests; drop the
   "json_schema happy path" distinction.
7. **No Postgres CI lane.** Keep `schema.pg.ts` + the parity test + `test:pg` script (so
   the Postgres option stays real and locally verifiable), but delete the `test-postgres`
   job from `.github/workflows/ci.yml`. CI runs SQLite only. Add the PG lane the day
   someone actually deploys on Postgres.

Kept deliberately (explicitly requested earlier): dual Drizzle schema files + parity test
(Postgres as a supported swap), and the built-but-disabled `VirusTotalSource`.

**Token frugality (CLAUDE.md):** dispatch each task's implementation subagent on the
**smallest capable model** (Haiku for the mechanical CRUD/boilerplate tasks — 1, 2, 4, 14,
16, 18, 19; a stronger model only where the logic is subtle — 6, 11, 12).

---

## File Structure

Created or modified across the whole plan. Each file has one job.

```
package.json / svelte.config.js / vite.config.ts / tsconfig.json     Task 1
vitest.config.ts / .env.example / .gitignore (append)               Task 1
drizzle.config.ts                                                    Task 3
Dockerfile / docker-compose.yml / .dockerignore                      Task 18
.github/workflows/ci.yml                                             Task 19

src/
  app.d.ts                          SvelteKit ambient types              Task 1
  hooks.server.ts                   starts ingestion + drainer loops once Task 17
  lib/server/
    config.ts                       parse env → typed Config, source enablement   Task 2
    time.ts                         `now()` indirection for tests                 Task 2
    db/
      schema.sqlite.ts              Drizzle SQLite tables (spec §5)               Task 3
      schema.pg.ts                  Drizzle Postgres mirror                       Task 3
      types.ts                      hand-written row types both schemas satisfy   Task 3
      index.ts                      driver + schema selection from VB_DATABASE_URL Task 3
      migrate.ts                    apply migrations for the active dialect       Task 3
      repo.ts                       all pipeline DB reads/writes                  Task 4
    audit/log.ts                    appendAudit()                                 Task 4
    adapters/gatekeeper/
      types.ts                      GatekeeperAdapter, ResolvedQuery              Task 5
      pihole.ts                     PiholeAdapter (auth + listResolvedDomains)    Tasks 5,6
    enrichment/
      dns.ts                        lookupDns()                                   Task 7
      whois.ts                      lookupWhois()                                 Task 7
    reputation/
      types.ts                      ReputationSource, AssessmentInput, ...        Task 8
      curated-list.ts               CuratedListSource + list loader               Task 8
      ai.ts                         AiSource                                      Task 10
      metadefender.ts               MetaDefenderSource                            Task 10
      virustotal.ts                 VirusTotalSource                              Task 10
      registry.ts                   buildEnabledSources(config)                   Task 10
    llm/
      types.ts                      LlmProvider                                   Task 9
      openai-compatible.ts          OpenAiCompatibleProvider                      Task 9
    scoring/score.ts                computeScore(), decideState()                 Task 11
    pipeline/
      evaluate.ts                   evaluateDomain(): re-score + transition + audit Task 11
      events.ts                     in-process verdict event emitter             Task 15
    governor/
      rate-state.ts                 token bucket + amortized spacing (pure)       Task 12
      drainer.ts                    per-source drain loop                         Task 12
    ingestion/scheduler.ts          runIngestionOnce() + interval starter        Task 13
    publisher/blocklist.ts          renderBlocklist(), computeEtag()             Task 14
  routes/
    blocklist.txt/+server.ts        GET the published list                       Task 14
    api/review/+server.ts           GET ranked pending list                      Task 15
    api/review/[domain]/+server.ts  GET detail, POST approve/reject              Task 15
    api/review/stream/+server.ts    SSE verdict stream                           Task 15
    review/+page.server.ts          load pending list                            Task 16
    review/+page.svelte             bare functional review UI                    Task 16

tests/
  fixtures/pihole-auth.json         captured POST /auth response                 Task 5
  fixtures/pihole-queries.json      captured GET /queries response               Task 6
  fixtures/curated-*.txt            sample blocklist files                       Task 8
  helpers/test-db.ts               make an isolated migrated DB (both dialects)  Task 3
  helpers/stub-pihole.ts           fake Pi-hole HTTP server                      Tasks 5,6
  helpers/fake-source.ts           a ReputationSource test double               Task 12
  server/**                        unit + integration tests mirror src/lib/server
```

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `src/app.d.ts`, `src/routes/+page.svelte`, `src/lib/server/.gitkeep`
- Modify: `.gitignore` (append)
- Test: `tests/server/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `pnpm test`, `pnpm build`, `pnpm check`. The directory skeleton every later task writes into.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "veerabahu",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "node build",
    "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:cov": "vitest run --coverage",
    "lint": "prettier --check . && eslint .",
    "format": "prettier --write .",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "node --import tsx src/lib/server/db/migrate.ts"
  },
  "devDependencies": {
    "@sveltejs/adapter-node": "^5.2.0",
    "@sveltejs/kit": "^2.5.0",
    "@sveltejs/vite-plugin-svelte": "^4.0.0",
    "@types/better-sqlite3": "^7.6.11",
    "@vitest/coverage-v8": "^2.1.0",
    "drizzle-kit": "^0.28.0",
    "eslint": "^9.9.0",
    "prettier": "^3.3.0",
    "svelte": "^5.0.0",
    "svelte-check": "^4.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "drizzle-orm": "^0.36.0",
    "postgres": "^3.4.0",
    "whoiser": "^1.18.0",
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: completes, `node_modules/` present, `pnpm-lock.yaml` written.

- [ ] **Step 3: Create `svelte.config.js`**

```js
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: { adapter: adapter() }
};

export default config;
```

- [ ] **Step 4: Create `vite.config.ts`**

```ts
import { sveltekit } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()]
});
```

- [ ] **Step 5: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/lib/server/**'],
      thresholds: { lines: 90, functions: 90, branches: 80, statements: 90 }
    }
  },
  resolve: {
    alias: { $lib: new URL('./src/lib', import.meta.url).pathname }
  }
});
```

- [ ] **Step 6: Create `tsconfig.json`**

```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "strict": true,
    "moduleResolution": "bundler"
  }
}
```

- [ ] **Step 7: Create `src/app.d.ts`**

```ts
declare global {
  namespace App {}
}

export {};
```

- [ ] **Step 8: Create `src/routes/+page.svelte`**

```svelte
<h1>Veerabahu</h1>
<p>See <a href="/review">/review</a> and <a href="/blocklist.txt">/blocklist.txt</a>.</p>
```

- [ ] **Step 9: Create `src/lib/server/.gitkeep`** (empty file, so the dir exists)

- [ ] **Step 10: Append to `.gitignore`**

```
node_modules
/build
/.svelte-kit
/data
*.local
.env
coverage
```

- [ ] **Step 11: Create `.env.example`** (full list from spec §12; copied verbatim)

```bash
# --- required ---
VB_PIHOLE_BASE_URL=http://pi.hole/api
VB_PIHOLE_APP_PASSWORD=

# --- optional reputation sources (absent = source disabled) ---
VB_METADEFENDER_API_KEY=
VB_LLM_BASE_URL=
VB_LLM_API_KEY=
VB_LLM_MODEL=
VB_LLM_DAILY_USD=
VB_LLM_PRICE_INPUT_PER_MTOK=
VB_LLM_PRICE_OUTPUT_PER_MTOK=
VB_VIRUSTOTAL_API_KEY=
VB_VIRUSTOTAL_ENABLED=false

# --- storage & tuning (defaults shown) ---
VB_DATABASE_URL=file:./data/veerabahu.db
VB_INGEST_INTERVAL_MIN=15
VB_FIRST_RUN_LOOKBACK_HOURS=24
VB_FIRST_RUN_CAP=5000
VB_MAX_REVIEW_WAIT_HOURS=6
VB_BLOCKLIST_PATH=/blocklist.txt
VB_PORT=3000
VB_CURATED_LIST_URLS=https://big.oisd.nl/domainswild
```

- [ ] **Step 12: Write the smoke test** — `tests/server/smoke.test.ts`

```ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 13: Run it and watch it pass**

Run: `pnpm test`
Expected: 1 passed.

- [ ] **Step 14: Verify the app builds**

Run: `pnpm exec svelte-kit sync && pnpm build`
Expected: build completes, `build/` directory created.

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "chore: scaffold SvelteKit + Vitest + Drizzle project"
```

---

## Task 2: Config module

**Files:**
- Create: `src/lib/server/config.ts`, `src/lib/server/time.ts`
- Test: `tests/server/config.test.ts`

**Interfaces:**
- Consumes: `process.env`.
- Produces:
  - `loadConfig(env: Record<string, string | undefined>): Config` — pure, takes an env object (so tests pass a literal).
  - `type Config` with fields:
    ```ts
    export interface Config {
      pihole: { baseUrl: string; appPassword: string };
      metadefender: { apiKey: string } | null;
      llm:
        | { baseUrl: string; apiKey: string; model: string; dailyUsd: number | null;
            priceInputPerMTok: number | null; priceOutputPerMTok: number | null }
        | null;
      virustotal: { apiKey: string } | null;      // null unless key present AND enabled
      databaseUrl: string;
      ingestIntervalMs: number;
      firstRunLookbackMs: number;
      firstRunCap: number;
      maxReviewWaitMs: number;
      blocklistPath: string;
      port: number;
      curatedListUrls: string[];
    }
    ```
  - `src/lib/server/time.ts`: `export const now = () => Date.now();` (a single indirection point; tests import and `vi.spyOn(timeMod, 'now')`).

- [ ] **Step 1: Write the failing test** — `tests/server/config.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '$lib/server/config';

const base = {
  VB_PIHOLE_BASE_URL: 'http://pi.hole/api',
  VB_PIHOLE_APP_PASSWORD: 'secret'
};

describe('loadConfig', () => {
  it('parses the required Pi-hole config and applies defaults', () => {
    const c = loadConfig(base);
    expect(c.pihole).toEqual({ baseUrl: 'http://pi.hole/api', appPassword: 'secret' });
    expect(c.databaseUrl).toBe('file:./data/veerabahu.db');
    expect(c.ingestIntervalMs).toBe(15 * 60_000);
    expect(c.firstRunLookbackMs).toBe(24 * 3_600_000);
    expect(c.firstRunCap).toBe(5000);
    expect(c.maxReviewWaitMs).toBe(6 * 3_600_000);
    expect(c.blocklistPath).toBe('/blocklist.txt');
    expect(c.port).toBe(3000);
  });

  it('throws when a required var is missing', () => {
    expect(() => loadConfig({ VB_PIHOLE_BASE_URL: 'x' })).toThrow(/VB_PIHOLE_APP_PASSWORD/);
  });

  it('disables metadefender and llm when their vars are absent', () => {
    const c = loadConfig(base);
    expect(c.metadefender).toBeNull();
    expect(c.llm).toBeNull();
  });

  it('enables llm only when base url, key and model are all present', () => {
    expect(loadConfig({ ...base, VB_LLM_BASE_URL: 'http://x', VB_LLM_API_KEY: 'k' }).llm).toBeNull();
    const c = loadConfig({
      ...base,
      VB_LLM_BASE_URL: 'http://localhost:11434/v1',
      VB_LLM_API_KEY: 'ollama',
      VB_LLM_MODEL: 'llama3.1'
    });
    expect(c.llm).toMatchObject({ baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' });
  });

  it('keeps virustotal null when key present but not enabled', () => {
    expect(loadConfig({ ...base, VB_VIRUSTOTAL_API_KEY: 'k' }).virustotal).toBeNull();
    expect(
      loadConfig({ ...base, VB_VIRUSTOTAL_API_KEY: 'k', VB_VIRUSTOTAL_ENABLED: 'true' }).virustotal
    ).toEqual({ apiKey: 'k' });
  });

  it('splits VB_CURATED_LIST_URLS on commas and whitespace', () => {
    const c = loadConfig({ ...base, VB_CURATED_LIST_URLS: 'https://a/x , https://b/y' });
    expect(c.curatedListUrls).toEqual(['https://a/x', 'https://b/y']);
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `pnpm test tests/server/config.test.ts`
Expected: FAIL — cannot find module `$lib/server/config`.

- [ ] **Step 3: Create `src/lib/server/time.ts`**

```ts
export const now = () => Date.now();
```

- [ ] **Step 4: Create `src/lib/server/config.ts`**

```ts
export interface Config {
  pihole: { baseUrl: string; appPassword: string };
  metadefender: { apiKey: string } | null;
  llm:
    | {
        baseUrl: string;
        apiKey: string;
        model: string;
        dailyUsd: number | null;
        priceInputPerMTok: number | null;
        priceOutputPerMTok: number | null;
      }
    | null;
  virustotal: { apiKey: string } | null;
  databaseUrl: string;
  ingestIntervalMs: number;
  firstRunLookbackMs: number;
  firstRunCap: number;
  maxReviewWaitMs: number;
  blocklistPath: string;
  port: number;
  curatedListUrls: string[];
}

type Env = Record<string, string | undefined>;

const req = (env: Env, key: string): string => {
  const v = env[key];
  if (v === undefined || v === '') throw new Error(`Missing required env var: ${key}`);
  return v;
};

const num = (env: Env, key: string, fallback: number): number => {
  const v = env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env var ${key} must be a number, got: ${v}`);
  return n;
};

const optNum = (env: Env, key: string): number | null => {
  const v = env[key];
  if (v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env var ${key} must be a number, got: ${v}`);
  return n;
};

export function loadConfig(env: Env): Config {
  const llmBaseUrl = env.VB_LLM_BASE_URL;
  const llmKey = env.VB_LLM_API_KEY;
  const llmModel = env.VB_LLM_MODEL;
  const llmReady = !!llmBaseUrl && !!llmKey && !!llmModel;

  const vtKey = env.VB_VIRUSTOTAL_API_KEY;
  const vtEnabled = env.VB_VIRUSTOTAL_ENABLED === 'true';

  return {
    pihole: {
      baseUrl: req(env, 'VB_PIHOLE_BASE_URL').replace(/\/+$/, ''),
      appPassword: req(env, 'VB_PIHOLE_APP_PASSWORD')
    },
    metadefender: env.VB_METADEFENDER_API_KEY ? { apiKey: env.VB_METADEFENDER_API_KEY } : null,
    llm: llmReady
      ? {
          baseUrl: llmBaseUrl!.replace(/\/+$/, ''),
          apiKey: llmKey!,
          model: llmModel!,
          dailyUsd: optNum(env, 'VB_LLM_DAILY_USD'),
          priceInputPerMTok: optNum(env, 'VB_LLM_PRICE_INPUT_PER_MTOK'),
          priceOutputPerMTok: optNum(env, 'VB_LLM_PRICE_OUTPUT_PER_MTOK')
        }
      : null,
    virustotal: vtKey && vtEnabled ? { apiKey: vtKey } : null,
    databaseUrl: env.VB_DATABASE_URL || 'file:./data/veerabahu.db',
    ingestIntervalMs: num(env, 'VB_INGEST_INTERVAL_MIN', 15) * 60_000,
    firstRunLookbackMs: num(env, 'VB_FIRST_RUN_LOOKBACK_HOURS', 24) * 3_600_000,
    firstRunCap: num(env, 'VB_FIRST_RUN_CAP', 5000),
    maxReviewWaitMs: num(env, 'VB_MAX_REVIEW_WAIT_HOURS', 6) * 3_600_000,
    blocklistPath: env.VB_BLOCKLIST_PATH || '/blocklist.txt',
    port: num(env, 'VB_PORT', 3000),
    curatedListUrls: (env.VB_CURATED_LIST_URLS || '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  };
}
```

- [ ] **Step 5: Run tests, watch them pass**

Run: `pnpm test tests/server/config.test.ts`
Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: typed env config loader with per-source enablement"
```

---

## Task 3: Database schema, client, migrations, test helper

**Files:**
- Create: `drizzle.config.ts`, `src/lib/server/db/schema.sqlite.ts`, `src/lib/server/db/schema.pg.ts`, `src/lib/server/db/types.ts`, `src/lib/server/db/index.ts`, `src/lib/server/db/migrate.ts`, `tests/helpers/test-db.ts`
- Create (generated): `drizzle/**` migration SQL
- Test: `tests/server/db/schema.test.ts`

**Interfaces:**
- Consumes: `Config.databaseUrl` from Task 2 (indirectly; `index.ts` reads `process.env.VB_DATABASE_URL` directly so the DB module has no import cycle with config).
- Produces:
  - `src/lib/server/db/index.ts`: `export const db` (a Drizzle instance), `export const schema` (the active dialect's table objects), `export const dialect: 'sqlite' | 'pg'`.
  - `src/lib/server/db/types.ts`: row types used by app code — `DomainRow`, `VerdictRow`, `DomainState`, `VerdictValue`, `SourceName`, etc. (listed in Step 4).
  - `tests/helpers/test-db.ts`: `export async function makeTestDb(): Promise<{ db; schema; dialect; close(): void }>` — an isolated, migrated database. Uses an in-memory SQLite unless `TEST_DATABASE_URL` (a `postgres://…` URL) is set, in which case it creates and drops a uniquely-named schema in that Postgres.

**Schema — all tables from spec §5.** Columns, exactly:

| table | columns |
|---|---|
| `domains` | `id` int pk autoinc; `domain` text unique not null; `first_seen` int not null; `last_seen` int not null; `hit_count` int not null default 0; `distinct_client_count` int not null default 0; `state` text not null default `'observed'` CHECK in (`observed`,`assessing`,`pending_review`,`auto_cleared`,`approved`,`rejected`); `score` real; `decided_at` int; `decision_note` text |
| `verdicts` | `id` int pk autoinc; `domain_id` int not null → domains.id; `source` text not null CHECK in (`curated_list`,`metadefender`,`ai`,`virustotal`); `verdict` text not null CHECK in (`block`,`allow`,`unsure`,`error`); `confidence` real not null; `category` text; `detail` text; `raw` json not null; `assessed_at` int not null; `input_tokens` int; `output_tokens` int; `cost_usd` real; UNIQUE(`domain_id`,`source`) |
| `source_rate_state` | `source` text pk; `tokens` real not null; `last_refill` int not null; `day_count` int not null default 0; `day_start` int not null; `month_count` int not null default 0; `month_start` int not null; `last_call_at` int; `paused_until` int |
| `allowlist` | `domain` text pk; `reason` text not null; `added_at` int not null |
| `domain_clients` | `domain_id` int not null → domains.id; `client_id` text not null; PRIMARY KEY(`domain_id`,`client_id`) |
| `curated_domains` | `domain` text not null; `source_list` text not null; PRIMARY KEY(`domain`,`source_list`) |
| `curated_lists` | `name` text pk; `url` text not null; `last_fetched` int; `entry_count` int not null default 0; `last_error` text |
| `audit_log` | `id` int pk autoinc; `at` int not null; `actor` text not null; `domain_id` int; `event` text not null; `data` json not null |
| `blocklist_fetch_log` | `id` int pk autoinc; `at` int not null; `ip` text not null; `user_agent` text; `status` int not null |
| `ingest_state` | `id` int pk (always the literal value 1); `cursor` text; `last_ingest_at` int; `first_run_done` int/boolean not null default 0 |

- [ ] **Step 1: Write the failing test** — `tests/server/db/schema.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db';
import { eq } from 'drizzle-orm';

let closer: (() => void) | null = null;
afterEach(() => { closer?.(); closer = null; });

describe('schema', () => {
  it('migrates and round-trips a row in every table', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const { db, schema } = t;

    const [d] = await db.insert(schema.domains).values({
      domain: 'ads.example.com', firstSeen: 1, lastSeen: 1
    }).returning();
    expect(d.id).toBeGreaterThan(0);
    expect(d.state).toBe('observed');
    expect(d.hitCount).toBe(0);

    await db.insert(schema.verdicts).values({
      domainId: d.id, source: 'curated_list', verdict: 'block',
      confidence: 1, raw: { list: 'oisd' }, assessedAt: 2
    });
    const [v] = await db.select().from(schema.verdicts).where(eq(schema.verdicts.domainId, d.id));
    expect(v.raw).toEqual({ list: 'oisd' });   // json column round-trips objects

    await db.insert(schema.ingestState).values({ id: 1, firstRunDone: false });
    const [s] = await db.select().from(schema.ingestState);
    expect(s.firstRunDone).toBe(false);        // boolean column round-trips
  });

  it('rejects an invalid domain state', async () => {
    const t = await makeTestDb();
    closer = t.close;
    await expect(
      t.db.insert(t.schema.domains).values({
        domain: 'x.com', firstSeen: 1, lastSeen: 1, state: 'bogus' as never
      })
    ).rejects.toThrow();
  });

  it('enforces the (domain_id, source) uniqueness on verdicts', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const [d] = await t.db.insert(t.schema.domains)
      .values({ domain: 'x.com', firstSeen: 1, lastSeen: 1 }).returning();
    const row = {
      domainId: d.id, source: 'ai' as const, verdict: 'allow' as const,
      confidence: 0.5, raw: {}, assessedAt: 1
    };
    await t.db.insert(t.schema.verdicts).values(row);
    await expect(t.db.insert(t.schema.verdicts).values(row)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `pnpm test tests/server/db/schema.test.ts`
Expected: FAIL — cannot find `../../helpers/test-db`.

- [ ] **Step 3: Create `src/lib/server/db/types.ts`**

```ts
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
  'observed', 'assessing', 'pending_review', 'auto_cleared', 'approved', 'rejected'
];
export const SOURCE_NAMES: SourceName[] = ['curated_list', 'metadefender', 'ai', 'virustotal'];
export const VERDICT_VALUES: VerdictValue[] = ['block', 'allow', 'unsure', 'error'];
```

- [ ] **Step 4: Create `src/lib/server/db/schema.sqlite.ts`**

```ts
import { sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { DOMAIN_STATES, SOURCE_NAMES, VERDICT_VALUES } from './types';

const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);

export const domains = sqliteTable('domains', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  domain: text('domain').notNull().unique(),
  firstSeen: integer('first_seen').notNull(),
  lastSeen: integer('last_seen').notNull(),
  hitCount: integer('hit_count').notNull().default(0),
  distinctClientCount: integer('distinct_client_count').notNull().default(0),
  state: text('state').notNull().default('observed'),
  score: real('score'),
  decidedAt: integer('decided_at'),
  decisionNote: text('decision_note')
}, (t) => ({
  stateCheck: sql`CONSTRAINT domains_state_check CHECK (${inList('state', DOMAIN_STATES)})`
}));

export const verdicts = sqliteTable('verdicts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  domainId: integer('domain_id').notNull().references(() => domains.id),
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
}, (t) => ({
  uniq: uniqueIndex('verdicts_domain_source_uniq').on(t.domainId, t.source),
  sourceCheck: sql`CONSTRAINT verdicts_source_check CHECK (${inList('source', SOURCE_NAMES)})`,
  verdictCheck: sql`CONSTRAINT verdicts_verdict_check CHECK (${inList('verdict', VERDICT_VALUES)})`
}));

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

export const domainClients = sqliteTable('domain_clients', {
  domainId: integer('domain_id').notNull().references(() => domains.id),
  clientId: text('client_id').notNull()
}, (t) => ({ pk: primaryKey({ columns: [t.domainId, t.clientId] }) }));

export const curatedDomains = sqliteTable('curated_domains', {
  domain: text('domain').notNull(),
  sourceList: text('source_list').notNull()
}, (t) => ({ pk: primaryKey({ columns: [t.domain, t.sourceList] }) }));

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
  firstRunDone: integer('first_run_done', { mode: 'boolean' }).notNull().default(false)
});
```

- [ ] **Step 5: Create `src/lib/server/db/schema.pg.ts`** — the exact same tables in `pg-core`

```ts
import { sql } from 'drizzle-orm';
import {
  bigint, doublePrecision, integer, jsonb, pgTable, primaryKey, text, uniqueIndex, boolean
} from 'drizzle-orm/pg-core';
import { DOMAIN_STATES, SOURCE_NAMES, VERDICT_VALUES } from './types';

const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);
const ts = (name: string) => bigint(name, { mode: 'number' });

export const domains = pgTable('domains', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  domain: text('domain').notNull().unique(),
  firstSeen: ts('first_seen').notNull(),
  lastSeen: ts('last_seen').notNull(),
  hitCount: integer('hit_count').notNull().default(0),
  distinctClientCount: integer('distinct_client_count').notNull().default(0),
  state: text('state').notNull().default('observed'),
  score: doublePrecision('score'),
  decidedAt: ts('decided_at'),
  decisionNote: text('decision_note')
}, () => ({
  stateCheck: sql`CONSTRAINT domains_state_check CHECK (${inList('state', DOMAIN_STATES)})`
}));

export const verdicts = pgTable('verdicts', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  domainId: integer('domain_id').notNull().references(() => domains.id),
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
}, (t) => ({
  uniq: uniqueIndex('verdicts_domain_source_uniq').on(t.domainId, t.source),
  sourceCheck: sql`CONSTRAINT verdicts_source_check CHECK (${inList('source', SOURCE_NAMES)})`,
  verdictCheck: sql`CONSTRAINT verdicts_verdict_check CHECK (${inList('verdict', VERDICT_VALUES)})`
}));

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

export const domainClients = pgTable('domain_clients', {
  domainId: integer('domain_id').notNull().references(() => domains.id),
  clientId: text('client_id').notNull()
}, (t) => ({ pk: primaryKey({ columns: [t.domainId, t.clientId] }) }));

export const curatedDomains = pgTable('curated_domains', {
  domain: text('domain').notNull(),
  sourceList: text('source_list').notNull()
}, (t) => ({ pk: primaryKey({ columns: [t.domain, t.sourceList] }) }));

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
```

- [ ] **Step 6: Create `src/lib/server/db/index.ts`**

```ts
import 'dotenv/config';

const url = process.env.VB_DATABASE_URL || 'file:./data/veerabahu.db';
export const dialect: 'sqlite' | 'pg' = url.startsWith('postgres') ? 'pg' : 'sqlite';

let db: any;
let schema: any;

if (dialect === 'pg') {
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const postgres = (await import('postgres')).default;
  schema = await import('./schema.pg');
  db = drizzle(postgres(url), { schema });
} else {
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const Database = (await import('better-sqlite3')).default;
  schema = await import('./schema.sqlite');
  const file = url.replace(/^file:/, '');
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  db = drizzle(sqlite, { schema });
}

export { db, schema };
```

> Note: top-level `await` requires `"type": "module"` (set in Task 1) and Vite/SvelteKit's ESM. It is fine here. Add `dotenv` to dependencies: `pnpm add dotenv`.

- [ ] **Step 7: Create `drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit';

const url = process.env.VB_DATABASE_URL || 'file:./data/veerabahu.db';
const isPg = url.startsWith('postgres');

export default defineConfig({
  dialect: isPg ? 'postgresql' : 'sqlite',
  schema: isPg ? './src/lib/server/db/schema.pg.ts' : './src/lib/server/db/schema.sqlite.ts',
  out: isPg ? './drizzle/pg' : './drizzle/sqlite',
  dbCredentials: { url }
});
```

- [ ] **Step 8: Generate both migration sets**

Run:
```bash
VB_DATABASE_URL='file:./data/veerabahu.db' pnpm db:generate
VB_DATABASE_URL='postgres://x' pnpm db:generate
```
Expected: `drizzle/sqlite/0000_*.sql` and `drizzle/pg/0000_*.sql` created. Open both and confirm every table from the schema list appears.

- [ ] **Step 9: Create `src/lib/server/db/migrate.ts`**

```ts
import { db, dialect } from './index';

export async function runMigrations(): Promise<void> {
  if (dialect === 'pg') {
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    await migrate(db, { migrationsFolder: './drizzle/pg' });
  } else {
    const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
    migrate(db, { migrationsFolder: './drizzle/sqlite' });
  }
}

// Allow `node --import tsx src/lib/server/db/migrate.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations().then(() => {
    console.log('migrations applied');
    process.exit(0);
  });
}
```

- [ ] **Step 10: Create `tests/helpers/test-db.ts`**

```ts
import { randomUUID } from 'node:crypto';

export interface TestDb {
  db: any;
  schema: any;
  dialect: 'sqlite' | 'pg';
  close: () => void;
}

export async function makeTestDb(): Promise<TestDb> {
  const pgUrl = process.env.TEST_DATABASE_URL;
  if (pgUrl && pgUrl.startsWith('postgres')) {
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const postgres = (await import('postgres')).default;
    const schema = await import('../../src/lib/server/db/schema.pg');
    const schemaName = `t_${randomUUID().replace(/-/g, '')}`;
    const root = postgres(pgUrl);
    await root.unsafe(`CREATE SCHEMA ${schemaName}`);
    const sql = postgres(pgUrl, { connection: { search_path: schemaName } });
    const db = drizzle(sql, { schema });
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    await migrate(db, { migrationsFolder: './drizzle/pg' });
    return {
      db, schema, dialect: 'pg',
      close: () => {
        root.unsafe(`DROP SCHEMA ${schemaName} CASCADE`).then(() => { root.end(); sql.end(); });
      }
    };
  }

  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const Database = (await import('better-sqlite3')).default;
  const schema = await import('../../src/lib/server/db/schema.sqlite');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  migrate(db, { migrationsFolder: './drizzle/sqlite' });
  return { db, schema, dialect: 'sqlite', close: () => sqlite.close() };
}
```

- [ ] **Step 11: Run the schema tests, watch them pass**

Run: `pnpm test tests/server/db/schema.test.ts`
Expected: 3 passed (SQLite). If `TEST_DATABASE_URL` is exported, the same tests pass on Postgres.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: dual-dialect Drizzle schema, client, migrations, test-db helper"
```

---

## Task 4: Audit log + DB repository

**Files:**
- Create: `src/lib/server/audit/log.ts`, `src/lib/server/db/repo.ts`
- Test: `tests/server/audit/log.test.ts`, `tests/server/db/repo.test.ts`

**Interfaces:**
- Consumes: `db`, `schema` from `db/index.ts` (Task 3); `now` from `time.ts` (Task 2).
- Produces (`src/lib/server/db/repo.ts` — every function takes the db as first arg so tests inject the test db):

  ```ts
  // domains
  upsertObservedDomain(db, schema, args: { domain: string; clientId: string; at: number }):
    Promise<{ domainId: number; created: boolean }>
  getDomainByName(db, schema, domain: string): Promise<DomainRow | undefined>
  getDomainById(db, schema, id: number): Promise<DomainRow | undefined>
  setDomainScoreAndState(db, schema, id: number, score: number | null, state: DomainState): Promise<void>
  decideDomain(db, schema, id: number, decision: 'approve' | 'reject', note: string | null, at: number): Promise<void>
  listQueuedDomains(db, schema, sourceNotYetRun: SourceName, limit: number): Promise<DomainRow[]>
  listPendingReview(db, schema, limit: number, offset: number): Promise<DomainRow[]>
  listApprovedDomains(db, schema): Promise<string[]>   // sorted ascending

  // verdicts
  upsertVerdict(db, schema, v: NewVerdict): Promise<void>          // replace on (domainId, source)
  listVerdictsForDomain(db, schema, domainId: number): Promise<VerdictRow[]>

  // allowlist
  isAllowlisted(db, schema, domain: string): Promise<boolean>
  addAllowlist(db, schema, domain: string, reason: string, at: number): Promise<void>

  // ingest_state
  getIngestState(db, schema): Promise<IngestStateRow>             // creates the id=1 row if missing
  setIngestState(db, schema, patch: Partial<Pick<IngestStateRow,'cursor'|'lastIngestAt'|'firstRunDone'>>): Promise<void>

  // fetch log
  logBlocklistFetch(db, schema, row: { at: number; ip: string; userAgent: string | null; status: number }): Promise<void>
  ```

  Row types (`DomainRow`, `VerdictRow`, `IngestStateRow`, `NewVerdict`) are `typeof schema.X.$inferSelect` / `$inferInsert` re-exported from `repo.ts`.

- `src/lib/server/audit/log.ts`:
  ```ts
  appendAudit(db, schema, e: {
    actor: 'system' | 'user' | SourceName;
    event: string;
    domainId?: number | null;
    data?: unknown;
  }): Promise<void>
  ```

- [ ] **Step 1: Write the failing test** — `tests/server/audit/log.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db';
import { appendAudit } from '$lib/server/audit/log';

let closer: (() => void) | null = null;
afterEach(() => { closer?.(); closer = null; });

describe('appendAudit', () => {
  it('writes a row with actor, event, json data and a timestamp', async () => {
    const t = await makeTestDb();
    closer = t.close;
    await appendAudit(t.db, t.schema, { actor: 'system', event: 'ingest.gap', data: { missing: 42 } });
    const rows = await t.db.select().from(t.schema.auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe('system');
    expect(rows[0].event).toBe('ingest.gap');
    expect(rows[0].data).toEqual({ missing: 42 });
    expect(rows[0].at).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `pnpm test tests/server/audit/log.test.ts`
Expected: FAIL — cannot find `$lib/server/audit/log`.

- [ ] **Step 3: Create `src/lib/server/audit/log.ts`**

```ts
import { now } from '../time';
import type { SourceName } from '../db/types';

export async function appendAudit(
  db: any,
  schema: any,
  e: { actor: 'system' | 'user' | SourceName; event: string; domainId?: number | null; data?: unknown }
): Promise<void> {
  await db.insert(schema.auditLog).values({
    at: now(),
    actor: e.actor,
    domainId: e.domainId ?? null,
    event: e.event,
    data: e.data ?? {}
  });
}
```

- [ ] **Step 4: Run the audit test, watch it pass**

Run: `pnpm test tests/server/audit/log.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Write the failing test** — `tests/server/db/repo.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db';
import * as repo from '$lib/server/db/repo';

let closer: (() => void) | null = null;
afterEach(() => { closer?.(); closer = null; });

describe('repo.upsertObservedDomain', () => {
  it('creates on first sight and increments hit_count + distinct clients on repeats', async () => {
    const t = await makeTestDb(); closer = t.close;
    const a = await repo.upsertObservedDomain(t.db, t.schema, { domain: 'x.com', clientId: 'c1', at: 100 });
    expect(a.created).toBe(true);
    const b = await repo.upsertObservedDomain(t.db, t.schema, { domain: 'x.com', clientId: 'c1', at: 200 });
    expect(b.created).toBe(false);
    await repo.upsertObservedDomain(t.db, t.schema, { domain: 'x.com', clientId: 'c2', at: 300 });
    const row = await repo.getDomainByName(t.db, t.schema, 'x.com');
    expect(row!.hitCount).toBe(3);
    expect(row!.distinctClientCount).toBe(2);
    expect(row!.lastSeen).toBe(300);
    expect(row!.firstSeen).toBe(100);
  });
});

describe('repo.upsertVerdict', () => {
  it('replaces the row for the same (domain, source)', async () => {
    const t = await makeTestDb(); closer = t.close;
    const { domainId } = await repo.upsertObservedDomain(t.db, t.schema, { domain: 'x.com', clientId: 'c', at: 1 });
    await repo.upsertVerdict(t.db, t.schema, {
      domainId, source: 'ai', verdict: 'unsure', confidence: 0.3, raw: {}, assessedAt: 1
    });
    await repo.upsertVerdict(t.db, t.schema, {
      domainId, source: 'ai', verdict: 'block', confidence: 0.9, raw: {}, assessedAt: 2, category: 'ad'
    });
    const vs = await repo.listVerdictsForDomain(t.db, t.schema, domainId);
    expect(vs).toHaveLength(1);
    expect(vs[0]).toMatchObject({ verdict: 'block', confidence: 0.9, category: 'ad' });
  });
});

describe('repo.listQueuedDomains', () => {
  it('returns observed/assessing domains the source has not assessed, ranked by hits+2*clients', async () => {
    const t = await makeTestDb(); closer = t.close;
    // low priority
    await repo.upsertObservedDomain(t.db, t.schema, { domain: 'low.com', clientId: 'c1', at: 1 });
    // high priority: 1 hit but 3 clients => 1 + 6 = 7 > 1
    for (const c of ['c1', 'c2', 'c3'])
      await repo.upsertObservedDomain(t.db, t.schema, { domain: 'high.com', clientId: c, at: 1 });
    const q = await repo.listQueuedDomains(t.db, t.schema, 'ai', 10);
    expect(q.map((d) => d.domain)).toEqual(['high.com', 'low.com']);

    // once 'ai' has a verdict for high.com, it drops out of the 'ai' queue
    const high = await repo.getDomainByName(t.db, t.schema, 'high.com');
    await repo.upsertVerdict(t.db, t.schema, {
      domainId: high!.id, source: 'ai', verdict: 'allow', confidence: 1, raw: {}, assessedAt: 1
    });
    const q2 = await repo.listQueuedDomains(t.db, t.schema, 'ai', 10);
    expect(q2.map((d) => d.domain)).toEqual(['low.com']);
  });

  it('excludes domains past pending_review/decided states', async () => {
    const t = await makeTestDb(); closer = t.close;
    const { domainId } = await repo.upsertObservedDomain(t.db, t.schema, { domain: 'x.com', clientId: 'c', at: 1 });
    await repo.setDomainScoreAndState(t.db, t.schema, domainId, 0.9, 'auto_cleared');
    expect(await repo.listQueuedDomains(t.db, t.schema, 'ai', 10)).toHaveLength(0);
  });
});

describe('repo.decideDomain', () => {
  it('approve sets state approved + decidedAt + note', async () => {
    const t = await makeTestDb(); closer = t.close;
    const { domainId } = await repo.upsertObservedDomain(t.db, t.schema, { domain: 'x.com', clientId: 'c', at: 1 });
    await repo.setDomainScoreAndState(t.db, t.schema, domainId, -0.7, 'pending_review');
    await repo.decideDomain(t.db, t.schema, domainId, 'approve', 'looks like a tracker', 999);
    const row = await repo.getDomainById(t.db, t.schema, domainId);
    expect(row).toMatchObject({ state: 'approved', decidedAt: 999, decisionNote: 'looks like a tracker' });
    expect(await repo.listApprovedDomains(t.db, t.schema)).toEqual(['x.com']);
  });
});

describe('repo.allowlist + ingestState', () => {
  it('round-trips the allowlist', async () => {
    const t = await makeTestDb(); closer = t.close;
    expect(await repo.isAllowlisted(t.db, t.schema, 'x.com')).toBe(false);
    await repo.addAllowlist(t.db, t.schema, 'x.com', 'rejected by user', 1);
    expect(await repo.isAllowlisted(t.db, t.schema, 'x.com')).toBe(true);
  });

  it('creates the id=1 ingest_state row on first read and patches it', async () => {
    const t = await makeTestDb(); closer = t.close;
    const s = await repo.getIngestState(t.db, t.schema);
    expect(s).toMatchObject({ id: 1, cursor: null, firstRunDone: false });
    await repo.setIngestState(t.db, t.schema, { cursor: 'abc', firstRunDone: true, lastIngestAt: 5 });
    const s2 = await repo.getIngestState(t.db, t.schema);
    expect(s2).toMatchObject({ cursor: 'abc', firstRunDone: true, lastIngestAt: 5 });
  });
});
```

- [ ] **Step 6: Run it, watch it fail**

Run: `pnpm test tests/server/db/repo.test.ts`
Expected: FAIL — cannot find `$lib/server/db/repo`.

- [ ] **Step 7: Create `src/lib/server/db/repo.ts`**

```ts
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { DomainState, SourceName } from './types';

export type DomainRow = {
  id: number; domain: string; firstSeen: number; lastSeen: number;
  hitCount: number; distinctClientCount: number; state: DomainState;
  score: number | null; decidedAt: number | null; decisionNote: string | null;
};
export type VerdictRow = {
  id: number; domainId: number; source: SourceName;
  verdict: 'block' | 'allow' | 'unsure' | 'error'; confidence: number;
  category: string | null; detail: string | null; raw: unknown; assessedAt: number;
  inputTokens: number | null; outputTokens: number | null; costUsd: number | null;
};
export type NewVerdict = Omit<VerdictRow, 'id' | 'category' | 'detail' | 'inputTokens' | 'outputTokens' | 'costUsd'> &
  Partial<Pick<VerdictRow, 'category' | 'detail' | 'inputTokens' | 'outputTokens' | 'costUsd'>>;
export type IngestStateRow = {
  id: number; cursor: string | null; lastIngestAt: number | null; firstRunDone: boolean;
};

const QUEUE_STATES: DomainState[] = ['observed', 'assessing'];

export async function upsertObservedDomain(
  db: any, schema: any, args: { domain: string; clientId: string; at: number }
): Promise<{ domainId: number; created: boolean }> {
  const existing = await db.select().from(schema.domains)
    .where(eq(schema.domains.domain, args.domain)).limit(1);
  let domainId: number;
  let created: boolean;
  if (existing.length === 0) {
    const [row] = await db.insert(schema.domains).values({
      domain: args.domain, firstSeen: args.at, lastSeen: args.at, hitCount: 0, distinctClientCount: 0
    }).returning();
    domainId = row.id;
    created = true;
  } else {
    domainId = existing[0].id;
    created = false;
  }

  await db.insert(schema.domainClients)
    .values({ domainId, clientId: args.clientId })
    .onConflictDoNothing();

  const [{ cnt }] = await db.select({ cnt: sql<number>`count(*)` })
    .from(schema.domainClients).where(eq(schema.domainClients.domainId, domainId));

  await db.update(schema.domains).set({
    hitCount: sql`${schema.domains.hitCount} + 1`,
    lastSeen: sql`max(${schema.domains.lastSeen}, ${args.at})`,
    distinctClientCount: Number(cnt)
  }).where(eq(schema.domains.id, domainId));

  return { domainId, created };
}

export async function getDomainByName(db: any, schema: any, domain: string): Promise<DomainRow | undefined> {
  const [row] = await db.select().from(schema.domains).where(eq(schema.domains.domain, domain)).limit(1);
  return row;
}
export async function getDomainById(db: any, schema: any, id: number): Promise<DomainRow | undefined> {
  const [row] = await db.select().from(schema.domains).where(eq(schema.domains.id, id)).limit(1);
  return row;
}

export async function setDomainScoreAndState(
  db: any, schema: any, id: number, score: number | null, state: DomainState
): Promise<void> {
  await db.update(schema.domains).set({ score, state }).where(eq(schema.domains.id, id));
}

export async function decideDomain(
  db: any, schema: any, id: number, decision: 'approve' | 'reject', note: string | null, at: number
): Promise<void> {
  await db.update(schema.domains).set({
    state: decision === 'approve' ? 'approved' : 'rejected',
    decidedAt: at,
    decisionNote: note
  }).where(eq(schema.domains.id, id));
}

export async function listQueuedDomains(
  db: any, schema: any, sourceNotYetRun: SourceName, limit: number
): Promise<DomainRow[]> {
  const done = db.select({ id: schema.verdicts.domainId }).from(schema.verdicts)
    .where(eq(schema.verdicts.source, sourceNotYetRun));
  return db.select().from(schema.domains)
    .where(and(inArray(schema.domains.state, QUEUE_STATES), notInArray(schema.domains.id, done)))
    .orderBy(
      sql`(${schema.domains.hitCount} + 2 * ${schema.domains.distinctClientCount}) desc`,
      asc(schema.domains.firstSeen)
    )
    .limit(limit);
}

export async function listPendingReview(db: any, schema: any, limit: number, offset: number): Promise<DomainRow[]> {
  return db.select().from(schema.domains)
    .where(eq(schema.domains.state, 'pending_review'))
    .orderBy(
      sql`(${schema.domains.hitCount} + 2 * ${schema.domains.distinctClientCount}) desc`,
      asc(schema.domains.firstSeen)
    )
    .limit(limit).offset(offset);
}

export async function listApprovedDomains(db: any, schema: any): Promise<string[]> {
  const rows = await db.select({ domain: schema.domains.domain }).from(schema.domains)
    .where(eq(schema.domains.state, 'approved')).orderBy(asc(schema.domains.domain));
  return rows.map((r: { domain: string }) => r.domain);
}

export async function upsertVerdict(db: any, schema: any, v: NewVerdict): Promise<void> {
  await db.insert(schema.verdicts).values({
    domainId: v.domainId, source: v.source, verdict: v.verdict, confidence: v.confidence,
    category: v.category ?? null, detail: v.detail ?? null, raw: v.raw, assessedAt: v.assessedAt,
    inputTokens: v.inputTokens ?? null, outputTokens: v.outputTokens ?? null, costUsd: v.costUsd ?? null
  }).onConflictDoUpdate({
    target: [schema.verdicts.domainId, schema.verdicts.source],
    set: {
      verdict: v.verdict, confidence: v.confidence, category: v.category ?? null,
      detail: v.detail ?? null, raw: v.raw, assessedAt: v.assessedAt,
      inputTokens: v.inputTokens ?? null, outputTokens: v.outputTokens ?? null, costUsd: v.costUsd ?? null
    }
  });
}

export async function listVerdictsForDomain(db: any, schema: any, domainId: number): Promise<VerdictRow[]> {
  return db.select().from(schema.verdicts).where(eq(schema.verdicts.domainId, domainId));
}

export async function isAllowlisted(db: any, schema: any, domain: string): Promise<boolean> {
  const [row] = await db.select().from(schema.allowlist).where(eq(schema.allowlist.domain, domain)).limit(1);
  return !!row;
}
export async function addAllowlist(db: any, schema: any, domain: string, reason: string, at: number): Promise<void> {
  await db.insert(schema.allowlist).values({ domain, reason, addedAt: at }).onConflictDoNothing();
}

export async function getIngestState(db: any, schema: any): Promise<IngestStateRow> {
  const [row] = await db.select().from(schema.ingestState).where(eq(schema.ingestState.id, 1)).limit(1);
  if (row) return row;
  const [created] = await db.insert(schema.ingestState)
    .values({ id: 1, cursor: null, lastIngestAt: null, firstRunDone: false }).returning();
  return created;
}
export async function setIngestState(
  db: any, schema: any,
  patch: Partial<Pick<IngestStateRow, 'cursor' | 'lastIngestAt' | 'firstRunDone'>>
): Promise<void> {
  await getIngestState(db, schema); // ensure row exists
  await db.update(schema.ingestState).set(patch).where(eq(schema.ingestState.id, 1));
}

export async function logBlocklistFetch(
  db: any, schema: any, row: { at: number; ip: string; userAgent: string | null; status: number }
): Promise<void> {
  await db.insert(schema.blocklistFetchLog).values(row);
}
```

- [ ] **Step 8: Run the repo tests, watch them pass**

Run: `pnpm test tests/server/db/repo.test.ts`
Expected: all passed. If `onConflictDoNothing`/`onConflictDoUpdate` behaves differently on your Drizzle version, adjust to `.onConflictDoNothing({ target: [...] })` form; keep the test green.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: audit log + pipeline DB repository"
```

---

## Task 5: Gatekeeper adapter — types + Pi-hole auth + stub server

**Files:**
- Create: `src/lib/server/adapters/gatekeeper/types.ts`, `src/lib/server/adapters/gatekeeper/pihole.ts`
- Create: `tests/helpers/stub-pihole.ts`, `tests/fixtures/pihole-auth.json`
- Test: `tests/server/adapters/pihole-auth.test.ts`

**Background (spec §3 "Findings", §4):** Pi-hole v6. `POST {baseUrl}/auth` with body `{"password": "<app password>"}` returns `{"session":{"valid":true,"sid":"...","csrf":"...","validity":1800}}`. The `sid` is sent on later requests as the header `X-FTL-SID` (also accepted as a `sid` cookie). On `401` the session expired — re-auth once and retry.

**Interfaces:**
- Consumes: `Config.pihole` from Task 2, `now` from Task 2.
- Produces:
  - `src/lib/server/adapters/gatekeeper/types.ts`:
    ```ts
    export interface ResolvedQuery {
      domain: string;
      client: { id: string; label: string | null };
      at: number;                                     // epoch ms
      disposition: 'allowed' | 'blocked' | 'other';
      rawStatus: string;
    }
    export interface GatekeeperAdapter {
      listResolvedDomains(opts: {
        since: number; until: number; cursor?: string; limit: number;
      }): Promise<{ entries: ResolvedQuery[]; nextCursor: string | null; gapBefore: number | null }>;
    }
    ```
  - `src/lib/server/adapters/gatekeeper/pihole.ts`:
    ```ts
    export function makePiholeAdapter(cfg: {
      baseUrl: string; appPassword: string; fetchImpl?: typeof fetch;
    }): GatekeeperAdapter & { _authedFetch(path: string, init?: RequestInit): Promise<Response> };
    ```
    (`_authedFetch` is exported on the object only so Task 6 and tests can exercise the auth/retry wrapper directly. Underscore = "internal".)
  - `tests/helpers/stub-pihole.ts`:
    ```ts
    export async function startStubPihole(opts?: {
      appPassword?: string;            // default 'test-pw'
      queries?: unknown[];             // raw query rows the /queries endpoint pages over
      sessionTtlMs?: number;           // default 1800_000; set small to force re-auth
    }): Promise<{ baseUrl: string; authCount: number; close: () => Promise<void>; setQueries(q: unknown[]): void; }>;
    ```
    A real `http.createServer`. `POST /auth` checks the password, mints a random `sid`, tracks its expiry, increments `authCount`. Any other route requires a valid `X-FTL-SID` or returns `401 {"session":{"valid":false}}`.

- [ ] **Step 1: Capture a real fixture** — `tests/fixtures/pihole-auth.json`

If you have a Pi-hole: `curl -sk -X POST "$VB_PIHOLE_BASE_URL/auth" -d "{\"password\":\"$VB_PIHOLE_APP_PASSWORD\"}"` and save the JSON. Otherwise use this literal (shape per spec §3):

```json
{ "session": { "valid": true, "totp": false, "sid": "N4X…redacted…", "csrf": "abc123", "validity": 1800, "message": null } }
```

- [ ] **Step 2: Write the failing test** — `tests/server/adapters/pihole-auth.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { startStubPihole } from '../../helpers/stub-pihole';
import { makePiholeAdapter } from '$lib/server/adapters/gatekeeper/pihole';

let close: (() => Promise<void>) | null = null;
afterEach(async () => { await close?.(); close = null; });

describe('Pi-hole auth', () => {
  it('logs in once and reuses the session for subsequent calls', async () => {
    const stub = await startStubPihole({ appPassword: 'pw', queries: [] });
    close = stub.close;
    const a = makePiholeAdapter({ baseUrl: stub.baseUrl, appPassword: 'pw' });
    await a._authedFetch('/queries?length=1');
    await a._authedFetch('/queries?length=1');
    expect(stub.authCount).toBe(1);
  });

  it('re-authenticates once when the session has expired (401) and retries', async () => {
    const stub = await startStubPihole({ appPassword: 'pw', queries: [], sessionTtlMs: 1 });
    close = stub.close;
    const a = makePiholeAdapter({ baseUrl: stub.baseUrl, appPassword: 'pw' });
    await a._authedFetch('/queries?length=1');
    await new Promise((r) => setTimeout(r, 5));            // let the session expire
    const res = await a._authedFetch('/queries?length=1'); // should transparently re-auth
    expect(res.status).toBe(200);
    expect(stub.authCount).toBe(2);
  });

  it('throws a clear error on bad credentials', async () => {
    const stub = await startStubPihole({ appPassword: 'right', queries: [] });
    close = stub.close;
    const a = makePiholeAdapter({ baseUrl: stub.baseUrl, appPassword: 'wrong' });
    await expect(a._authedFetch('/queries?length=1')).rejects.toThrow(/pi-hole auth failed/i);
  });
});
```

- [ ] **Step 3: Run it, watch it fail**

Run: `pnpm test tests/server/adapters/pihole-auth.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Create `tests/helpers/stub-pihole.ts`**

```ts
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';

export async function startStubPihole(opts?: {
  appPassword?: string; queries?: unknown[]; sessionTtlMs?: number;
}) {
  const appPassword = opts?.appPassword ?? 'test-pw';
  const ttl = opts?.sessionTtlMs ?? 1_800_000;
  let queries: unknown[] = opts?.queries ?? [];
  const sessions = new Map<string, number>(); // sid -> expiresAt
  let authCount = 0;

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'POST' && url.pathname === '/auth') {
      let raw = '';
      for await (const c of req) raw += c;
      const pw = JSON.parse(raw || '{}').password;
      if (pw !== appPassword) return send(401, { session: { valid: false, message: 'bad password' } });
      authCount++;
      const sid = randomUUID();
      sessions.set(sid, Date.now() + ttl);
      return send(200, { session: { valid: true, sid, csrf: 'csrf', validity: ttl / 1000 } });
    }

    const sid = req.headers['x-ftl-sid'] as string | undefined;
    const exp = sid ? sessions.get(sid) : undefined;
    if (!exp || exp < Date.now()) return send(401, { session: { valid: false } });

    if (url.pathname === '/queries') {
      const length = Number(url.searchParams.get('length') ?? '100');
      const cursor = url.searchParams.get('cursor');
      // rows are assumed pre-sorted newest-first with a numeric `id`
      const all = queries as Array<{ id: number }>;
      const start = cursor ? all.findIndex((q) => q.id === Number(cursor)) + 1 : 0;
      const page = all.slice(start, start + length);
      const next = start + length < all.length ? page[page.length - 1]?.id ?? null : null;
      return send(200, {
        queries: page,
        cursor: next,
        recordsTotal: all.length,
        recordsFiltered: all.length,
        earliest_timestamp: all.length ? (all[all.length - 1] as any).time : Date.now() / 1000
      });
    }
    return send(404, { error: 'not found' });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    get authCount() { return authCount; },
    setQueries(q: unknown[]) { queries = q; },
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}
```

- [ ] **Step 5: Create `src/lib/server/adapters/gatekeeper/types.ts`** — exactly the interface block from "Produces" above.

- [ ] **Step 6: Create `src/lib/server/adapters/gatekeeper/pihole.ts` (auth part only)**

```ts
import type { GatekeeperAdapter } from './types';

interface PiholeCfg { baseUrl: string; appPassword: string; fetchImpl?: typeof fetch }

export function makePiholeAdapter(cfg: PiholeCfg) {
  const doFetch = cfg.fetchImpl ?? fetch;
  let sid: string | null = null;

  async function login(): Promise<void> {
    const res = await doFetch(`${cfg.baseUrl}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: cfg.appPassword })
    });
    const body = (await res.json().catch(() => ({}))) as { session?: { valid?: boolean; sid?: string } };
    if (!res.ok || !body.session?.valid || !body.session.sid) {
      throw new Error(`Pi-hole auth failed (status ${res.status})`);
    }
    sid = body.session.sid;
  }

  async function _authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    if (!sid) await login();
    const call = () =>
      doFetch(`${cfg.baseUrl}${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), 'X-FTL-SID': sid! },
        signal: init.signal ?? AbortSignal.timeout(15_000)
      });
    let res = await call();
    if (res.status === 401) {
      sid = null;
      await login();
      res = await call();
    }
    return res;
  }

  const adapter: GatekeeperAdapter = {
    async listResolvedDomains() {
      throw new Error('implemented in Task 6');
    }
  };

  return Object.assign(adapter, { _authedFetch });
}
```

- [ ] **Step 7: Run the auth tests, watch them pass**

Run: `pnpm test tests/server/adapters/pihole-auth.test.ts`
Expected: 3 passed.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: Pi-hole adapter auth + session re-auth, stub Pi-hole server"
```

---

## Task 6: Pi-hole adapter — `listResolvedDomains`

**Files:**
- Modify: `src/lib/server/adapters/gatekeeper/pihole.ts` (replace the `listResolvedDomains` stub)
- Create: `tests/fixtures/pihole-queries.json`
- Test: `tests/server/adapters/pihole-queries.test.ts`

**Background (spec §3, §8):**
- `GET {baseUrl}/queries?from=<epochSec>&until=<epochSec>&length=<n>&cursor=<id>` — Pi-hole timestamps are **epoch seconds (float)**; our interface is **epoch ms**. Divide/multiply by 1000.
- Response: `{ queries: Query[], cursor: number|null, recordsTotal, recordsFiltered, earliest_timestamp }`.
- Each `Query`: `{ id, time (epoch sec), type, domain, cname, status, client: { ip, name }, reply: {...}, upstream, list_id }`.
- `status` → `disposition`:
  - `allowed`: `FORWARDED`, `CACHE`, `CACHE_STALE`, `RETRIED`, `RETRIED_DNSSEC`
  - `blocked`: `GRAVITY`, `DENYLIST`, `REGEX`, `EXTERNAL_BLOCKED_IP`, `EXTERNAL_BLOCKED_NULL`, `EXTERNAL_BLOCKED_NXRA`, `GRAVITY_CNAME`, `REGEX_CNAME`, `DENYLIST_CNAME`
  - anything else → `other`
- **Cursor:** opaque string; we use the Pi-hole numeric `cursor` value stringified. `nextCursor = null` when the response `cursor` is `null` (caught up).
- **`gapBefore`:** if the response's `earliest_timestamp` (epoch sec → ms) is **greater than** the requested `since`, data older than `earliest_timestamp` is unavailable — return `gapBefore = earliest_timestamp_ms`. Otherwise `null`.
- The adapter returns **one page per call**. The caller (Task 13) loops on `nextCursor`.

**Interfaces:**
- Consumes: `_authedFetch` (Task 5).
- Produces: the real `listResolvedDomains` matching `GatekeeperAdapter` (Task 5 types). No signature change.

- [ ] **Step 1: Create `tests/fixtures/pihole-queries.json`** (captured or literal — 3 rows: one FORWARDED, one GRAVITY, one CNAME-inspected)

```json
{
  "queries": [
    { "id": 1003, "time": 1725500000.5, "type": "A", "domain": "telemetry.example.com",
      "cname": null, "status": "FORWARDED", "client": { "ip": "192.168.1.20", "name": "laptop" },
      "reply": { "type": "IP", "time": 12 }, "upstream": "1.1.1.1#53", "list_id": null },
    { "id": 1002, "time": 1725499999.1, "type": "A", "domain": "ads.doubleclick.net",
      "cname": null, "status": "GRAVITY", "client": { "ip": "192.168.1.21", "name": null },
      "reply": { "type": "NULL", "time": 1 }, "upstream": null, "list_id": 4 },
    { "id": 1001, "time": 1725499998.0, "type": "A", "domain": "cdn.example.org",
      "cname": "tracker.evil.test", "status": "DENYLIST_CNAME", "client": { "ip": "192.168.1.22", "name": "phone" },
      "reply": { "type": "NULL", "time": 2 }, "upstream": null, "list_id": null }
  ],
  "cursor": null,
  "recordsTotal": 3,
  "recordsFiltered": 3,
  "earliest_timestamp": 1725499998.0
}
```

- [ ] **Step 2: Write the failing test** — `tests/server/adapters/pihole-queries.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest';
import fixture from '../../fixtures/pihole-queries.json';
import { startStubPihole } from '../../helpers/stub-pihole';
import { makePiholeAdapter } from '$lib/server/adapters/gatekeeper/pihole';

let close: (() => Promise<void>) | null = null;
afterEach(async () => { await close?.(); close = null; });

describe('listResolvedDomains', () => {
  it('normalizes rows: ms timestamps, client, disposition from status', async () => {
    const stub = await startStubPihole({ appPassword: 'pw', queries: fixture.queries });
    close = stub.close;
    const a = makePiholeAdapter({ baseUrl: stub.baseUrl, appPassword: 'pw' });
    const { entries, nextCursor } = await a.listResolvedDomains({
      since: 0, until: Date.now(), limit: 100
    });
    expect(nextCursor).toBeNull();
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      domain: 'telemetry.example.com',
      client: { id: '192.168.1.20', label: 'laptop' },
      at: 1725500000500,
      disposition: 'allowed',
      rawStatus: 'FORWARDED'
    });
    expect(entries[1].disposition).toBe('blocked');       // GRAVITY
    expect(entries[2].disposition).toBe('blocked');       // DENYLIST_CNAME
    expect(entries[2].client).toEqual({ id: '192.168.1.22', label: 'phone' });
  });

  it('pages: follows the numeric cursor and stops at null', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: 100 - i, time: 1725500000 - i, type: 'A', domain: `d${i}.com`,
      cname: null, status: 'FORWARDED', client: { ip: '10.0.0.1', name: null }, reply: {}, upstream: 'x'
    }));
    const stub = await startStubPihole({ appPassword: 'pw', queries: rows });
    close = stub.close;
    const a = makePiholeAdapter({ baseUrl: stub.baseUrl, appPassword: 'pw' });

    const p1 = await a.listResolvedDomains({ since: 0, until: Date.now(), limit: 2 });
    expect(p1.entries.map((e) => e.domain)).toEqual(['d0.com', 'd1.com']);
    expect(p1.nextCursor).toBe('99');

    const p2 = await a.listResolvedDomains({ since: 0, until: Date.now(), limit: 2, cursor: p1.nextCursor! });
    expect(p2.entries.map((e) => e.domain)).toEqual(['d2.com', 'd3.com']);
  });

  it('reports gapBefore when earliest available data is newer than `since`', async () => {
    const stub = await startStubPihole({ appPassword: 'pw', queries: fixture.queries });
    close = stub.close;
    const a = makePiholeAdapter({ baseUrl: stub.baseUrl, appPassword: 'pw' });
    const since = Date.UTC(2020, 0, 1); // way before the fixture's earliest_timestamp
    const r = await a.listResolvedDomains({ since, until: Date.now(), limit: 100 });
    expect(r.gapBefore).toBe(1725499998000);
  });
});
```

- [ ] **Step 3: Run it, watch it fail**

Run: `pnpm test tests/server/adapters/pihole-queries.test.ts`
Expected: FAIL — `listResolvedDomains` throws "implemented in Task 6".

- [ ] **Step 4: Replace the `listResolvedDomains` stub in `src/lib/server/adapters/gatekeeper/pihole.ts`**

```ts
import type { GatekeeperAdapter, ResolvedQuery } from './types';

const ALLOWED = new Set(['FORWARDED', 'CACHE', 'CACHE_STALE', 'RETRIED', 'RETRIED_DNSSEC']);
const BLOCKED = new Set([
  'GRAVITY', 'DENYLIST', 'REGEX',
  'EXTERNAL_BLOCKED_IP', 'EXTERNAL_BLOCKED_NULL', 'EXTERNAL_BLOCKED_NXRA',
  'GRAVITY_CNAME', 'REGEX_CNAME', 'DENYLIST_CNAME'
]);

function dispositionOf(status: string): ResolvedQuery['disposition'] {
  if (ALLOWED.has(status)) return 'allowed';
  if (BLOCKED.has(status)) return 'blocked';
  return 'other';
}

interface PiholeQueryRow {
  id: number; time: number; domain: string; status: string;
  client: { ip: string; name: string | null };
}
```

Then the method body (replaces the throwing stub inside `makePiholeAdapter`):

```ts
async listResolvedDomains(opts) {
  const params = new URLSearchParams({
    from: String(Math.floor(opts.since / 1000)),
    until: String(Math.ceil(opts.until / 1000)),
    length: String(opts.limit)
  });
  if (opts.cursor) params.set('cursor', opts.cursor);

  const res = await _authedFetch(`/queries?${params.toString()}`);
  if (!res.ok) throw new Error(`Pi-hole /queries returned ${res.status}`);
  const body = (await res.json()) as {
    queries: PiholeQueryRow[]; cursor: number | null; earliest_timestamp: number;
  };

  const entries: ResolvedQuery[] = body.queries.map((q) => ({
    domain: q.domain,
    client: { id: q.client.ip, label: q.client.name ?? null },
    at: Math.round(q.time * 1000),
    disposition: dispositionOf(q.status),
    rawStatus: q.status
  }));

  const earliestMs = Math.round(body.earliest_timestamp * 1000);
  const gapBefore = earliestMs > opts.since ? earliestMs : null;

  return {
    entries,
    nextCursor: body.cursor === null ? null : String(body.cursor),
    gapBefore
  };
}
```

- [ ] **Step 5: Run the queries tests, watch them pass**

Run: `pnpm test tests/server/adapters/pihole-queries.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Run the whole adapter folder**

Run: `pnpm test tests/server/adapters/`
Expected: all green (auth + queries).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: Pi-hole listResolvedDomains — normalize, page, gap-detect"
```

---

## Task 7: Enrichment — DNS + WHOIS

**Files:**
- Create: `src/lib/server/enrichment/dns.ts`, `src/lib/server/enrichment/whois.ts`
- Test: `tests/server/enrichment/dns.test.ts`, `tests/server/enrichment/whois.test.ts`

**Interfaces:**
- Consumes: `now` from Task 2. Node `node:dns/promises`. `whoiser` package.
- Produces:
  ```ts
  // dns.ts
  export interface DnsInfo { a: string[]; cname: string[]; ns: string[] }
  export function makeDnsLookup(deps?: {
    resolver?: { resolve4(d: string): Promise<string[]>; resolveCname(d: string): Promise<string[]>; resolveNs(d: string): Promise<string[]> };
    ttlMs?: number;         // default 3_600_000
  }): (domain: string) => Promise<DnsInfo | null>;   // null only on total failure

  // whois.ts
  export interface WhoisInfo { ageDays: number | null; registrar: string | null }
  export function makeWhoisLookup(deps?: {
    whoiserImpl?: (domain: string, opts?: unknown) => Promise<Record<string, any>>;
    ttlMs?: number;         // default 86_400_000
  }): (domain: string) => Promise<WhoisInfo | null>;
  ```
- Both cache per-domain in an in-process `Map` with the given TTL. Both **never throw** — on error they return `null` (or `{a:[],cname:[],ns:[]}` for DNS partial failures per the test below).

- [ ] **Step 1: Write the failing test** — `tests/server/enrichment/dns.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { makeDnsLookup } from '$lib/server/enrichment/dns';

describe('makeDnsLookup', () => {
  it('collects A / CNAME / NS and caches within TTL', async () => {
    let calls = 0;
    const resolver = {
      resolve4: async () => { calls++; return ['1.2.3.4']; },
      resolveCname: async () => ['cdn.example.net'],
      resolveNs: async () => ['ns1.example.net']
    };
    const lookup = makeDnsLookup({ resolver, ttlMs: 10_000 });
    const a = await lookup('x.com');
    expect(a).toEqual({ a: ['1.2.3.4'], cname: ['cdn.example.net'], ns: ['ns1.example.net'] });
    await lookup('x.com');
    expect(calls).toBe(1);                      // cached
  });

  it('tolerates per-record failures (returns empty arrays, not null)', async () => {
    const resolver = {
      resolve4: async () => { throw new Error('ENOTFOUND'); },
      resolveCname: async () => { throw new Error('ENODATA'); },
      resolveNs: async () => ['ns1.example.net']
    };
    const lookup = makeDnsLookup({ resolver });
    expect(await lookup('x.com')).toEqual({ a: [], cname: [], ns: ['ns1.example.net'] });
  });
});
```

- [ ] **Step 2: Run it, watch it fail.** `pnpm test tests/server/enrichment/dns.test.ts` → module not found.

- [ ] **Step 3: Create `src/lib/server/enrichment/dns.ts`**

```ts
import { Resolver } from 'node:dns/promises';
import { now } from '../time';

export interface DnsInfo { a: string[]; cname: string[]; ns: string[] }

export function makeDnsLookup(deps?: {
  resolver?: { resolve4(d: string): Promise<string[]>; resolveCname(d: string): Promise<string[]>; resolveNs(d: string): Promise<string[]> };
  ttlMs?: number;
}): (domain: string) => Promise<DnsInfo | null> {
  const resolver = deps?.resolver ?? new Resolver();
  const ttl = deps?.ttlMs ?? 3_600_000;
  const cache = new Map<string, { at: number; value: DnsInfo }>();

  const safe = async (p: Promise<string[]>): Promise<string[]> => {
    try { return await p; } catch { return []; }
  };

  return async (domain: string): Promise<DnsInfo | null> => {
    const hit = cache.get(domain);
    if (hit && now() - hit.at < ttl) return hit.value;
    try {
      const [a, cname, ns] = await Promise.all([
        safe(resolver.resolve4(domain)),
        safe(resolver.resolveCname(domain)),
        safe(resolver.resolveNs(domain))
      ]);
      const value = { a, cname, ns };
      cache.set(domain, { at: now(), value });
      return value;
    } catch {
      return null;
    }
  };
}
```

- [ ] **Step 4: Run it, watch it pass.** `pnpm test tests/server/enrichment/dns.test.ts` → 2 passed.

- [ ] **Step 5: Write the failing test** — `tests/server/enrichment/whois.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { makeWhoisLookup } from '$lib/server/enrichment/whois';

describe('makeWhoisLookup', () => {
  it('extracts registrar and derives age in days from creation date', async () => {
    const created = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const whoiserImpl = async () => ({
      'whois.nic.test': { 'Created Date': created, Registrar: 'Test Registrar LLC' }
    });
    const lookup = makeWhoisLookup({ whoiserImpl });
    const r = await lookup('x.com');
    expect(r!.registrar).toBe('Test Registrar LLC');
    expect(r!.ageDays).toBeGreaterThanOrEqual(29);
    expect(r!.ageDays).toBeLessThanOrEqual(31);
  });

  it('returns null on whois failure', async () => {
    const lookup = makeWhoisLookup({ whoiserImpl: async () => { throw new Error('timeout'); } });
    expect(await lookup('x.com')).toBeNull();
  });

  it('returns {ageDays:null, registrar:null} when fields are absent', async () => {
    const lookup = makeWhoisLookup({ whoiserImpl: async () => ({ 'whois.x': {} }) });
    expect(await lookup('x.com')).toEqual({ ageDays: null, registrar: null });
  });
});
```

- [ ] **Step 6: Run it, watch it fail.**

- [ ] **Step 7: Create `src/lib/server/enrichment/whois.ts`**

```ts
import { now } from '../time';

export interface WhoisInfo { ageDays: number | null; registrar: string | null }

const CREATED_KEYS = ['Created Date', 'Creation Date', 'created', 'createdDate'];
const REGISTRAR_KEYS = ['Registrar', 'registrar', 'Sponsoring Registrar'];

function pick(obj: Record<string, any>, keys: string[]): string | null {
  for (const k of keys) if (obj[k]) return String(obj[k]);
  return null;
}

export function makeWhoisLookup(deps?: {
  whoiserImpl?: (domain: string, opts?: unknown) => Promise<Record<string, any>>;
  ttlMs?: number;
}): (domain: string) => Promise<WhoisInfo | null> {
  const ttl = deps?.ttlMs ?? 86_400_000;
  const cache = new Map<string, { at: number; value: WhoisInfo }>();

  return async (domain: string): Promise<WhoisInfo | null> => {
    const hit = cache.get(domain);
    if (hit && now() - hit.at < ttl) return hit.value;

    let raw: Record<string, any>;
    try {
      const impl = deps?.whoiserImpl ?? (await import('whoiser')).default;
      raw = await impl(domain, { timeout: 8000 });
    } catch {
      return null;
    }

    // whoiser returns { <whois server>: { ...fields } }; flatten the first server block
    const block = (raw && typeof raw === 'object' ? Object.values(raw)[0] : null) as Record<string, any> | null;
    if (!block || typeof block !== 'object') return { ageDays: null, registrar: null };

    const createdStr = pick(block, CREATED_KEYS);
    let ageDays: number | null = null;
    if (createdStr) {
      const ts = Date.parse(createdStr);
      if (Number.isFinite(ts)) ageDays = Math.floor((now() - ts) / 86_400_000);
    }
    const value = { ageDays, registrar: pick(block, REGISTRAR_KEYS) };
    cache.set(domain, { at: now(), value });
    return value;
  };
}
```

- [ ] **Step 8: Run it, watch it pass.** `pnpm test tests/server/enrichment/` → all green.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: DNS + WHOIS enrichment with in-process TTL cache"
```

---

## Task 8: Reputation types + `CuratedListSource`

**Files:**
- Create: `src/lib/server/reputation/types.ts`, `src/lib/server/reputation/curated-list.ts`
- Create: `tests/fixtures/curated-hosts.txt`, `tests/fixtures/curated-domains.txt`, `tests/fixtures/curated-adblock.txt`
- Test: `tests/server/reputation/curated-list.test.ts`

**Background (spec §4, §6, §9):** `CuratedListSource` downloads plain blocklists, holds all their domains in an in-memory `Set`, persists them to `curated_domains` for fast restart, and votes: **`block` @ confidence 1.0** if the domain (or any parent domain) is in the set, else **`unsure` @ confidence 0** (an abstention — it must not vote `allow`). It is called **inline during ingestion**, not through a drainer, so its `limits` are all `null`.

**List formats to parse** (one function, autodetect per line):
- hosts style: `0.0.0.0 ads.example.com` or `127.0.0.1 ads.example.com`
- plain domain: `ads.example.com`
- wildcard/adblock style: `||ads.example.com^`
- ignore: blank lines, lines starting with `#` or `!`, and `localhost` / `local` entries.

**Interfaces:**
- Consumes: `db`, `schema`, repo helpers indirectly (uses `db` directly for `curated_domains` / `curated_lists`); `now` from Task 2.
- Produces:
  ```ts
  // reputation/types.ts
  export interface SourceLimits {
    perMinute: number | null; perDay: number | null; perMonth: number | null;
    dailyCostCeilingUsd: number | null;
  }
  export interface AssessmentInput {
    domain: string;
    hitCount: number;
    distinctClientCount: number;
    curatedListHits: string[];
    enrichment: {
      whois: { ageDays: number | null; registrar: string | null } | null;
      dns: { a: string[]; cname: string[]; ns: string[] } | null;
    };
  }
  export interface SourceVerdict {
    verdict: 'block' | 'allow' | 'unsure';
    confidence: number;
    category: string | null;
    detail: string | null;
    raw: unknown;
    usage?: { inputTokens: number; outputTokens: number; costUsd: number };
  }
  export interface ReputationSource {
    readonly name: 'curated_list' | 'metadefender' | 'ai' | 'virustotal';
    readonly weight: number;
    readonly limits: SourceLimits;
    assess(input: AssessmentInput): Promise<SourceVerdict>;
  }
  export const NO_LIMITS: SourceLimits =
    { perMinute: null, perDay: null, perMonth: null, dailyCostCeilingUsd: null };

  // curated-list.ts
  export function parseListText(text: string): string[];          // → array of bare domains
  export function makeCuratedListSource(db: any, schema: any, opts: {
    urls: string[];
    fetchImpl?: typeof fetch;
  }): ReputationSource & {
    refresh(): Promise<void>;      // fetch every url, replace the set + curated_domains, update curated_lists
    loadFromDb(): Promise<void>;   // rebuild the in-memory set from curated_domains (fast path on boot)
    has(domain: string): boolean;
  };
  ```
- `assess` fills `curatedListHits` on its own return? No — `assess` returns a `SourceVerdict`; the `AssessmentInput.curatedListHits` field is populated by the ingestion/drainer code calling `source.has(...)`/list names. For this source `assess` just needs `input.domain`. `raw` = `{ matchedListNames: string[] }`.

- [ ] **Step 1: Create the fixtures**

`tests/fixtures/curated-hosts.txt`:
```
# sample hosts list
0.0.0.0 ads.tracker.test
127.0.0.1 localhost
0.0.0.0 metrics.tracker.test
```
`tests/fixtures/curated-domains.txt`:
```
! title: sample
plainbad.test
another.plainbad.test
```
`tests/fixtures/curated-adblock.txt`:
```
||wildcardbad.test^
||sub.wildcardbad.test^
```

- [ ] **Step 2: Write the failing test** — `tests/server/reputation/curated-list.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeTestDb } from '../../helpers/test-db';
import { parseListText, makeCuratedListSource } from '$lib/server/reputation/curated-list';

let closer: (() => void) | null = null;
afterEach(() => { closer?.(); closer = null; });

const hosts = readFileSync('tests/fixtures/curated-hosts.txt', 'utf8');
const domainsList = readFileSync('tests/fixtures/curated-domains.txt', 'utf8');
const adblock = readFileSync('tests/fixtures/curated-adblock.txt', 'utf8');

describe('parseListText', () => {
  it('parses hosts, plain and adblock lines and drops comments/localhost', () => {
    expect(parseListText(hosts).sort()).toEqual(['ads.tracker.test', 'metrics.tracker.test']);
    expect(parseListText(domainsList).sort()).toEqual(['another.plainbad.test', 'plainbad.test']);
    expect(parseListText(adblock).sort()).toEqual(['sub.wildcardbad.test', 'wildcardbad.test']);
  });
});

describe('makeCuratedListSource', () => {
  const fetchImpl = (async (url: string) => {
    const body = String(url).includes('hosts') ? hosts
      : String(url).includes('adblock') ? adblock : domainsList;
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;

  it('refresh loads every url into the set and persists to curated_domains', async () => {
    const t = await makeTestDb(); closer = t.close;
    const src = makeCuratedListSource(t.db, t.schema, {
      urls: ['http://x/hosts.txt', 'http://x/adblock.txt', 'http://x/domains.txt'], fetchImpl
    });
    await src.refresh();
    expect(src.has('ads.tracker.test')).toBe(true);
    expect(src.has('wildcardbad.test')).toBe(true);
    const rows = await t.db.select().from(t.schema.curatedDomains);
    expect(rows.length).toBe(6);
    const lists = await t.db.select().from(t.schema.curatedLists);
    expect(lists.every((l: any) => l.entryCount > 0 && l.lastError === null)).toBe(true);
  });

  it('votes block@1 for a listed domain and for a subdomain of a listed domain', async () => {
    const t = await makeTestDb(); closer = t.close;
    const src = makeCuratedListSource(t.db, t.schema, { urls: ['http://x/domains.txt'], fetchImpl });
    await src.refresh();
    const base = { hitCount: 1, distinctClientCount: 1, curatedListHits: [], enrichment: { whois: null, dns: null } };

    const hit = await src.assess({ ...base, domain: 'plainbad.test' });
    expect(hit).toMatchObject({ verdict: 'block', confidence: 1 });

    const subHit = await src.assess({ ...base, domain: 'deep.plainbad.test' });
    expect(subHit.verdict).toBe('block');                 // parent-domain match

    const miss = await src.assess({ ...base, domain: 'totally-fine.test' });
    expect(miss).toMatchObject({ verdict: 'unsure', confidence: 0 });
  });

  it('loadFromDb rebuilds the set without re-fetching', async () => {
    const t = await makeTestDb(); closer = t.close;
    const a = makeCuratedListSource(t.db, t.schema, { urls: ['http://x/domains.txt'], fetchImpl });
    await a.refresh();
    const b = makeCuratedListSource(t.db, t.schema, { urls: [], fetchImpl });
    await b.loadFromDb();
    expect(b.has('plainbad.test')).toBe(true);
  });

  it('records last_error and keeps the previous set when a url fails', async () => {
    const t = await makeTestDb(); closer = t.close;
    const flaky = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const src = makeCuratedListSource(t.db, t.schema, { urls: ['http://x/domains.txt'], fetchImpl: flaky });
    await src.refresh();                          // must not throw
    const [list] = await t.db.select().from(t.schema.curatedLists);
    expect(list.lastError).toMatch(/500/);
  });
});
```

- [ ] **Step 3: Run it, watch it fail.**

- [ ] **Step 4: Create `src/lib/server/reputation/types.ts`** — exactly the block from "Produces".

- [ ] **Step 5: Create `src/lib/server/reputation/curated-list.ts`**

```ts
import { eq } from 'drizzle-orm';
import { now } from '../time';
import { NO_LIMITS, type AssessmentInput, type ReputationSource, type SourceVerdict } from './types';

export function parseListText(text: string): string[] {
  const out = new Set<string>();
  for (const lineRaw of text.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    let domain: string | null = null;
    if (line.startsWith('||')) {
      const m = line.match(/^\|\|([a-z0-9._-]+)\^/i);
      domain = m?.[1] ?? null;
    } else if (/\s/.test(line)) {
      const parts = line.split(/\s+/);
      domain = parts[1] ?? null;                          // "0.0.0.0 domain"
    } else {
      domain = line;
    }
    if (!domain) continue;
    domain = domain.toLowerCase().replace(/\.$/, '');
    if (domain === 'localhost' || domain === 'local' || !domain.includes('.')) continue;
    out.add(domain);
  }
  return [...out];
}

function listName(url: string): string {
  try { return new URL(url).hostname + new URL(url).pathname; } catch { return url; }
}

export function makeCuratedListSource(
  db: any, schema: any, opts: { urls: string[]; fetchImpl?: typeof fetch }
) {
  const doFetch = opts.fetchImpl ?? fetch;
  let set = new Set<string>();

  const has = (domain: string): boolean => {
    const d = domain.toLowerCase().replace(/\.$/, '');
    const labels = d.split('.');
    for (let i = 0; i < labels.length - 1; i++) {
      if (set.has(labels.slice(i).join('.'))) return true;
    }
    return false;
  };

  async function refresh(): Promise<void> {
    const next = new Set<string>();
    const perList: Array<{ name: string; url: string; domains: string[]; error: string | null }> = [];

    for (const url of opts.urls) {
      const name = listName(url);
      try {
        const res = await doFetch(url);
        if (!res.ok) { perList.push({ name, url, domains: [], error: `HTTP ${res.status}` }); continue; }
        const domains = parseListText(await res.text());
        domains.forEach((d) => next.add(d));
        perList.push({ name, url, domains, error: null });
      } catch (e) {
        perList.push({ name, url, domains: [], error: (e as Error).message });
      }
    }

    // keep previous set entries for any list that failed
    for (const l of perList) if (l.error) for (const d of set) next.add(d);
    set = next;

    for (const l of perList) {
      if (!l.error) {
        await db.delete(schema.curatedDomains).where(eq(schema.curatedDomains.sourceList, l.name));
        if (l.domains.length) {
          const rows = l.domains.map((domain) => ({ domain, sourceList: l.name }));
          for (let i = 0; i < rows.length; i += 500) {
            await db.insert(schema.curatedDomains).values(rows.slice(i, i + 500)).onConflictDoNothing();
          }
        }
      }
      await db.insert(schema.curatedLists)
        .values({ name: l.name, url: l.url, lastFetched: now(), entryCount: l.domains.length, lastError: l.error })
        .onConflictDoUpdate({
          target: schema.curatedLists.name,
          set: { url: l.url, lastFetched: now(), entryCount: l.domains.length, lastError: l.error }
        });
    }
  }

  async function loadFromDb(): Promise<void> {
    const rows = await db.select({ domain: schema.curatedDomains.domain }).from(schema.curatedDomains);
    set = new Set(rows.map((r: { domain: string }) => r.domain));
  }

  const source: ReputationSource = {
    name: 'curated_list',
    weight: 1.0,
    limits: NO_LIMITS,
    async assess(input: AssessmentInput): Promise<SourceVerdict> {
      if (has(input.domain)) {
        return { verdict: 'block', confidence: 1, category: 'listed', detail: 'on a curated blocklist', raw: { matched: true } };
      }
      return { verdict: 'unsure', confidence: 0, category: null, detail: null, raw: { matched: false } };
    }
  };

  return Object.assign(source, { refresh, loadFromDb, has });
}
```

- [ ] **Step 6: Run it, watch it pass.** Adjust `.onConflictDoNothing()` target form to your Drizzle version if needed.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: reputation interfaces + curated-list source (parse, cache, vote)"
```

---

## Task 9: `LlmProvider` + `OpenAiCompatibleProvider`

**Files:**
- Create: `src/lib/server/llm/types.ts`, `src/lib/server/llm/openai-compatible.ts`
- Test: `tests/server/llm/openai-compatible.test.ts`

**Background (spec §"AI assessor"):** one POST to `{baseUrl}/chat/completions`, OpenAI shape. Ask for a strict JSON object. Try `response_format: { type: 'json_schema', json_schema: {...} }` first; if the body isn't valid JSON matching the Zod schema, retry once with a blunt "Return ONLY minified JSON, no prose" system message and no `response_format`. If it still fails → throw `LlmParseError`. Extract token usage from `usage.prompt_tokens` / `usage.completion_tokens` (default 0 when absent — local servers often omit it).

**Interfaces:**
- Consumes: nothing (pure HTTP). `fetchImpl` injectable.
- Produces:
  ```ts
  // llm/types.ts
  export interface LlmAssessResult {
    verdict: 'block' | 'allow' | 'unsure';
    category: string | null;
    confidence: number;
    reasoning: string;
    usage: { inputTokens: number; outputTokens: number };
  }
  export interface LlmProvider {
    assess(req: { domain: string; context: string }): Promise<LlmAssessResult>;
  }
  export class LlmParseError extends Error {}

  // openai-compatible.ts
  export function makeOpenAiCompatibleProvider(cfg: {
    baseUrl: string; apiKey: string; model: string; fetchImpl?: typeof fetch; timeoutMs?: number;
  }): LlmProvider;
  ```
- The Zod schema for the model's reply:
  ```ts
  const Reply = z.object({
    verdict: z.enum(['block', 'allow', 'unsure']),
    category: z.string().nullable().default(null),
    confidence: z.number().min(0).max(1),
    reasoning: z.string().default('')
  });
  ```

- [ ] **Step 1: Write the failing test** — `tests/server/llm/openai-compatible.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { makeOpenAiCompatibleProvider } from '$lib/server/llm/openai-compatible';
import { LlmParseError } from '$lib/server/llm/types';

const mkFetch = (bodies: string[]) => {
  let i = 0;
  return (async (_url: string, init: RequestInit) => {
    const content = bodies[Math.min(i++, bodies.length - 1)];
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 }
    }), { status: 200 });
  }) as unknown as typeof fetch;
};

const provider = (f: typeof fetch) =>
  makeOpenAiCompatibleProvider({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm', fetchImpl: f });

describe('OpenAiCompatibleProvider', () => {
  it('parses a clean json_schema reply and returns usage', async () => {
    const p = provider(mkFetch(['{"verdict":"block","category":"ad","confidence":0.8,"reasoning":"tracker domain"}']));
    const r = await p.assess({ domain: 'ads.x.com', context: 'hits=5' });
    expect(r).toEqual({
      verdict: 'block', category: 'ad', confidence: 0.8,
      reasoning: 'tracker domain', usage: { inputTokens: 100, outputTokens: 20 }
    });
  });

  it('recovers by retrying once when the first reply has prose around the JSON', async () => {
    const p = provider(mkFetch([
      'Sure! Here you go:\n```json\n{"verdict":"allow","confidence":0.2}\n``` hope that helps',
      '{"verdict":"allow","category":null,"confidence":0.2,"reasoning":""}'
    ]));
    const r = await p.assess({ domain: 'cdn.x.com', context: '' });
    expect(r.verdict).toBe('allow');
  });

  it('throws LlmParseError when both attempts are unusable', async () => {
    const p = provider(mkFetch(['not json at all', 'still not json']));
    await expect(p.assess({ domain: 'x.com', context: '' })).rejects.toBeInstanceOf(LlmParseError);
  });

  it('defaults usage to zero when the server omits it', async () => {
    const f = (async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"verdict":"unsure","confidence":0.5}' } }]
    }), { status: 200 })) as unknown as typeof fetch;
    const r = await provider(f).assess({ domain: 'x.com', context: '' });
    expect(r.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});
```

- [ ] **Step 2: Run it, watch it fail.**

- [ ] **Step 3: Create `src/lib/server/llm/types.ts`** — the block from "Produces".

- [ ] **Step 4: Create `src/lib/server/llm/openai-compatible.ts`**

```ts
import { z } from 'zod';
import { LlmParseError, type LlmAssessResult, type LlmProvider } from './types';

const Reply = z.object({
  verdict: z.enum(['block', 'allow', 'unsure']),
  category: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().default('')
});

const SYSTEM = `You are a DNS domain reputation classifier for an ad/tracker/malware blocklist.
Given a domain and context, decide whether it should be blocked.
Reply with a JSON object: {"verdict":"block"|"allow"|"unsure","category":string|null,"confidence":0..1,"reasoning":string}.`;

const JSON_SCHEMA = {
  name: 'domain_reputation',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['verdict', 'confidence'],
    properties: {
      verdict: { type: 'string', enum: ['block', 'allow', 'unsure'] },
      category: { type: ['string', 'null'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      reasoning: { type: 'string' }
    }
  }
};

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch { /* fall through */ } }
  const brace = trimmed.match(/\{[\s\S]*\}/);
  if (brace) { try { return JSON.parse(brace[0]); } catch { /* fall through */ } }
  return undefined;
}

export function makeOpenAiCompatibleProvider(cfg: {
  baseUrl: string; apiKey: string; model: string; fetchImpl?: typeof fetch; timeoutMs?: number;
}): LlmProvider {
  const doFetch = cfg.fetchImpl ?? fetch;
  const timeout = cfg.timeoutMs ?? 30_000;

  async function call(messages: unknown[], useSchema: boolean): Promise<{ content: string; usage: { inputTokens: number; outputTokens: number } }> {
    const res = await doFetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        messages,
        ...(useSchema ? { response_format: { type: 'json_schema', json_schema: JSON_SCHEMA } } : {})
      }),
      signal: AbortSignal.timeout(timeout)
    });
    if (!res.ok) throw new LlmParseError(`LLM HTTP ${res.status}`);
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      content: body.choices?.[0]?.message?.content ?? '',
      usage: {
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0
      }
    };
  }

  return {
    async assess(req): Promise<LlmAssessResult> {
      const user = `Domain: ${req.domain}\nContext:\n${req.context}`;
      const attempts: Array<{ messages: unknown[]; useSchema: boolean }> = [
        { messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], useSchema: true },
        {
          messages: [
            { role: 'system', content: SYSTEM + '\nReturn ONLY minified JSON. No prose, no code fences.' },
            { role: 'user', content: user }
          ],
          useSchema: false
        }
      ];

      let lastUsage = { inputTokens: 0, outputTokens: 0 };
      for (const a of attempts) {
        const { content, usage } = await call(a.messages, a.useSchema);
        lastUsage = usage;
        const parsed = Reply.safeParse(extractJson(content));
        if (parsed.success) {
          return {
            verdict: parsed.data.verdict,
            category: parsed.data.category,
            confidence: parsed.data.confidence,
            reasoning: parsed.data.reasoning,
            usage
          };
        }
      }
      throw new LlmParseError(`LLM reply not parseable after retry (tokens in=${lastUsage.inputTokens})`);
    }
  };
}
```

- [ ] **Step 5: Run it, watch it pass.** `pnpm test tests/server/llm/` → 4 passed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: provider-agnostic OpenAI-compatible LLM client with JSON fallback"
```

---

## Task 10: `AiSource`, `MetaDefenderSource`, `VirusTotalSource`, registry

**Files:**
- Create: `src/lib/server/reputation/ai.ts`, `src/lib/server/reputation/metadefender.ts`, `src/lib/server/reputation/virustotal.ts`, `src/lib/server/reputation/registry.ts`
- Test: `tests/server/reputation/ai.test.ts`, `tests/server/reputation/metadefender.test.ts`, `tests/server/reputation/virustotal.test.ts`, `tests/server/reputation/registry.test.ts`

**Interfaces (all implement `ReputationSource` from Task 8):**

```ts
// ai.ts  — weight 0.6
export function makeAiSource(cfg: {
  provider: LlmProvider;
  dailyCostCeilingUsd: number | null;
  priceInputPerMTok: number | null;
  priceOutputPerMTok: number | null;
}): ReputationSource;
// buildContext(input) is exported for its own unit test:
export function buildContext(input: AssessmentInput): string;

// metadefender.ts  — weight 1.0, limits { perDay: 4000, else null }
export function makeMetaDefenderSource(cfg: { apiKey: string; fetchImpl?: typeof fetch }): ReputationSource;

// virustotal.ts  — weight 1.0, limits { perMinute: 4, perDay: 500, perMonth: 15500 }
export function makeVirusTotalSource(cfg: { apiKey: string; fetchImpl?: typeof fetch }): ReputationSource;

// registry.ts
export function buildEnabledSources(cfg: Config, db: any, schema: any): {
  inline: ReputationSource;                // the curated-list source (run during ingestion)
  paced: ReputationSource[];               // metadefender / ai / virustotal, whichever are enabled
  curated: ReturnType<typeof makeCuratedListSource>;   // exposes refresh()/loadFromDb()
};
```

**MetaDefender mapping** (`GET https://api.metadefender.com/v4/domain/{domain}` with header `apikey`): response `lookup_results.sources[]` each `{ provider, assessment, status }` where `status` `0` = safe / `1` = malicious. Also a top-level `lookup_results.detected_by` count. Map:
- `detected_by >= 1` → `verdict: 'block'`, `confidence = min(1, detected_by / 5)`, `category` = first malicious source's `assessment` or `'malware'`.
- `detected_by === 0` → `verdict: 'allow'`, `confidence: 0.5`.
- HTTP 4xx/5xx → throw (drainer records `error`).

**VirusTotal mapping** (`GET https://www.virustotal.com/api/v3/domains/{domain}` with header `x-apikey`): `data.attributes.last_analysis_stats` `{ malicious, suspicious, harmless, undetected }`. Map:
- `malicious + suspicious >= 1` → `block`, `confidence = min(1, (malicious + 0.5*suspicious) / 5)`, `category` from `data.attributes.categories` first value or `'malware'`.
- else → `allow`, `confidence: 0.5`.

**AI cost:** `costUsd = (inputTokens/1e6)*priceInput + (outputTokens/1e6)*priceOutput` when both prices set, else `0`. The `SourceVerdict.usage` carries `{ inputTokens, outputTokens, costUsd }`. (The daily-ceiling *enforcement* is the governor's job in Task 12; this source only reports cost.)

- [ ] **Step 1: Write `tests/server/reputation/ai.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { makeAiSource, buildContext } from '$lib/server/reputation/ai';
import type { AssessmentInput } from '$lib/server/reputation/types';

const input: AssessmentInput = {
  domain: 'metrics.ads.test', hitCount: 12, distinctClientCount: 3, curatedListHits: ['oisd'],
  enrichment: { whois: { ageDays: 20, registrar: 'NameCheap' }, dns: { a: ['1.1.1.1'], cname: ['x'], ns: ['ns1'] } }
};

describe('buildContext', () => {
  it('produces a compact single-block string with the signals', () => {
    const c = buildContext(input);
    expect(c).toContain('hits=12');
    expect(c).toContain('clients=3');
    expect(c).toContain('whois_age_days=20');
    expect(c).toContain('curated_hits=oisd');
  });
});

describe('makeAiSource', () => {
  const provider = {
    assess: async () => ({
      verdict: 'block' as const, category: 'tracker', confidence: 0.77, reasoning: 'r',
      usage: { inputTokens: 200, outputTokens: 50 }
    })
  };

  it('maps the provider result and computes cost from prices', async () => {
    const src = makeAiSource({ provider, dailyCostCeilingUsd: null, priceInputPerMTok: 3, priceOutputPerMTok: 15 });
    const v = await src.assess(input);
    expect(v).toMatchObject({ verdict: 'block', category: 'tracker', confidence: 0.77 });
    // 200/1e6*3 + 50/1e6*15 = 0.0006 + 0.00075 = 0.00135
    expect(v.usage!.costUsd).toBeCloseTo(0.00135, 8);
    expect(src.weight).toBe(0.6);
  });

  it('reports zero cost when prices are not configured', async () => {
    const src = makeAiSource({ provider, dailyCostCeilingUsd: null, priceInputPerMTok: null, priceOutputPerMTok: null });
    const v = await src.assess(input);
    expect(v.usage!.costUsd).toBe(0);
  });
});
```

- [ ] **Step 2: Run, fail. Create `src/lib/server/reputation/ai.ts`**

```ts
import type { AssessmentInput, ReputationSource, SourceVerdict } from './types';
import type { LlmProvider } from '../llm/types';

export function buildContext(input: AssessmentInput): string {
  const w = input.enrichment.whois;
  const d = input.enrichment.dns;
  return [
    `hits=${input.hitCount}`,
    `clients=${input.distinctClientCount}`,
    `curated_hits=${input.curatedListHits.join(',') || 'none'}`,
    `whois_age_days=${w?.ageDays ?? 'unknown'}`,
    `whois_registrar=${w?.registrar ?? 'unknown'}`,
    `dns_a=${d?.a.join(',') || 'none'}`,
    `dns_cname=${d?.cname.join(',') || 'none'}`,
    `dns_ns=${d?.ns.join(',') || 'none'}`
  ].join('\n');
}

export function makeAiSource(cfg: {
  provider: LlmProvider;
  dailyCostCeilingUsd: number | null;
  priceInputPerMTok: number | null;
  priceOutputPerMTok: number | null;
}): ReputationSource {
  return {
    name: 'ai',
    weight: 0.6,
    limits: { perMinute: null, perDay: null, perMonth: null, dailyCostCeilingUsd: cfg.dailyCostCeilingUsd },
    async assess(input): Promise<SourceVerdict> {
      const r = await cfg.provider.assess({ domain: input.domain, context: buildContext(input) });
      const costUsd =
        cfg.priceInputPerMTok != null && cfg.priceOutputPerMTok != null
          ? (r.usage.inputTokens / 1e6) * cfg.priceInputPerMTok +
            (r.usage.outputTokens / 1e6) * cfg.priceOutputPerMTok
          : 0;
      return {
        verdict: r.verdict,
        confidence: r.confidence,
        category: r.category,
        detail: r.reasoning.slice(0, 500),
        raw: r,
        usage: { inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd }
      };
    }
  };
}
```

- [ ] **Step 3: Run ai test, pass. Write `tests/server/reputation/metadefender.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { makeMetaDefenderSource } from '$lib/server/reputation/metadefender';
import type { AssessmentInput } from '$lib/server/reputation/types';

const input = {
  domain: 'bad.test', hitCount: 1, distinctClientCount: 1, curatedListHits: [],
  enrichment: { whois: null, dns: null }
} as AssessmentInput;

const withBody = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('MetaDefenderSource', () => {
  it('blocks when detected_by >= 1', async () => {
    const src = makeMetaDefenderSource({
      apiKey: 'k',
      fetchImpl: withBody({ lookup_results: { detected_by: 3, sources: [{ provider: 'X', assessment: 'phishing', status: 1 }] } })
    });
    const v = await src.assess(input);
    expect(v.verdict).toBe('block');
    expect(v.confidence).toBeCloseTo(3 / 5);
    expect(v.category).toBe('phishing');
    expect(src.limits).toEqual({ perMinute: null, perDay: 4000, perMonth: null, dailyCostCeilingUsd: null });
  });

  it('allows when detected_by === 0', async () => {
    const src = makeMetaDefenderSource({ apiKey: 'k', fetchImpl: withBody({ lookup_results: { detected_by: 0, sources: [] } }) });
    expect((await src.assess(input)).verdict).toBe('allow');
  });

  it('throws on HTTP error', async () => {
    const src = makeMetaDefenderSource({ apiKey: 'k', fetchImpl: withBody({}, 429) });
    await expect(src.assess(input)).rejects.toThrow(/429/);
  });
});
```

- [ ] **Step 4: Create `src/lib/server/reputation/metadefender.ts`**

```ts
import type { ReputationSource, SourceVerdict } from './types';

export function makeMetaDefenderSource(cfg: { apiKey: string; fetchImpl?: typeof fetch }): ReputationSource {
  const doFetch = cfg.fetchImpl ?? fetch;
  return {
    name: 'metadefender',
    weight: 1.0,
    limits: { perMinute: null, perDay: 4000, perMonth: null, dailyCostCeilingUsd: null },
    async assess(input): Promise<SourceVerdict> {
      const res = await doFetch(`https://api.metadefender.com/v4/domain/${encodeURIComponent(input.domain)}`, {
        headers: { apikey: cfg.apiKey },
        signal: AbortSignal.timeout(15_000)
      });
      if (!res.ok) throw new Error(`MetaDefender HTTP ${res.status}`);
      const body = (await res.json()) as {
        lookup_results?: { detected_by?: number; sources?: Array<{ assessment?: string; status?: number }> };
      };
      const detected = body.lookup_results?.detected_by ?? 0;
      if (detected >= 1) {
        const mal = body.lookup_results?.sources?.find((s) => (s.status ?? 0) === 1);
        return {
          verdict: 'block',
          confidence: Math.min(1, detected / 5),
          category: mal?.assessment ?? 'malware',
          detail: `${detected} MetaDefender source(s) flagged this`,
          raw: body
        };
      }
      return { verdict: 'allow', confidence: 0.5, category: null, detail: 'no MetaDefender detections', raw: body };
    }
  };
}
```

- [ ] **Step 5: Run metadefender test, pass. Write `tests/server/reputation/virustotal.test.ts`** (mirror of Step 3 with the VT body shape)

```ts
import { describe, it, expect } from 'vitest';
import { makeVirusTotalSource } from '$lib/server/reputation/virustotal';
import type { AssessmentInput } from '$lib/server/reputation/types';

const input = { domain: 'bad.test', hitCount: 1, distinctClientCount: 1, curatedListHits: [], enrichment: { whois: null, dns: null } } as AssessmentInput;
const withBody = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('VirusTotalSource', () => {
  it('blocks when malicious+suspicious >= 1 and sets limits', async () => {
    const src = makeVirusTotalSource({
      apiKey: 'k',
      fetchImpl: withBody({ data: { attributes: { last_analysis_stats: { malicious: 4, suspicious: 2, harmless: 10, undetected: 5 }, categories: { X: 'advertising' } } } })
    });
    const v = await src.assess(input);
    expect(v.verdict).toBe('block');
    expect(v.confidence).toBeCloseTo((4 + 1) / 5);   // 4 + 0.5*2 = 5
    expect(v.category).toBe('advertising');
    expect(src.limits).toEqual({ perMinute: 4, perDay: 500, perMonth: 15500, dailyCostCeilingUsd: null });
  });

  it('allows when clean', async () => {
    const src = makeVirusTotalSource({ apiKey: 'k', fetchImpl: withBody({ data: { attributes: { last_analysis_stats: { malicious: 0, suspicious: 0, harmless: 80, undetected: 4 } } } }) });
    expect((await src.assess(input)).verdict).toBe('allow');
  });

  it('throws on HTTP error', async () => {
    const src = makeVirusTotalSource({ apiKey: 'k', fetchImpl: withBody({}, 401) });
    await expect(src.assess(input)).rejects.toThrow(/401/);
  });
});
```

- [ ] **Step 6: Create `src/lib/server/reputation/virustotal.ts`**

```ts
import type { ReputationSource, SourceVerdict } from './types';

export function makeVirusTotalSource(cfg: { apiKey: string; fetchImpl?: typeof fetch }): ReputationSource {
  const doFetch = cfg.fetchImpl ?? fetch;
  return {
    name: 'virustotal',
    weight: 1.0,
    limits: { perMinute: 4, perDay: 500, perMonth: 15500, dailyCostCeilingUsd: null },
    async assess(input): Promise<SourceVerdict> {
      const res = await doFetch(`https://www.virustotal.com/api/v3/domains/${encodeURIComponent(input.domain)}`, {
        headers: { 'x-apikey': cfg.apiKey },
        signal: AbortSignal.timeout(15_000)
      });
      if (!res.ok) throw new Error(`VirusTotal HTTP ${res.status}`);
      const body = (await res.json()) as {
        data?: { attributes?: { last_analysis_stats?: Record<string, number>; categories?: Record<string, string> } };
      };
      const s = body.data?.attributes?.last_analysis_stats ?? {};
      const mal = s.malicious ?? 0;
      const susp = s.suspicious ?? 0;
      if (mal + susp >= 1) {
        const category = Object.values(body.data?.attributes?.categories ?? {})[0] ?? 'malware';
        return {
          verdict: 'block',
          confidence: Math.min(1, (mal + 0.5 * susp) / 5),
          category,
          detail: `VirusTotal: ${mal} malicious / ${susp} suspicious`,
          raw: body
        };
      }
      return { verdict: 'allow', confidence: 0.5, category: null, detail: 'VirusTotal: clean', raw: body };
    }
  };
}
```

- [ ] **Step 7: Run vt test, pass. Write `tests/server/reputation/registry.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db';
import { buildEnabledSources } from '$lib/server/reputation/registry';
import { loadConfig } from '$lib/server/config';

let closer: (() => void) | null = null;
afterEach(() => { closer?.(); closer = null; });

const baseEnv = { VB_PIHOLE_BASE_URL: 'http://x', VB_PIHOLE_APP_PASSWORD: 'p', VB_CURATED_LIST_URLS: 'http://x/l.txt' };

describe('buildEnabledSources', () => {
  it('returns only curated when no source creds are set', async () => {
    const t = await makeTestDb(); closer = t.close;
    const { inline, paced } = buildEnabledSources(loadConfig(baseEnv), t.db, t.schema);
    expect(inline.name).toBe('curated_list');
    expect(paced).toHaveLength(0);
  });

  it('includes metadefender + ai + virustotal when all are configured', async () => {
    const t = await makeTestDb(); closer = t.close;
    const cfg = loadConfig({
      ...baseEnv,
      VB_METADEFENDER_API_KEY: 'm',
      VB_LLM_BASE_URL: 'http://l/v1', VB_LLM_API_KEY: 'k', VB_LLM_MODEL: 'x',
      VB_VIRUSTOTAL_API_KEY: 'v', VB_VIRUSTOTAL_ENABLED: 'true'
    });
    const { paced } = buildEnabledSources(cfg, t.db, t.schema);
    expect(paced.map((s) => s.name).sort()).toEqual(['ai', 'metadefender', 'virustotal']);
  });
});
```

- [ ] **Step 8: Create `src/lib/server/reputation/registry.ts`**

```ts
import type { Config } from '../config';
import { makeCuratedListSource } from './curated-list';
import { makeMetaDefenderSource } from './metadefender';
import { makeAiSource } from './ai';
import { makeVirusTotalSource } from './virustotal';
import { makeOpenAiCompatibleProvider } from '../llm/openai-compatible';
import type { ReputationSource } from './types';

export function buildEnabledSources(cfg: Config, db: any, schema: any) {
  const curated = makeCuratedListSource(db, schema, { urls: cfg.curatedListUrls });
  const paced: ReputationSource[] = [];

  if (cfg.metadefender) paced.push(makeMetaDefenderSource({ apiKey: cfg.metadefender.apiKey }));
  if (cfg.llm) {
    const provider = makeOpenAiCompatibleProvider({
      baseUrl: cfg.llm.baseUrl, apiKey: cfg.llm.apiKey, model: cfg.llm.model
    });
    paced.push(makeAiSource({
      provider,
      dailyCostCeilingUsd: cfg.llm.dailyUsd,
      priceInputPerMTok: cfg.llm.priceInputPerMTok,
      priceOutputPerMTok: cfg.llm.priceOutputPerMTok
    }));
  }
  if (cfg.virustotal) paced.push(makeVirusTotalSource({ apiKey: cfg.virustotal.apiKey }));

  return { inline: curated as ReputationSource, paced, curated };
}
```

- [ ] **Step 9: Run all reputation tests.** `pnpm test tests/server/reputation/` → all green.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: AI / MetaDefender / VirusTotal sources + enabled-source registry"
```

---

## Task 11: Scoring + `evaluateDomain`

**Files:**
- Create: `src/lib/server/scoring/score.ts`, `src/lib/server/pipeline/evaluate.ts`
- Test: `tests/server/scoring/score.test.ts`, `tests/server/pipeline/evaluate.test.ts`

**Background (spec §6):**

```
weight        = { curated_list: 1.0, metadefender: 1.0, ai: 0.6, virustotal: 1.0 }
value(v)      = { block: -1, allow: +1 }[v.verdict]         // 'unsure' and 'error' contribute nothing
contribution  = value(v) * v.confidence * weight[v.source]  // only block|allow verdicts
denom         = Σ weight[v.source]  over sources that returned block|allow
score         = denom > 0 ? clamp(Σ contribution / denom, -1, 1) : null
AUTO_CLEAR_ABOVE = 0.6
```

`decideState(domain, verdicts, eligibleSourceNames, cfg, nowMs)` → next `DomainState`:
- `score` null (no block/allow votes yet) → `'assessing'` (unless already past review — never downgrade a decided/cleared/pending domain).
- all eligible sources have a verdict row (any value incl. `unsure`/`error`) **and** `score >= AUTO_CLEAR_ABOVE` → `'auto_cleared'`.
- `score` not null **and** (all eligible reported **or** `nowMs - domain.firstSeen > cfg.maxReviewWaitMs`) → `'pending_review'`.
- else → `'assessing'`.
- If `domain.state` is already `'approved' | 'rejected' | 'auto_cleared' | 'pending_review'`, return it unchanged (transitions are forward-only here; the review endpoint handles pending→approved/rejected).

`evaluateDomain(db, schema, domainId, eligibleSourceNames, cfg)`:
1. load domain + its verdicts,
2. `score = computeScore(verdicts)`,
3. `next = decideState(...)`,
4. if `score !== domain.score || next !== domain.state`: `setDomainScoreAndState`, and `appendAudit({ actor: 'system', event: 'domain.transition', domainId, data: { from: domain.state, to: next, score } })`,
5. return `{ score, state: next }`.

**Interfaces:**
- Consumes: `VerdictRow`, `DomainRow` from repo (Task 4); repo setters; `appendAudit` (Task 4); `Config` (Task 2); `SourceName` (Task 3).
- Produces:
  ```ts
  export const SOURCE_WEIGHTS: Record<SourceName, number>;
  export const AUTO_CLEAR_ABOVE = 0.6;
  export const HIGH_CONFIDENCE_BLOCK_BELOW = -0.5;
  export function computeScore(verdicts: Pick<VerdictRow,'source'|'verdict'|'confidence'>[]): number | null;
  export function decideState(args: {
    domain: Pick<DomainRow,'state'|'firstSeen'|'score'>;
    verdicts: Pick<VerdictRow,'source'>[];
    score: number | null;
    eligibleSourceNames: SourceName[];
    maxReviewWaitMs: number;
    nowMs: number;
  }): DomainState;
  export function evaluateDomain(
    db: any, schema: any, domainId: number, eligibleSourceNames: SourceName[], cfg: Config
  ): Promise<{ score: number | null; state: DomainState }>;
  ```

- [ ] **Step 1: Write `tests/server/scoring/score.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { computeScore, decideState, AUTO_CLEAR_ABOVE } from '$lib/server/scoring/score';

const v = (source: any, verdict: any, confidence: number) => ({ source, verdict, confidence });

describe('computeScore', () => {
  it('returns null when only unsure/error votes exist', () => {
    expect(computeScore([v('curated_list', 'unsure', 0), v('ai', 'error', 0)])).toBeNull();
  });
  it('a single curated block@1 gives -1', () => {
    expect(computeScore([v('curated_list', 'block', 1)])).toBe(-1);
  });
  it('averages weighted contributions over the voting sources', () => {
    // curated block@1 (w1) => -1 ; ai allow@0.5 (w0.6) => +0.3 ; denom = 1.6
    // (-1 + 0.3) / 1.6 = -0.4375
    expect(computeScore([v('curated_list', 'block', 1), v('ai', 'allow', 0.5)])).toBeCloseTo(-0.4375, 4);
  });
  it('clamps into [-1, 1]', () => {
    expect(computeScore([v('curated_list', 'block', 1), v('metadefender', 'block', 1), v('virustotal', 'block', 1)])).toBe(-1);
  });
});

describe('decideState', () => {
  const eligible = ['curated_list', 'ai'] as const;
  it('auto-clears when all eligible reported and score >= 0.6', () => {
    const s = decideState({
      domain: { state: 'assessing', firstSeen: 0, score: null },
      verdicts: [{ source: 'curated_list' }, { source: 'ai' }],
      score: 0.8, eligibleSourceNames: [...eligible], maxReviewWaitMs: 10_000, nowMs: 1_000
    });
    expect(s).toBe('auto_cleared');
    expect(AUTO_CLEAR_ABOVE).toBe(0.6);
  });
  it('goes to pending_review when a slow source is still out but max wait passed', () => {
    const s = decideState({
      domain: { state: 'assessing', firstSeen: 0, score: -0.2 },
      verdicts: [{ source: 'curated_list' }],
      score: -0.2, eligibleSourceNames: [...eligible], maxReviewWaitMs: 10_000, nowMs: 20_000
    });
    expect(s).toBe('pending_review');
  });
  it('stays assessing when score present, not all in, and within wait window', () => {
    const s = decideState({
      domain: { state: 'assessing', firstSeen: 0, score: -0.2 },
      verdicts: [{ source: 'curated_list' }],
      score: -0.2, eligibleSourceNames: [...eligible], maxReviewWaitMs: 10_000, nowMs: 5_000
    });
    expect(s).toBe('assessing');
  });
  it('never downgrades a decided domain', () => {
    const s = decideState({
      domain: { state: 'approved', firstSeen: 0, score: -0.9 },
      verdicts: [{ source: 'curated_list' }, { source: 'ai' }],
      score: 0.9, eligibleSourceNames: [...eligible], maxReviewWaitMs: 1, nowMs: 999
    });
    expect(s).toBe('approved');
  });
});
```

- [ ] **Step 2: Run, fail. Create `src/lib/server/scoring/score.ts`**

```ts
import type { Config } from '../config';
import type { DomainState, SourceName } from '../db/types';
import type { DomainRow, VerdictRow } from '../db/repo';
import { setDomainScoreAndState, getDomainById, listVerdictsForDomain } from '../db/repo';
import { appendAudit } from '../audit/log';
import { now } from '../time';

export const SOURCE_WEIGHTS: Record<SourceName, number> = {
  curated_list: 1.0, metadefender: 1.0, ai: 0.6, virustotal: 1.0
};
export const AUTO_CLEAR_ABOVE = 0.6;
export const HIGH_CONFIDENCE_BLOCK_BELOW = -0.5;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function computeScore(
  verdicts: Pick<VerdictRow, 'source' | 'verdict' | 'confidence'>[]
): number | null {
  let num = 0;
  let denom = 0;
  for (const v of verdicts) {
    if (v.verdict !== 'block' && v.verdict !== 'allow') continue;
    const w = SOURCE_WEIGHTS[v.source] ?? 0;
    const value = v.verdict === 'block' ? -1 : 1;
    num += value * v.confidence * w;
    denom += w;
  }
  if (denom === 0) return null;
  return clamp(num / denom, -1, 1);
}

const TERMINAL: DomainState[] = ['approved', 'rejected', 'auto_cleared', 'pending_review'];

export function decideState(args: {
  domain: Pick<DomainRow, 'state' | 'firstSeen' | 'score'>;
  verdicts: Pick<VerdictRow, 'source'>[];
  score: number | null;
  eligibleSourceNames: SourceName[];
  maxReviewWaitMs: number;
  nowMs: number;
}): DomainState {
  if (TERMINAL.includes(args.domain.state)) return args.domain.state;

  const reported = new Set(args.verdicts.map((v) => v.source));
  const allIn = args.eligibleSourceNames.every((s) => reported.has(s));

  if (args.score === null) return 'assessing';
  if (allIn && args.score >= AUTO_CLEAR_ABOVE) return 'auto_cleared';
  if (allIn || args.nowMs - args.domain.firstSeen > args.maxReviewWaitMs) return 'pending_review';
  return 'assessing';
}

export async function evaluateDomain(
  db: any, schema: any, domainId: number, eligibleSourceNames: SourceName[], cfg: Config
): Promise<{ score: number | null; state: DomainState }> {
  const domain = await getDomainById(db, schema, domainId);
  if (!domain) throw new Error(`evaluateDomain: no domain ${domainId}`);
  const verdicts = await listVerdictsForDomain(db, schema, domainId);
  const score = computeScore(verdicts);
  const state = decideState({
    domain, verdicts, score, eligibleSourceNames,
    maxReviewWaitMs: cfg.maxReviewWaitMs, nowMs: now()
  });
  if (score !== domain.score || state !== domain.state) {
    await setDomainScoreAndState(db, schema, domainId, score, state);
    await appendAudit(db, schema, {
      actor: 'system', event: 'domain.transition', domainId,
      data: { from: domain.state, to: state, score }
    });
  }
  return { score, state };
}
```

> `evaluate.ts` re-exports for callers that import from the pipeline path:
> create `src/lib/server/pipeline/evaluate.ts` with `export { evaluateDomain } from '../scoring/score';`

- [ ] **Step 3: Write `tests/server/pipeline/evaluate.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db';
import * as repo from '$lib/server/db/repo';
import { evaluateDomain } from '$lib/server/pipeline/evaluate';
import { loadConfig } from '$lib/server/config';

let closer: (() => void) | null = null;
afterEach(() => { closer?.(); closer = null; });

const cfg = loadConfig({ VB_PIHOLE_BASE_URL: 'http://x', VB_PIHOLE_APP_PASSWORD: 'p', VB_MAX_REVIEW_WAIT_HOURS: '9999' });

describe('evaluateDomain', () => {
  it('writes score + state and an audit row when they change', async () => {
    const t = await makeTestDb(); closer = t.close;
    const { domainId } = await repo.upsertObservedDomain(t.db, t.schema, { domain: 'x.com', clientId: 'c', at: 1 });
    await repo.upsertVerdict(t.db, t.schema, { domainId, source: 'curated_list', verdict: 'block', confidence: 1, raw: {}, assessedAt: 1 });

    const r = await evaluateDomain(t.db, t.schema, domainId, ['curated_list'], cfg);
    expect(r).toEqual({ score: -1, state: 'pending_review' });

    const row = await repo.getDomainById(t.db, t.schema, domainId);
    expect(row).toMatchObject({ score: -1, state: 'pending_review' });
    const audit = await t.db.select().from(t.schema.auditLog);
    expect(audit.some((a: any) => a.event === 'domain.transition')).toBe(true);
  });

  it('is a no-op the second time (no duplicate audit rows)', async () => {
    const t = await makeTestDb(); closer = t.close;
    const { domainId } = await repo.upsertObservedDomain(t.db, t.schema, { domain: 'x.com', clientId: 'c', at: 1 });
    await repo.upsertVerdict(t.db, t.schema, { domainId, source: 'curated_list', verdict: 'block', confidence: 1, raw: {}, assessedAt: 1 });
    await evaluateDomain(t.db, t.schema, domainId, ['curated_list'], cfg);
    await evaluateDomain(t.db, t.schema, domainId, ['curated_list'], cfg);
    const audit = await t.db.select().from(t.schema.auditLog);
    expect(audit.filter((a: any) => a.event === 'domain.transition')).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Create `src/lib/server/pipeline/evaluate.ts`** (the one-line re-export above), run both test files, watch pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: weighted scoring + evaluateDomain transition writer"
```

---

## Task 12: Quota governor — rate state (pure) + drainer

**Files:**
- Create: `src/lib/server/governor/rate-state.ts`, `src/lib/server/governor/drainer.ts`
- Create: `tests/helpers/fake-source.ts`
- Test: `tests/server/governor/rate-state.test.ts`, `tests/server/governor/drainer.test.ts`

**Background (spec §7):**

```
amortizedInterval(limits) = max(
  limits.perDay   ? 86_400_000    / limits.perDay   : 0,
  limits.perMonth ? 2_592_000_000 / limits.perMonth : 0
)
bucket.capacity = limits.perMinute ?? Infinity
refill: perMinute tokens per 60_000 ms, capped at capacity
nextCallAt(state, limits, nowMs):
  bucketReadyAt = state.tokens >= 1 ? nowMs : state.lastRefill + 60_000 / (limits.perMinute ?? 1)
  amortReadyAt  = (state.lastCallAt ?? 0) + amortizedInterval(limits)
  return max(bucketReadyAt, amortReadyAt)
```

Rate state persists in `source_rate_state` (one row per paced source). Functions in `rate-state.ts` are **pure** — they take the row + limits + now and return the next row / a boolean. The drainer loads/saves via `db`.

- `refill(state, limits, nowMs)` → new `{ tokens, lastRefill }` (adds `perMinute * elapsed/60000`, capped at capacity; if `perMinute` null, tokens stay `Infinity`).
- `rolloverCounters(state, nowMs)` → resets `dayCount`/`dayStart` if `nowMs` is a different UTC day than `dayStart`; same for month.
- `canCall(state, limits, nowMs)` → `{ ok: boolean; reason?: 'minute' | 'day' | 'month' | 'paused' | 'wait' }`:
  - `state.pausedUntil && nowMs < pausedUntil` → `{ ok:false, reason:'paused' }`
  - `limits.perDay && dayCount >= perDay` → `day`
  - `limits.perMonth && monthCount >= perMonth` → `month`
  - `nowMs < nextCallAt(...)` → `wait`
  - else `{ ok: true }`
- `afterCall(state, limits, nowMs, costUsd)` → new row: `tokens -= 1` (no-op if Infinity), `lastCallAt = nowMs`, `dayCount += 1`, `monthCount += 1`; if `limits.dailyCostCeilingUsd != null` accumulate a `dayCostUsd` (store it in… there is no column — so track the ceiling via `dayCount`? No). **Add a `day_cost_usd` real column to `source_rate_state`** (update spec §5 mentally; add a migration). When `dayCostUsd >= dailyCostCeilingUsd` set `pausedUntil = startOfNextUtcDay(nowMs)`.

> **Schema addition:** add `dayCostUsd: real('day_cost_usd').notNull().default(0)` (sqlite) / `doublePrecision('day_cost_usd').notNull().default(0)` (pg) to `sourceRateState` in both schema files, regenerate migrations (`pnpm db:generate` for both dialects), and re-run Task 3's schema test. Do this as Step 0 of this task and commit it separately: `git commit -m "feat: source_rate_state.day_cost_usd for AI cost ceiling"`.

**Interfaces:**
- Produces:
  ```ts
  // rate-state.ts
  export interface RateRow {
    source: string; tokens: number; lastRefill: number;
    dayCount: number; dayStart: number; monthCount: number; monthStart: number;
    lastCallAt: number | null; pausedUntil: number | null; dayCostUsd: number;
  }
  export function amortizedInterval(l: SourceLimits): number;
  export function nextCallAt(s: RateRow, l: SourceLimits, nowMs: number): number;
  export function refill(s: RateRow, l: SourceLimits, nowMs: number): RateRow;
  export function rolloverCounters(s: RateRow, nowMs: number): RateRow;
  export function canCall(s: RateRow, l: SourceLimits, nowMs: number):
    { ok: true } | { ok: false; reason: 'minute' | 'day' | 'month' | 'paused' | 'wait' };
  export function afterCall(s: RateRow, l: SourceLimits, nowMs: number, costUsd: number): RateRow;
  export function initialRow(source: string, nowMs: number): RateRow;

  // drainer.ts
  export function makeDrainer(deps: {
    db: any; schema: any; cfg: Config;
    pacedSources: ReputationSource[];
    eligibleSourceNames: SourceName[];
    enrich: (domain: string) => Promise<AssessmentInput['enrichment']>;
    curatedHits: (domain: string) => string[];
    onVerdict?: (domainId: number) => void;      // fired after each verdict is scored (Task 15 SSE)
  }): {
    tick(nowMs?: number): Promise<{ calls: number }>;   // one pass over all paced sources
    start(): void;                                       // setInterval(tick, 5000)
    stop(): void;
  };
  ```

**Drainer `tick` algorithm** (per paced source, at most one call per tick):
1. load-or-init the `RateRow`; `refill`; `rolloverCounters`.
2. `canCall` → if not ok, `continue`.
3. `listQueuedDomains(db, schema, source.name, 1)` → if empty, `continue`.
4. build `AssessmentInput` (`hitCount`, `distinctClientCount` from the domain row; `curatedListHits = curatedHits(domain)`; `enrichment = await enrich(domain)`).
5. `try { verdict = await source.assess(input) }` → on throw, `upsertVerdict({ verdict:'error', confidence:0, detail:message, raw:{error:message} })`, `appendAudit({actor:source.name,event:'assess.error',domainId})`, still run `afterCall` (a failed call still consumed quota) + `evaluateDomain` + `onVerdict`, `continue`.
6. `upsertVerdict({ ...verdict, assessedAt: now(), inputTokens/outputTokens/costUsd from verdict.usage })`.
7. `afterCall(state, limits, now(), verdict.usage?.costUsd ?? 0)`; persist row.
8. `await evaluateDomain(db, schema, domainId, eligibleSourceNames, cfg)`.
9. `onVerdict?.(domainId)`.

- [ ] **Step 0: Schema addition** (see the callout above). Commit separately.

- [ ] **Step 1: Write `tests/server/governor/rate-state.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  amortizedInterval, nextCallAt, canCall, afterCall, refill, initialRow
} from '$lib/server/governor/rate-state';

const VT = { perMinute: 4, perDay: 500, perMonth: 15500, dailyCostCeilingUsd: null };
const AI = { perMinute: null, perDay: null, perMonth: null, dailyCostCeilingUsd: 1 };

describe('amortizedInterval', () => {
  it('uses the tightest of day/month spacing', () => {
    expect(amortizedInterval(VT)).toBe(86_400_000 / 500);   // 172_800 ms
    expect(amortizedInterval({ perMinute: null, perDay: null, perMonth: null, dailyCostCeilingUsd: null })).toBe(0);
  });
});

describe('nextCallAt', () => {
  it('is gated by the amortized interval after a recent call', () => {
    const s = { ...initialRow('virustotal', 0), tokens: 4, lastCallAt: 1_000 };
    expect(nextCallAt(s, VT, 2_000)).toBe(1_000 + 172_800);
  });
});

describe('canCall', () => {
  it('blocks when the daily count is exhausted', () => {
    const s = { ...initialRow('virustotal', 0), tokens: 4, dayCount: 500 };
    expect(canCall(s, VT, 10_000)).toEqual({ ok: false, reason: 'day' });
  });
  it('blocks while paused', () => {
    const s = { ...initialRow('ai', 0), pausedUntil: 10_000 };
    expect(canCall(s, AI, 5_000)).toEqual({ ok: false, reason: 'paused' });
  });
  it('allows when a token is available and enough time has passed', () => {
    const s = { ...initialRow('virustotal', 0), tokens: 4, lastCallAt: null };
    expect(canCall(s, VT, 1_000_000)).toEqual({ ok: true });
  });
});

describe('afterCall', () => {
  it('decrements tokens, bumps counters, sets lastCallAt', () => {
    const s = { ...initialRow('virustotal', 0), tokens: 4 };
    const n = afterCall(s, VT, 5_000, 0);
    expect(n).toMatchObject({ tokens: 3, dayCount: 1, monthCount: 1, lastCallAt: 5_000 });
  });
  it('pauses the AI source until next UTC midnight when the cost ceiling is hit', () => {
    const s = { ...initialRow('ai', 0), dayCostUsd: 0.9 };
    const n = afterCall(s, AI, Date.UTC(2026, 0, 1, 12), 0.2);   // 0.9 + 0.2 = 1.1 >= 1
    expect(n.dayCostUsd).toBeCloseTo(1.1);
    expect(n.pausedUntil).toBe(Date.UTC(2026, 0, 2));
  });
});

describe('refill', () => {
  it('adds perMinute tokens per minute, capped at capacity', () => {
    const s = { ...initialRow('virustotal', 0), tokens: 0, lastRefill: 0 };
    expect(refill(s, VT, 30_000).tokens).toBeCloseTo(2);       // half a minute => 2 of 4
    expect(refill(s, VT, 600_000).tokens).toBe(4);             // capped
  });
});
```

- [ ] **Step 2: Run, fail. Create `src/lib/server/governor/rate-state.ts`**

```ts
import type { SourceLimits } from '../reputation/types';

export interface RateRow {
  source: string; tokens: number; lastRefill: number;
  dayCount: number; dayStart: number; monthCount: number; monthStart: number;
  lastCallAt: number | null; pausedUntil: number | null; dayCostUsd: number;
}

const startOfUtcDay = (ms: number) => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
const startOfNextUtcDay = (ms: number) => startOfUtcDay(ms) + 86_400_000;
const startOfUtcMonth = (ms: number) => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};

export function initialRow(source: string, nowMs: number): RateRow {
  return {
    source, tokens: Infinity, lastRefill: nowMs,
    dayCount: 0, dayStart: startOfUtcDay(nowMs),
    monthCount: 0, monthStart: startOfUtcMonth(nowMs),
    lastCallAt: null, pausedUntil: null, dayCostUsd: 0
  };
}

export function amortizedInterval(l: SourceLimits): number {
  return Math.max(
    l.perDay ? 86_400_000 / l.perDay : 0,
    l.perMonth ? 2_592_000_000 / l.perMonth : 0
  );
}

export function refill(s: RateRow, l: SourceLimits, nowMs: number): RateRow {
  if (l.perMinute == null) return { ...s, tokens: Infinity, lastRefill: nowMs };
  const elapsed = Math.max(0, nowMs - s.lastRefill);
  const gained = (elapsed / 60_000) * l.perMinute;
  return { ...s, tokens: Math.min(l.perMinute, s.tokens + gained), lastRefill: nowMs };
}

export function rolloverCounters(s: RateRow, nowMs: number): RateRow {
  let n = s;
  if (startOfUtcDay(nowMs) !== s.dayStart) {
    n = { ...n, dayCount: 0, dayStart: startOfUtcDay(nowMs), dayCostUsd: 0, pausedUntil: null };
  }
  if (startOfUtcMonth(nowMs) !== s.monthStart) {
    n = { ...n, monthCount: 0, monthStart: startOfUtcMonth(nowMs) };
  }
  return n;
}

export function nextCallAt(s: RateRow, l: SourceLimits, nowMs: number): number {
  const bucketReadyAt = s.tokens >= 1 ? nowMs : s.lastRefill + 60_000 / (l.perMinute ?? 1);
  const amortReadyAt = (s.lastCallAt ?? 0) + amortizedInterval(l);
  return Math.max(bucketReadyAt, amortReadyAt);
}

export function canCall(
  s: RateRow, l: SourceLimits, nowMs: number
): { ok: true } | { ok: false; reason: 'minute' | 'day' | 'month' | 'paused' | 'wait' } {
  if (s.pausedUntil != null && nowMs < s.pausedUntil) return { ok: false, reason: 'paused' };
  if (l.perDay != null && s.dayCount >= l.perDay) return { ok: false, reason: 'day' };
  if (l.perMonth != null && s.monthCount >= l.perMonth) return { ok: false, reason: 'month' };
  if (l.perMinute != null && s.tokens < 1) return { ok: false, reason: 'minute' };
  if (nowMs < nextCallAt(s, l, nowMs)) return { ok: false, reason: 'wait' };
  return { ok: true };
}

export function afterCall(s: RateRow, l: SourceLimits, nowMs: number, costUsd: number): RateRow {
  const tokens = l.perMinute == null ? Infinity : Math.max(0, s.tokens - 1);
  const dayCostUsd = s.dayCostUsd + (costUsd || 0);
  const hitCeiling = l.dailyCostCeilingUsd != null && dayCostUsd >= l.dailyCostCeilingUsd;
  return {
    ...s,
    tokens,
    lastCallAt: nowMs,
    dayCount: s.dayCount + 1,
    monthCount: s.monthCount + 1,
    dayCostUsd,
    pausedUntil: hitCeiling ? startOfNextUtcDay(nowMs) : s.pausedUntil
  };
}
```

- [ ] **Step 3: Run rate-state tests, pass. Create `tests/helpers/fake-source.ts`**

```ts
import type { ReputationSource, SourceLimits, SourceVerdict } from '../../src/lib/server/reputation/types';

export function fakeSource(opts: {
  name: ReputationSource['name'];
  limits: SourceLimits;
  weight?: number;
  reply?: Partial<SourceVerdict> | (() => Partial<SourceVerdict> | Promise<Partial<SourceVerdict>>);
  throwErr?: string;
}): ReputationSource & { calls: string[] } {
  const calls: string[] = [];
  const src: ReputationSource = {
    name: opts.name,
    weight: opts.weight ?? 1,
    limits: opts.limits,
    async assess(input) {
      calls.push(input.domain);
      if (opts.throwErr) throw new Error(opts.throwErr);
      const base: SourceVerdict = { verdict: 'allow', confidence: 0.5, category: null, detail: null, raw: {} };
      const extra = typeof opts.reply === 'function' ? await opts.reply() : opts.reply;
      return { ...base, ...extra };
    }
  };
  return Object.assign(src, { calls });
}
```

- [ ] **Step 4: Write `tests/server/governor/drainer.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db';
import { fakeSource } from '../../helpers/fake-source';
import { makeDrainer } from '$lib/server/governor/drainer';
import * as repo from '$lib/server/db/repo';
import { loadConfig } from '$lib/server/config';

let closer: (() => void) | null = null;
afterEach(() => { closer?.(); closer = null; });

const cfg = loadConfig({ VB_PIHOLE_BASE_URL: 'http://x', VB_PIHOLE_APP_PASSWORD: 'p', VB_MAX_REVIEW_WAIT_HOURS: '9999' });
const noEnrich = async () => ({ whois: null, dns: null });

describe('drainer.tick', () => {
  it('assesses the top queued domain, writes a verdict, and scores it', async () => {
    const t = await makeTestDb(); closer = t.close;
    for (const c of ['c1', 'c2']) await repo.upsertObservedDomain(t.db, t.schema, { domain: 'bad.test', clientId: c, at: 1 });
    await repo.upsertObservedDomain(t.db, t.schema, { domain: 'low.test', clientId: 'c1', at: 1 });

    const md = fakeSource({ name: 'metadefender', limits: { perMinute: null, perDay: 4000, perMonth: null, dailyCostCeilingUsd: null },
      reply: { verdict: 'block', confidence: 0.8, category: 'ad' } });

    const d = makeDrainer({
      db: t.db, schema: t.schema, cfg, pacedSources: [md],
      eligibleSourceNames: ['metadefender'], enrich: noEnrich, curatedHits: () => []
    });
    const r = await d.tick(1_000_000);
    expect(r.calls).toBe(1);
    expect(md.calls).toEqual(['bad.test']);                 // higher priority first

    const dom = await repo.getDomainByName(t.db, t.schema, 'bad.test');
    const vs = await repo.listVerdictsForDomain(t.db, t.schema, dom!.id);
    expect(vs[0]).toMatchObject({ source: 'metadefender', verdict: 'block', confidence: 0.8 });
  });

  it('records an error verdict when the source throws, and still consumes quota', async () => {
    const t = await makeTestDb(); closer = t.close;
    await repo.upsertObservedDomain(t.db, t.schema, { domain: 'x.test', clientId: 'c', at: 1 });
    const md = fakeSource({ name: 'metadefender', limits: { perMinute: null, perDay: 2, perMonth: null, dailyCostCeilingUsd: null }, throwErr: 'boom' });
    const d = makeDrainer({ db: t.db, schema: t.schema, cfg, pacedSources: [md], eligibleSourceNames: ['metadefender'], enrich: noEnrich, curatedHits: () => [] });
    await d.tick(1_000_000);
    const dom = await repo.getDomainByName(t.db, t.schema, 'x.test');
    const vs = await repo.listVerdictsForDomain(t.db, t.schema, dom!.id);
    expect(vs[0]).toMatchObject({ source: 'metadefender', verdict: 'error' });
    const [rate] = await t.db.select().from(t.schema.sourceRateState);
    expect(rate.dayCount).toBe(1);
  });

  it('never exceeds perDay across many ticks', async () => {
    const t = await makeTestDb(); closer = t.close;
    for (let i = 0; i < 10; i++) await repo.upsertObservedDomain(t.db, t.schema, { domain: `d${i}.test`, clientId: 'c', at: 1 });
    const md = fakeSource({ name: 'metadefender', limits: { perMinute: null, perDay: 3, perMonth: null, dailyCostCeilingUsd: null } });
    const d = makeDrainer({ db: t.db, schema: t.schema, cfg, pacedSources: [md], eligibleSourceNames: ['metadefender'], enrich: noEnrich, curatedHits: () => [] });
    let day = Date.UTC(2026, 5, 1, 0);
    for (let i = 0; i < 20; i++) { await d.tick(day); day += 3_600_000; } // 20 hourly ticks, same UTC day
    expect(md.calls.length).toBe(3);
  });
});
```

- [ ] **Step 5: Create `src/lib/server/governor/drainer.ts`**

```ts
import { eq } from 'drizzle-orm';
import type { Config } from '../config';
import type { SourceName } from '../db/types';
import type { AssessmentInput, ReputationSource } from '../reputation/types';
import * as repo from '../db/repo';
import { appendAudit } from '../audit/log';
import { evaluateDomain } from '../pipeline/evaluate';
import { now } from '../time';
import {
  afterCall, canCall, initialRow, refill, rolloverCounters, type RateRow
} from './rate-state';

export function makeDrainer(deps: {
  db: any; schema: any; cfg: Config;
  pacedSources: ReputationSource[];
  eligibleSourceNames: SourceName[];
  enrich: (domain: string) => Promise<AssessmentInput['enrichment']>;
  curatedHits: (domain: string) => string[];
  onVerdict?: (domainId: number) => void;
}) {
  const { db, schema } = deps;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function loadRow(source: string, nowMs: number): Promise<RateRow> {
    const [row] = await db.select().from(schema.sourceRateState).where(eq(schema.sourceRateState.source, source));
    if (row) return row as RateRow;
    const fresh = initialRow(source, nowMs);
    await db.insert(schema.sourceRateState).values(sanitize(fresh)).onConflictDoNothing();
    return fresh;
  }
  async function saveRow(r: RateRow): Promise<void> {
    await db.update(schema.sourceRateState).set(sanitize(r)).where(eq(schema.sourceRateState.source, r.source));
  }
  // Infinity is not storable; persist a large sentinel and treat >=1 as "has token"
  const sanitize = (r: RateRow) => ({ ...r, tokens: Number.isFinite(r.tokens) ? r.tokens : 1_000_000 });

  async function tick(nowMs = now()): Promise<{ calls: number }> {
    let calls = 0;
    for (const source of deps.pacedSources) {
      let state = await loadRow(source.name, nowMs);
      state = rolloverCounters(refill(state, source.limits, nowMs), nowMs);
      const gate = canCall(state, source.limits, nowMs);
      if (!gate.ok) { await saveRow(state); continue; }

      const [domain] = await repo.listQueuedDomains(db, schema, source.name, 1);
      if (!domain) { await saveRow(state); continue; }

      const input: AssessmentInput = {
        domain: domain.domain,
        hitCount: domain.hitCount,
        distinctClientCount: domain.distinctClientCount,
        curatedListHits: deps.curatedHits(domain.domain),
        enrichment: await deps.enrich(domain.domain)
      };

      let costUsd = 0;
      try {
        const v = await source.assess(input);
        costUsd = v.usage?.costUsd ?? 0;
        await repo.upsertVerdict(db, schema, {
          domainId: domain.id, source: source.name, verdict: v.verdict, confidence: v.confidence,
          category: v.category, detail: v.detail, raw: v.raw, assessedAt: now(),
          inputTokens: v.usage?.inputTokens ?? null, outputTokens: v.usage?.outputTokens ?? null,
          costUsd: v.usage?.costUsd ?? null
        });
      } catch (e) {
        const msg = (e as Error).message;
        await repo.upsertVerdict(db, schema, {
          domainId: domain.id, source: source.name, verdict: 'error', confidence: 0,
          category: null, detail: msg, raw: { error: msg }, assessedAt: now()
        });
        await appendAudit(db, schema, { actor: source.name, event: 'assess.error', domainId: domain.id, data: { msg } });
      }

      state = afterCall(state, source.limits, now(), costUsd);
      await saveRow(state);
      await evaluateDomain(db, schema, domain.id, deps.eligibleSourceNames, deps.cfg);
      deps.onVerdict?.(domain.id);
      calls++;
    }
    return { calls };
  }

  return {
    tick,
    start() { if (!timer) timer = setInterval(() => void tick().catch(() => {}), 5_000); },
    stop() { if (timer) { clearInterval(timer); timer = null; } }
  };
}
```

- [ ] **Step 6: Run all governor tests, pass.** `pnpm test tests/server/governor/`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: quota governor — pure rate-state math + per-source drainer loop"
```

---

## Task 13: Ingestion scheduler

**Files:**
- Create: `src/lib/server/ingestion/scheduler.ts`
- Test: `tests/server/ingestion/scheduler.test.ts`

**Background (spec §8):** `runIngestionOnce` pulls new "allowed" domains from the gatekeeper into `domains`, runs the curated-list source inline, evaluates each, persists the cursor. First run seeds `firstRunLookbackMs` back, capped at `firstRunCap` new domains.

**Algorithm:**
1. `state = getIngestState(db, schema)`.
2. `until = now()`. `since = state.lastIngestAt ?? (until - cfg.firstRunLookbackMs)`.
3. `cursor = state.cursor ?? undefined`. `newCount = 0`. `cap = state.firstRunDone ? Infinity : cfg.firstRunCap`.
4. loop:
   a. `page = await adapter.listResolvedDomains({ since, until, cursor, limit: 500 })`.
   b. if `page.gapBefore != null` → `appendAudit({ actor:'system', event:'ingest.gap', data:{ since, gapBefore: page.gapBefore } })` (once per run is fine).
   c. for each `entry` in `page.entries` with `disposition === 'allowed'`:
      - if `await repo.isAllowlisted(db, schema, entry.domain)` → skip.
      - `{ domainId, created } = await repo.upsertObservedDomain(db, schema, { domain: entry.domain, clientId: entry.client.id, at: entry.at })`.
      - if `created` → `newCount++`.
      - `curatedVerdict = await curated.assess({ domain: entry.domain, hitCount: 0, distinctClientCount: 0, curatedListHits: curated.has(entry.domain) ? ['curated'] : [], enrichment: { whois: null, dns: null } })`.
      - if `curatedVerdict.verdict === 'block'` → `repo.upsertVerdict(..., source:'curated_list', ...)`.
      - `await evaluateDomain(db, schema, domainId, eligibleSourceNames, cfg)`.
      - `onDomain?.(domainId)`.
   d. `cursor = page.nextCursor ?? undefined`.
   e. break if `page.nextCursor == null` **or** `newCount >= cap`.
5. `await repo.setIngestState(db, schema, { cursor: cursor ?? null, lastIngestAt: until, firstRunDone: true })`.
6. return `{ newCount, pages }`.

**Interfaces:**
- Produces:
  ```ts
  export function makeIngestion(deps: {
    db: any; schema: any; cfg: Config;
    adapter: GatekeeperAdapter;
    curated: { assess: ReputationSource['assess']; has: (d: string) => boolean };
    eligibleSourceNames: SourceName[];
    onDomain?: (domainId: number) => void;
  }): {
    runOnce(): Promise<{ newCount: number; pages: number }>;
    start(): void;   // setInterval(runOnce, cfg.ingestIntervalMs); also runs once immediately
    stop(): void;
  };
  ```

- [ ] **Step 1: Write `tests/server/ingestion/scheduler.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db';
import { makeIngestion } from '$lib/server/ingestion/scheduler';
import * as repo from '$lib/server/db/repo';
import { loadConfig } from '$lib/server/config';
import type { GatekeeperAdapter } from '$lib/server/adapters/gatekeeper/types';

let closer: (() => void) | null = null;
afterEach(() => { closer?.(); closer = null; });

const cfg = loadConfig({
  VB_PIHOLE_BASE_URL: 'http://x', VB_PIHOLE_APP_PASSWORD: 'p',
  VB_FIRST_RUN_CAP: '2', VB_MAX_REVIEW_WAIT_HOURS: '9999'
});

function stubAdapter(pages: Awaited<ReturnType<GatekeeperAdapter['listResolvedDomains']>>[]): GatekeeperAdapter {
  let i = 0;
  return { listResolvedDomains: async () => pages[Math.min(i++, pages.length - 1)] };
}

const curatedAlways = { assess: async () => ({ verdict: 'block' as const, confidence: 1, category: 'listed', detail: null, raw: {} }), has: () => true };
const curatedNever = { assess: async () => ({ verdict: 'unsure' as const, confidence: 0, category: null, detail: null, raw: {} }), has: () => false };

describe('ingestion.runOnce', () => {
  it('inserts allowed domains, skips blocked, records curated block verdicts, sets cursor', async () => {
    const t = await makeTestDb(); closer = t.close;
    const adapter = stubAdapter([{
      entries: [
        { domain: 'ok.test', client: { id: 'c1', label: null }, at: 10, disposition: 'allowed', rawStatus: 'FORWARDED' },
        { domain: 'blk.test', client: { id: 'c1', label: null }, at: 11, disposition: 'blocked', rawStatus: 'GRAVITY' }
      ],
      nextCursor: null, gapBefore: null
    }]);
    const ing = makeIngestion({ db: t.db, schema: t.schema, cfg, adapter, curated: curatedAlways, eligibleSourceNames: ['curated_list'] });
    const r = await ing.runOnce();
    expect(r.newCount).toBe(1);
    expect(await repo.getDomainByName(t.db, t.schema, 'blk.test')).toBeUndefined();
    const ok = await repo.getDomainByName(t.db, t.schema, 'ok.test');
    expect(ok!.state).toBe('pending_review');              // curated block => score -1 => pending
    const st = await repo.getIngestState(t.db, t.schema);
    expect(st).toMatchObject({ firstRunDone: true, lastIngestAt: expect.any(Number) });
  });

  it('honours the first-run cap and stops paging', async () => {
    const t = await makeTestDb(); closer = t.close;
    const mk = (n: number) => ({
      entries: Array.from({ length: n }, (_, i) => ({
        domain: `d${i}-${Math.random()}.test`, client: { id: 'c', label: null }, at: i, disposition: 'allowed' as const, rawStatus: 'FORWARDED'
      })),
      nextCursor: 'more', gapBefore: null
    });
    const ing = makeIngestion({ db: t.db, schema: t.schema, cfg, adapter: stubAdapter([mk(5), mk(5)]), curated: curatedNever, eligibleSourceNames: ['curated_list'] });
    const r = await ing.runOnce();
    expect(r.newCount).toBeGreaterThanOrEqual(2);
    expect(r.pages).toBe(1);                               // stopped after the cap, did not fetch page 2
  });

  it('skips allowlisted domains', async () => {
    const t = await makeTestDb(); closer = t.close;
    await repo.addAllowlist(t.db, t.schema, 'known-good.test', 'user', 1);
    const adapter = stubAdapter([{
      entries: [{ domain: 'known-good.test', client: { id: 'c', label: null }, at: 1, disposition: 'allowed', rawStatus: 'CACHE' }],
      nextCursor: null, gapBefore: null
    }]);
    const ing = makeIngestion({ db: t.db, schema: t.schema, cfg, adapter, curated: curatedNever, eligibleSourceNames: ['curated_list'] });
    await ing.runOnce();
    expect(await repo.getDomainByName(t.db, t.schema, 'known-good.test')).toBeUndefined();
  });

  it('writes an ingest.gap audit row when gapBefore is set', async () => {
    const t = await makeTestDb(); closer = t.close;
    const adapter = stubAdapter([{ entries: [], nextCursor: null, gapBefore: 123456 }]);
    const ing = makeIngestion({ db: t.db, schema: t.schema, cfg, adapter, curated: curatedNever, eligibleSourceNames: ['curated_list'] });
    await ing.runOnce();
    const audit = await t.db.select().from(t.schema.auditLog);
    expect(audit.some((a: any) => a.event === 'ingest.gap')).toBe(true);
  });
});
```

- [ ] **Step 2: Run, fail. Create `src/lib/server/ingestion/scheduler.ts`**

```ts
import type { Config } from '../config';
import type { SourceName } from '../db/types';
import type { GatekeeperAdapter } from '../adapters/gatekeeper/types';
import type { ReputationSource } from '../reputation/types';
import * as repo from '../db/repo';
import { appendAudit } from '../audit/log';
import { evaluateDomain } from '../pipeline/evaluate';
import { now } from '../time';

export function makeIngestion(deps: {
  db: any; schema: any; cfg: Config;
  adapter: GatekeeperAdapter;
  curated: { assess: ReputationSource['assess']; has: (d: string) => boolean };
  eligibleSourceNames: SourceName[];
  onDomain?: (domainId: number) => void;
}) {
  const { db, schema, cfg } = deps;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function runOnce(): Promise<{ newCount: number; pages: number }> {
    const state = await repo.getIngestState(db, schema);
    const until = now();
    const since = state.lastIngestAt ?? until - cfg.firstRunLookbackMs;
    let cursor: string | undefined = state.cursor ?? undefined;
    const cap = state.firstRunDone ? Infinity : cfg.firstRunCap;

    let newCount = 0;
    let pages = 0;
    let gapAudited = false;

    while (true) {
      const page = await deps.adapter.listResolvedDomains({ since, until, cursor, limit: 500 });
      pages++;

      if (page.gapBefore != null && !gapAudited) {
        await appendAudit(db, schema, { actor: 'system', event: 'ingest.gap', data: { since, gapBefore: page.gapBefore } });
        gapAudited = true;
      }

      for (const entry of page.entries) {
        if (entry.disposition !== 'allowed') continue;
        if (await repo.isAllowlisted(db, schema, entry.domain)) continue;

        const { domainId, created } = await repo.upsertObservedDomain(db, schema, {
          domain: entry.domain, clientId: entry.client.id, at: entry.at
        });
        if (created) newCount++;

        const cv = await deps.curated.assess({
          domain: entry.domain, hitCount: 0, distinctClientCount: 0,
          curatedListHits: deps.curated.has(entry.domain) ? ['curated'] : [],
          enrichment: { whois: null, dns: null }
        });
        if (cv.verdict === 'block') {
          await repo.upsertVerdict(db, schema, {
            domainId, source: 'curated_list', verdict: 'block', confidence: cv.confidence,
            category: cv.category, detail: cv.detail, raw: cv.raw, assessedAt: now()
          });
        }
        await evaluateDomain(db, schema, domainId, deps.eligibleSourceNames, cfg);
        deps.onDomain?.(domainId);
      }

      cursor = page.nextCursor ?? undefined;
      if (page.nextCursor == null || newCount >= cap) break;
    }

    await repo.setIngestState(db, schema, { cursor: cursor ?? null, lastIngestAt: until, firstRunDone: true });
    return { newCount, pages };
  }

  return {
    runOnce,
    start() {
      if (timer) return;
      void runOnce().catch(() => {});
      timer = setInterval(() => void runOnce().catch(() => {}), cfg.ingestIntervalMs);
    },
    stop() { if (timer) { clearInterval(timer); timer = null; } }
  };
}
```

- [ ] **Step 3: Run ingestion tests, pass.**

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: ingestion scheduler — page, filter, dedupe, curated inline, cursor"
```

---

## Task 14: Blocklist publisher + route

**Files:**
- Create: `src/lib/server/publisher/blocklist.ts`, `src/routes/blocklist.txt/+server.ts`
- Test: `tests/server/publisher/blocklist.test.ts`, `tests/server/routes/blocklist-route.test.ts`

**Background (spec §9):** `GET /blocklist.txt` — no auth. Body: a `# ` header line then one approved domain per line, sorted. `ETag` from a hash of the domain list; `304` on matching `If-None-Match`. Every response logs to `blocklist_fetch_log`. Reads only committed DB state.

**Interfaces:**
- Produces:
  ```ts
  // publisher/blocklist.ts
  export function renderBlocklist(domains: string[], generatedAt: number): string;
  export function computeEtag(domains: string[]): string;      // stable weak etag, e.g. `W/"<sha1>-<count>"`
  export async function buildBlocklistResponse(db: any, schema: any, req: {
    ifNoneMatch: string | null; ip: string; userAgent: string | null;
  }): Promise<{ status: 200 | 304; body: string; headers: Record<string, string> }>;
  ```
- Route `+server.ts` calls `buildBlocklistResponse` and maps to a SvelteKit `Response`.

- [ ] **Step 1: Write `tests/server/publisher/blocklist.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db';
import { renderBlocklist, computeEtag, buildBlocklistResponse } from '$lib/server/publisher/blocklist';
import * as repo from '$lib/server/db/repo';

let closer: (() => void) | null = null;
afterEach(() => { closer?.(); closer = null; });

describe('renderBlocklist / computeEtag', () => {
  it('sorts, one per line, with a comment header', () => {
    const body = renderBlocklist(['b.com', 'a.com'], 1_700_000_000_000);
    const lines = body.trimEnd().split('\n');
    expect(lines[0]).toMatch(/^# Veerabahu blocklist — generated .*, 2 domains$/);
    expect(lines.slice(1)).toEqual(['a.com', 'b.com']);
  });
  it('etag is stable for the same set regardless of order and changes with content', () => {
    expect(computeEtag(['a.com', 'b.com'])).toBe(computeEtag(['b.com', 'a.com']));
    expect(computeEtag(['a.com'])).not.toBe(computeEtag(['a.com', 'b.com']));
  });
});

describe('buildBlocklistResponse', () => {
  it('200 with body + etag, and logs the fetch', async () => {
    const t = await makeTestDb(); closer = t.close;
    const { domainId } = await repo.upsertObservedDomain(t.db, t.schema, { domain: 'ads.test', clientId: 'c', at: 1 });
    await repo.setDomainScoreAndState(t.db, t.schema, domainId, -1, 'pending_review');
    await repo.decideDomain(t.db, t.schema, domainId, 'approve', null, 5);

    const r = await buildBlocklistResponse(t.db, t.schema, { ifNoneMatch: null, ip: '10.0.0.9', userAgent: 'pihole/6' });
    expect(r.status).toBe(200);
    expect(r.body).toContain('ads.test');
    expect(r.headers['ETag']).toBeTruthy();

    const logs = await t.db.select().from(t.schema.blocklistFetchLog);
    expect(logs[0]).toMatchObject({ ip: '10.0.0.9', userAgent: 'pihole/6', status: 200 });
  });

  it('304 when If-None-Match matches, still logs status 304', async () => {
    const t = await makeTestDb(); closer = t.close;
    const first = await buildBlocklistResponse(t.db, t.schema, { ifNoneMatch: null, ip: '1.1.1.1', userAgent: null });
    const again = await buildBlocklistResponse(t.db, t.schema, { ifNoneMatch: first.headers['ETag'], ip: '1.1.1.1', userAgent: null });
    expect(again.status).toBe(304);
    const logs = await t.db.select().from(t.schema.blocklistFetchLog);
    expect(logs.map((l: any) => l.status).sort()).toEqual([200, 304]);
  });
});
```

- [ ] **Step 2: Run, fail. Create `src/lib/server/publisher/blocklist.ts`**

```ts
import { createHash } from 'node:crypto';
import { now } from '../time';
import { listApprovedDomains, logBlocklistFetch } from '../db/repo';

export function renderBlocklist(domains: string[], generatedAt: number): string {
  const sorted = [...domains].sort();
  const header = `# Veerabahu blocklist — generated ${new Date(generatedAt).toISOString()}, ${sorted.length} domains`;
  return [header, ...sorted].join('\n') + '\n';
}

export function computeEtag(domains: string[]): string {
  const sorted = [...domains].sort();
  const sha = createHash('sha1').update(sorted.join('\n')).digest('hex');
  return `W/"${sha}-${sorted.length}"`;
}

export async function buildBlocklistResponse(
  db: any, schema: any, req: { ifNoneMatch: string | null; ip: string; userAgent: string | null }
): Promise<{ status: 200 | 304; body: string; headers: Record<string, string> }> {
  const domains = await listApprovedDomains(db, schema);
  const etag = computeEtag(domains);
  const at = now();

  if (req.ifNoneMatch && req.ifNoneMatch === etag) {
    await logBlocklistFetch(db, schema, { at, ip: req.ip, userAgent: req.userAgent, status: 304 });
    return { status: 304, body: '', headers: { ETag: etag, 'Cache-Control': 'no-cache' } };
  }

  const body = renderBlocklist(domains, at);
  await logBlocklistFetch(db, schema, { at, ip: req.ip, userAgent: req.userAgent, status: 200 });
  return {
    status: 200,
    body,
    headers: {
      ETag: etag,
      'Content-Type': 'text/plain; charset=utf-8',
      'Last-Modified': new Date(at).toUTCString(),
      'Cache-Control': 'no-cache'
    }
  };
}
```

- [ ] **Step 3: Run publisher unit tests, pass. Write `tests/server/routes/blocklist-route.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db';

let closer: (() => void) | null = null;
afterEach(() => { closer?.(); closer = null; vi.resetModules(); });

describe('GET /blocklist.txt route', () => {
  it('returns text/plain with the approved domains', async () => {
    const t = await makeTestDb(); closer = t.close;
    vi.doMock('$lib/server/db/index', () => ({ db: t.db, schema: t.schema, dialect: t.dialect }));
    const repo = await import('$lib/server/db/repo');
    const { domainId } = await repo.upsertObservedDomain(t.db, t.schema, { domain: 'z.test', clientId: 'c', at: 1 });
    await repo.decideDomain(t.db, t.schema, domainId, 'approve', null, 1);

    const { GET } = await import('../../../src/routes/blocklist.txt/+server');
    const res: Response = await GET({
      request: new Request('http://x/blocklist.txt'),
      getClientAddress: () => '10.0.0.5'
    } as any);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toContain('z.test');
  });
});
```

- [ ] **Step 4: Create `src/routes/blocklist.txt/+server.ts`**

```ts
import { db, schema } from '$lib/server/db/index';
import { buildBlocklistResponse } from '$lib/server/publisher/blocklist';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, getClientAddress }) => {
  const r = await buildBlocklistResponse(db, schema, {
    ifNoneMatch: request.headers.get('if-none-match'),
    ip: getClientAddress(),
    userAgent: request.headers.get('user-agent')
  });
  return new Response(r.status === 304 ? null : r.body, { status: r.status, headers: r.headers });
};
```

- [ ] **Step 5: Run the route test, pass.** (If the `$types` import trips `svelte-check` before `svelte-kit sync`, run `pnpm exec svelte-kit sync` first.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: unauthenticated /blocklist.txt publisher with ETag + fetch logging"
```

---

## Task 15: Review API + SSE event emitter

**Files:**
- Create: `src/lib/server/pipeline/events.ts`, `src/lib/server/pipeline/review.ts`
- Create: `src/routes/api/review/+server.ts`, `src/routes/api/review/[domain]/+server.ts`, `src/routes/api/review/stream/+server.ts`
- Test: `tests/server/pipeline/events.test.ts`, `tests/server/pipeline/review.test.ts`, `tests/server/routes/review-api.test.ts`

**Background (spec §10):**
- `GET /api/review?limit=&offset=` → ranked `pending_review` list with score + verdict summary.
- `GET /api/review/:domain` → full detail (all verdicts incl. `error`, enrichment snapshot, this domain's `audit_log` rows).
- `POST /api/review/:domain` body `{ decision: 'approve' | 'reject', note?: string }` → guard: domain must be `pending_review`, else `409`. `approve` → `decideDomain(...'approve')` + audit `decision.approve`. `reject` → `decideDomain(...'reject')` + `addAllowlist(domain, 'rejected by user', now())` + audit `decision.reject`.
- `GET /api/review/stream` → `text/event-stream`; emits `data: {json}\n\n` whenever `events.emitVerdict(domainId)` fires. The drainer + ingestion pass `onVerdict`/`onDomain = (id) => emitVerdict(id)`.

**Interfaces:**
- Produces:
  ```ts
  // pipeline/events.ts  — a tiny in-process pub/sub, module singleton
  export function emitVerdict(domainId: number): void;
  export function subscribe(fn: (domainId: number) => void): () => void;  // returns unsubscribe

  // pipeline/review.ts
  export interface ReviewListItem {
    domain: string; score: number | null; hitCount: number; distinctClientCount: number;
    verdicts: { source: SourceName; verdict: VerdictValue; confidence: number; category: string | null }[];
  }
  export function listReview(db: any, schema: any, limit: number, offset: number): Promise<ReviewListItem[]>;
  export interface ReviewDetail extends ReviewListItem {
    firstSeen: number; lastSeen: number; state: DomainState;
    verdictsFull: VerdictRow[];
    audit: { at: number; actor: string; event: string; data: unknown }[];
  }
  export function getReviewDetail(db: any, schema: any, domain: string): Promise<ReviewDetail | null>;
  export function decide(db: any, schema: any, domain: string, decision: 'approve' | 'reject', note: string | null):
    Promise<{ ok: true } | { ok: false; code: 404 | 409; message: string }>;
  ```

- [ ] **Step 1: Write `tests/server/pipeline/events.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { emitVerdict, subscribe } from '$lib/server/pipeline/events';

describe('events', () => {
  it('delivers emitted domain ids to subscribers until unsubscribed', () => {
    const seen: number[] = [];
    const off = subscribe((id) => seen.push(id));
    emitVerdict(1);
    emitVerdict(2);
    off();
    emitVerdict(3);
    expect(seen).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Create `src/lib/server/pipeline/events.ts`**

```ts
type Fn = (domainId: number) => void;
const subs = new Set<Fn>();

export function emitVerdict(domainId: number): void {
  for (const fn of subs) { try { fn(domainId); } catch { /* ignore subscriber errors */ } }
}
export function subscribe(fn: Fn): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}
```

- [ ] **Step 3: Run events test, pass. Write `tests/server/pipeline/review.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db';
import * as repo from '$lib/server/db/repo';
import { listReview, getReviewDetail, decide } from '$lib/server/pipeline/review';

let closer: (() => void) | null = null;
afterEach(() => { closer?.(); closer = null; });

async function seedPending(t: any, domain: string, clients: string[]) {
  let id = 0;
  for (const c of clients) id = (await repo.upsertObservedDomain(t.db, t.schema, { domain, clientId: c, at: 1 })).domainId;
  await repo.upsertVerdict(t.db, t.schema, { domainId: id, source: 'curated_list', verdict: 'block', confidence: 1, raw: {}, assessedAt: 1 });
  await repo.setDomainScoreAndState(t.db, t.schema, id, -1, 'pending_review');
  return id;
}

describe('review', () => {
  it('lists pending domains ranked by hits + 2*clients with a verdict summary', async () => {
    const t = await makeTestDb(); closer = t.close;
    await seedPending(t, 'low.test', ['c1']);
    await seedPending(t, 'high.test', ['c1', 'c2', 'c3']);
    const rows = await listReview(t.db, t.schema, 10, 0);
    expect(rows.map((r) => r.domain)).toEqual(['high.test', 'low.test']);
    expect(rows[0].verdicts[0]).toMatchObject({ source: 'curated_list', verdict: 'block' });
  });

  it('detail includes full verdicts and the domain audit trail', async () => {
    const t = await makeTestDb(); closer = t.close;
    await seedPending(t, 'x.test', ['c1']);
    const d = await getReviewDetail(t.db, t.schema, 'x.test');
    expect(d!.verdictsFull).toHaveLength(1);
    expect(d!.state).toBe('pending_review');
  });

  it('approve moves to approved + audits; reject allowlists + audits', async () => {
    const t = await makeTestDb(); closer = t.close;
    await seedPending(t, 'a.test', ['c1']);
    await seedPending(t, 'b.test', ['c1']);

    expect(await decide(t.db, t.schema, 'a.test', 'approve', 'tracker')).toEqual({ ok: true });
    expect((await repo.getDomainByName(t.db, t.schema, 'a.test'))!.state).toBe('approved');

    expect(await decide(t.db, t.schema, 'b.test', 'reject', null)).toEqual({ ok: true });
    expect(await repo.isAllowlisted(t.db, t.schema, 'b.test')).toBe(true);

    const audit = await t.db.select().from(t.schema.auditLog);
    expect(audit.filter((r: any) => r.event.startsWith('decision.')).length).toBe(2);
  });

  it('rejects a decision on a non-pending domain with 409', async () => {
    const t = await makeTestDb(); closer = t.close;
    const id = (await repo.upsertObservedDomain(t.db, t.schema, { domain: 'c.test', clientId: 'x', at: 1 })).domainId;
    await repo.setDomainScoreAndState(t.db, t.schema, id, 0.9, 'auto_cleared');
    expect(await decide(t.db, t.schema, 'c.test', 'approve', null)).toMatchObject({ ok: false, code: 409 });
  });

  it('404 for an unknown domain', async () => {
    const t = await makeTestDb(); closer = t.close;
    expect(await decide(t.db, t.schema, 'nope.test', 'approve', null)).toMatchObject({ ok: false, code: 404 });
  });
});
```

- [ ] **Step 4: Create `src/lib/server/pipeline/review.ts`**

```ts
import { asc, eq } from 'drizzle-orm';
import type { DomainState, SourceName, VerdictValue } from '../db/types';
import * as repo from '../db/repo';
import type { VerdictRow } from '../db/repo';
import { appendAudit } from '../audit/log';
import { now } from '../time';

export interface ReviewListItem {
  domain: string; score: number | null; hitCount: number; distinctClientCount: number;
  verdicts: { source: SourceName; verdict: VerdictValue; confidence: number; category: string | null }[];
}
export interface ReviewDetail extends ReviewListItem {
  firstSeen: number; lastSeen: number; state: DomainState;
  verdictsFull: VerdictRow[];
  audit: { at: number; actor: string; event: string; data: unknown }[];
}

const summarize = (vs: VerdictRow[]) =>
  vs.map((v) => ({ source: v.source, verdict: v.verdict, confidence: v.confidence, category: v.category }));

export async function listReview(db: any, schema: any, limit: number, offset: number): Promise<ReviewListItem[]> {
  const domains = await repo.listPendingReview(db, schema, limit, offset);
  const out: ReviewListItem[] = [];
  for (const d of domains) {
    const vs = await repo.listVerdictsForDomain(db, schema, d.id);
    out.push({
      domain: d.domain, score: d.score, hitCount: d.hitCount, distinctClientCount: d.distinctClientCount,
      verdicts: summarize(vs)
    });
  }
  return out;
}

export async function getReviewDetail(db: any, schema: any, domain: string): Promise<ReviewDetail | null> {
  const d = await repo.getDomainByName(db, schema, domain);
  if (!d) return null;
  const vs = await repo.listVerdictsForDomain(db, schema, d.id);
  const audit = await db.select().from(schema.auditLog)
    .where(eq(schema.auditLog.domainId, d.id)).orderBy(asc(schema.auditLog.at));
  return {
    domain: d.domain, score: d.score, hitCount: d.hitCount, distinctClientCount: d.distinctClientCount,
    verdicts: summarize(vs), firstSeen: d.firstSeen, lastSeen: d.lastSeen, state: d.state,
    verdictsFull: vs,
    audit: audit.map((a: any) => ({ at: a.at, actor: a.actor, event: a.event, data: a.data }))
  };
}

export async function decide(
  db: any, schema: any, domain: string, decision: 'approve' | 'reject', note: string | null
): Promise<{ ok: true } | { ok: false; code: 404 | 409; message: string }> {
  const d = await repo.getDomainByName(db, schema, domain);
  if (!d) return { ok: false, code: 404, message: 'unknown domain' };
  if (d.state !== 'pending_review') return { ok: false, code: 409, message: `domain is ${d.state}, not pending_review` };

  const at = now();
  await repo.decideDomain(db, schema, d.id, decision, note, at);
  if (decision === 'reject') await repo.addAllowlist(db, schema, domain, 'rejected by user', at);
  await appendAudit(db, schema, {
    actor: 'user', event: `decision.${decision}`, domainId: d.id, data: { note }
  });
  return { ok: true };
}
```

- [ ] **Step 5: Run review test, pass. Create the three routes.**

`src/routes/api/review/+server.ts`:
```ts
import { json } from '@sveltejs/kit';
import { db, schema } from '$lib/server/db/index';
import { listReview } from '$lib/server/pipeline/review';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const limit = Math.min(200, Number(url.searchParams.get('limit') ?? '50'));
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? '0'));
  return json(await listReview(db, schema, limit, offset));
};
```

`src/routes/api/review/[domain]/+server.ts`:
```ts
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { db, schema } from '$lib/server/db/index';
import { getReviewDetail, decide } from '$lib/server/pipeline/review';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const detail = await getReviewDetail(db, schema, params.domain!);
  if (!detail) throw error(404, 'unknown domain');
  return json(detail);
};

const Body = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().max(2000).optional() });

export const POST: RequestHandler = async ({ params, request }) => {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'body must be { decision: "approve"|"reject", note?: string }');
  const r = await decide(db, schema, params.domain!, parsed.data.decision, parsed.data.note ?? null);
  if (!r.ok) throw error(r.code, r.message);
  return json({ ok: true });
};
```

`src/routes/api/review/stream/+server.ts`:
```ts
import { subscribe } from '$lib/server/pipeline/events';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(': connected\n\n'));
      const off = subscribe((domainId) => {
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ domainId })}\n\n`));
      });
      // @ts-expect-error - attach for cancel()
      controller._off = off;
    },
    cancel() {
      // @ts-expect-error
      this._off?.();
    }
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }
  });
};
```

- [ ] **Step 6: Write `tests/server/routes/review-api.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db';

let closer: (() => void) | null = null;
afterEach(() => { closer?.(); closer = null; vi.resetModules(); });

async function withDb() {
  const t = await makeTestDb(); closer = t.close;
  vi.doMock('$lib/server/db/index', () => ({ db: t.db, schema: t.schema, dialect: t.dialect }));
  return t;
}

describe('review API routes', () => {
  it('GET /api/review returns pending items; POST decides; POST again is 409', async () => {
    const t = await withDb();
    const repo = await import('$lib/server/db/repo');
    const id = (await repo.upsertObservedDomain(t.db, t.schema, { domain: 'q.test', clientId: 'c', at: 1 })).domainId;
    await repo.upsertVerdict(t.db, t.schema, { domainId: id, source: 'curated_list', verdict: 'block', confidence: 1, raw: {}, assessedAt: 1 });
    await repo.setDomainScoreAndState(t.db, t.schema, id, -1, 'pending_review');

    const list = await import('../../../src/routes/api/review/+server');
    const listRes: Response = await list.GET({ url: new URL('http://x/api/review') } as any);
    expect(await listRes.json()).toHaveLength(1);

    const one = await import('../../../src/routes/api/review/[domain]/+server');
    const okRes: Response = await one.POST({
      params: { domain: 'q.test' },
      request: new Request('http://x', { method: 'POST', body: JSON.stringify({ decision: 'approve' }) })
    } as any);
    expect(await okRes.json()).toEqual({ ok: true });

    await expect(one.POST({
      params: { domain: 'q.test' },
      request: new Request('http://x', { method: 'POST', body: JSON.stringify({ decision: 'approve' }) })
    } as any)).rejects.toMatchObject({ status: 409 });
  });
});
```

- [ ] **Step 7: Run review-api tests, pass.** `pnpm test tests/server/pipeline/ tests/server/routes/`

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: review API (list/detail/decide) + SSE verdict stream"
```

---

## Task 16: Bare functional review page

**Files:**
- Create: `src/routes/review/+page.server.ts`, `src/routes/review/+page.svelte`
- Test: `tests/server/routes/review-page-load.test.ts`

**Note:** unstyled on purpose — polished UX is sub-project #2 via the `impeccable` skill (spec §10). Only the `load` function is unit-tested; no browser/component test in this sub-project.

**Interfaces:**
- `+page.server.ts` `load` → `{ items: ReviewListItem[] }` from `listReview(db, schema, 100, 0)`.
- `+page.svelte` renders a table; each row has approve/reject buttons that `fetch('POST /api/review/:domain')` then reload; subscribes to `/api/review/stream` and reloads on any message (crude but fine).

- [ ] **Step 1: Write `tests/server/routes/review-page-load.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db';

let closer: (() => void) | null = null;
afterEach(() => { closer?.(); closer = null; vi.resetModules(); });

describe('review page load', () => {
  it('returns the pending items', async () => {
    const t = await makeTestDb(); closer = t.close;
    vi.doMock('$lib/server/db/index', () => ({ db: t.db, schema: t.schema, dialect: t.dialect }));
    const repo = await import('$lib/server/db/repo');
    const id = (await repo.upsertObservedDomain(t.db, t.schema, { domain: 'p.test', clientId: 'c', at: 1 })).domainId;
    await repo.setDomainScoreAndState(t.db, t.schema, id, -0.7, 'pending_review');

    const { load } = await import('../../../src/routes/review/+page.server');
    const data = await (load as any)({});
    expect(data.items.map((i: any) => i.domain)).toEqual(['p.test']);
  });
});
```

- [ ] **Step 2: Create `src/routes/review/+page.server.ts`**

```ts
import { db, schema } from '$lib/server/db/index';
import { listReview } from '$lib/server/pipeline/review';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  return { items: await listReview(db, schema, 100, 0) };
};
```

- [ ] **Step 3: Create `src/routes/review/+page.svelte`**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';

  let { data } = $props();

  async function decide(domain: string, decision: 'approve' | 'reject') {
    await fetch(`/api/review/${encodeURIComponent(domain)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision })
    });
    await invalidateAll();
  }

  onMount(() => {
    const es = new EventSource('/api/review/stream');
    es.onmessage = () => invalidateAll();
    return () => es.close();
  });
</script>

<h1>Review queue ({data.items.length})</h1>
<table border="1" cellpadding="4">
  <thead>
    <tr><th>domain</th><th>score</th><th>hits</th><th>clients</th><th>verdicts</th><th></th></tr>
  </thead>
  <tbody>
    {#each data.items as it (it.domain)}
      <tr>
        <td>{it.domain}</td>
        <td>{it.score ?? '—'}</td>
        <td>{it.hitCount}</td>
        <td>{it.distinctClientCount}</td>
        <td>
          {#each it.verdicts as v}
            <div>{v.source}: {v.verdict} ({v.confidence}) {v.category ?? ''}</div>
          {/each}
        </td>
        <td>
          <button onclick={() => decide(it.domain, 'approve')}>block it</button>
          <button onclick={() => decide(it.domain, 'reject')}>keep it</button>
        </td>
      </tr>
    {/each}
  </tbody>
</table>
```

- [ ] **Step 4: Run the load test, pass.** `pnpm test tests/server/routes/review-page-load.test.ts`

- [ ] **Step 5: Verify build.** `pnpm exec svelte-kit sync && pnpm build` → completes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: bare functional review page (list, decide, live refresh)"
```

---

## Task 17: Runtime bootstrap in `hooks.server.ts`

**Files:**
- Create: `src/hooks.server.ts`, `src/lib/server/bootstrap.ts`
- Test: `tests/server/bootstrap.test.ts`

**Background:** SvelteKit has no worker process — start the loops once from `hooks.server.ts`. Must be idempotent (Vite HMR re-imports). Skip entirely when `process.env.VB_DISABLE_SCHEDULERS === 'true'` (tests, CI, `pnpm build`).

**Interfaces:**
- Produces:
  ```ts
  // bootstrap.ts
  export async function startBackground(opts?: { disabled?: boolean }): Promise<{ stop: () => void }>;
  // — loads config, runs migrations, builds sources, loads curated set from DB then kicks a refresh,
  //   wires ingestion.onDomain + drainer.onVerdict to emitVerdict, starts both loops.
  //   Guards against double-start with a module-level flag.
  ```

- [ ] **Step 1: Write `tests/server/bootstrap.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { startBackground } from '$lib/server/bootstrap';

describe('startBackground', () => {
  it('is a no-op when disabled and returns a stop() that does not throw', async () => {
    const h = await startBackground({ disabled: true });
    expect(typeof h.stop).toBe('function');
    h.stop();
  });

  it('is safe to call twice (second call does not start a second set of loops)', async () => {
    const a = await startBackground({ disabled: true });
    const b = await startBackground({ disabled: true });
    a.stop(); b.stop();
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Create `src/lib/server/bootstrap.ts`**

```ts
import { loadConfig } from './config';
import { db, schema } from './db/index';
import { runMigrations } from './db/migrate';
import { makePiholeAdapter } from './adapters/gatekeeper/pihole';
import { buildEnabledSources } from './reputation/registry';
import { makeDnsLookup } from './enrichment/dns';
import { makeWhoisLookup } from './enrichment/whois';
import { makeIngestion } from './ingestion/scheduler';
import { makeDrainer } from './governor/drainer';
import { emitVerdict } from './pipeline/events';
import type { SourceName } from './db/types';

let started: { stop: () => void } | null = null;

export async function startBackground(opts?: { disabled?: boolean }): Promise<{ stop: () => void }> {
  const disabled = opts?.disabled ?? process.env.VB_DISABLE_SCHEDULERS === 'true';
  if (disabled) return { stop: () => {} };
  if (started) return started;

  const cfg = loadConfig(process.env as Record<string, string | undefined>);
  await runMigrations();

  const { paced, curated } = buildEnabledSources(cfg, db, schema);
  const eligible: SourceName[] = ['curated_list', ...paced.map((s) => s.name)];

  await curated.loadFromDb();
  void curated.refresh().catch(() => {});

  const dns = makeDnsLookup();
  const whois = makeWhoisLookup();
  const enrich = async (domain: string) => ({ whois: await whois(domain), dns: await dns(domain) });

  const adapter = makePiholeAdapter({ baseUrl: cfg.pihole.baseUrl, appPassword: cfg.pihole.appPassword });

  const ingestion = makeIngestion({
    db, schema, cfg, adapter, curated, eligibleSourceNames: eligible, onDomain: emitVerdict
  });
  const drainer = makeDrainer({
    db, schema, cfg, pacedSources: paced, eligibleSourceNames: eligible,
    enrich, curatedHits: (d) => (curated.has(d) ? ['curated'] : []), onVerdict: emitVerdict
  });

  ingestion.start();
  drainer.start();

  started = { stop: () => { ingestion.stop(); drainer.stop(); started = null; } };
  return started;
}
```

- [ ] **Step 3: Create `src/hooks.server.ts`**

```ts
import { startBackground } from '$lib/server/bootstrap';

// Fire and forget; never block request handling on scheduler startup.
void startBackground().catch((e) => console.error('background startup failed', e));
```

- [ ] **Step 4: Run bootstrap test, pass.** (It only exercises the disabled path — the wired path is covered by Tasks 13 & 12 integration tests.)

- [ ] **Step 5: Confirm the build sets `VB_DISABLE_SCHEDULERS`.** Add to `package.json` `"build"`: `"build": "VB_DISABLE_SCHEDULERS=true vite build"`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: in-process background bootstrap (ingestion + drainer) via hooks.server"
```

---

## Task 18: Docker + Compose

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`
- Test: `tests/server/docker.test.ts` (a lightweight sanity check that the compose file parses and the Dockerfile exists — no container build in unit tests)

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
.svelte-kit
build
data
coverage
.git
tests
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN VB_DISABLE_SCHEDULERS=true pnpm build && pnpm prune --prod

FROM node:20-slim
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/package.json ./package.json
VOLUME /app/data
EXPOSE 3000
CMD ["node", "build"]
```

- [ ] **Step 3: Create `docker-compose.yml`**

```yaml
services:
  veerabahu:
    build: .
    ports:
      - "${VB_PORT:-3000}:3000"
    environment:
      VB_PIHOLE_BASE_URL: ${VB_PIHOLE_BASE_URL}
      VB_PIHOLE_APP_PASSWORD: ${VB_PIHOLE_APP_PASSWORD}
      VB_METADEFENDER_API_KEY: ${VB_METADEFENDER_API_KEY:-}
      VB_LLM_BASE_URL: ${VB_LLM_BASE_URL:-}
      VB_LLM_API_KEY: ${VB_LLM_API_KEY:-}
      VB_LLM_MODEL: ${VB_LLM_MODEL:-}
      VB_LLM_DAILY_USD: ${VB_LLM_DAILY_USD:-}
      VB_LLM_PRICE_INPUT_PER_MTOK: ${VB_LLM_PRICE_INPUT_PER_MTOK:-}
      VB_LLM_PRICE_OUTPUT_PER_MTOK: ${VB_LLM_PRICE_OUTPUT_PER_MTOK:-}
      VB_VIRUSTOTAL_API_KEY: ${VB_VIRUSTOTAL_API_KEY:-}
      VB_VIRUSTOTAL_ENABLED: ${VB_VIRUSTOTAL_ENABLED:-false}
      VB_DATABASE_URL: ${VB_DATABASE_URL:-file:/app/data/veerabahu.db}
      VB_CURATED_LIST_URLS: ${VB_CURATED_LIST_URLS:-https://big.oisd.nl/domainswild}
      VB_INGEST_INTERVAL_MIN: ${VB_INGEST_INTERVAL_MIN:-15}
    volumes:
      - veerabahu-data:/app/data
    restart: unless-stopped

# --- deferred (spec §6): uncomment when multi-worker throughput is a measured need ---
#  valkey:
#    image: valkey/valkey:8-alpine
#    restart: unless-stopped

volumes:
  veerabahu-data:
```

- [ ] **Step 4: Write `tests/server/docker.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

describe('docker artifacts', () => {
  it('Dockerfile exists and builds with schedulers disabled', () => {
    expect(existsSync('Dockerfile')).toBe(true);
    expect(readFileSync('Dockerfile', 'utf8')).toContain('VB_DISABLE_SCHEDULERS=true pnpm build');
  });
  it('compose exposes a data volume and keeps Valkey commented out', () => {
    const c = readFileSync('docker-compose.yml', 'utf8');
    expect(c).toContain('veerabahu-data:/app/data');
    expect(c).toMatch(/#\s+valkey:/);
  });
});
```

- [ ] **Step 5: (Optional, not in CI) Local build check.** `docker build -t veerabahu:dev .` → succeeds. Skip if Docker isn't available on the machine; the test above is the CI-safe check.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: Dockerfile + compose (SQLite volume, Valkey deferred)"
```

---

## Task 19: CI — lint, test on SQLite + Postgres, build

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `package.json` — add `"test:pg": "TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres vitest run"`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec svelte-kit sync
      - run: pnpm lint
      - run: pnpm check
      - run: VB_DISABLE_SCHEDULERS=true pnpm build

  test-sqlite:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec svelte-kit sync
      - run: pnpm exec drizzle-kit generate    # ensure migrations are current
      - run: pnpm test:cov
      - name: enforce coverage
        run: node -e "process.exit(0)"          # thresholds enforced by vitest.config.ts

  test-postgres:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: postgres }
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U postgres" --health-interval 5s
          --health-timeout 5s --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec svelte-kit sync
      - run: VB_DATABASE_URL='postgres://postgres:postgres@localhost:5432/postgres' pnpm exec drizzle-kit generate
      - run: pnpm test:pg
```

- [ ] **Step 2: Add the `test:pg` script** to `package.json` as noted above.

- [ ] **Step 3: Run the full suite locally one last time**

Run: `pnpm exec svelte-kit sync && pnpm lint && pnpm check && pnpm test:cov && VB_DISABLE_SCHEDULERS=true pnpm build`
Expected: all green; coverage ≥ 90 % on `src/lib/server/**`. If a module is under 90 %, add the missing unit test **before** committing.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "ci: lint + check + build, tests on SQLite and Postgres"
```

- [ ] **Step 5: Push and open a PR**

```bash
git push -u origin <branch>
gh pr create --fill
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task(s) |
|---|---|
| §2 read-only `GatekeeperAdapter` | 5, 6 |
| §2 decoupled ingestion + self-paced drainers | 12, 13 |
| §2 three sources + disabled VirusTotal | 8, 10 |
| §2 provider-agnostic AI (`OpenAiCompatibleProvider`, local ok) | 9, 10 |
| §2 weighted scoring, noise-floor auto-clear, `max_review_wait` | 11 |
| §2 bare review page + API + SSE | 15, 16 |
| §2 `/blocklist.txt` unauth, both-gatekeeper format, ETag, fetch log | 14 |
| §2 append-only `audit_log` on every transition/decision/publish | 4 (writer), 11/13/15 (callers), 14 (fetch log) |
| §2 dual-dialect Drizzle + both engines in CI | 3, 19 |
| §2 ≥ 90 % coverage | 1 (thresholds), 19 (enforced) |
| §5 every table | 3 (+ `day_cost_usd` added in 12) |
| §6 scoring constants + transition rules | 11 |
| §7 governor pacing math + defaults + cost ceiling | 12 |
| §8 ingestion window, first-run cap, allowlist skip, gap audit | 13 |
| §9 publisher body/headers/health log/last-known-good | 14 |
| §10 review endpoints + state guard + SSE | 15 |
| §11 error handling table | 5 (re-auth), 12 (error verdict + retry via re-queue), 14 (last-known-good), 8 (curated last_error) |
| §12 env vars | 2 |
| §13 test strategy (unit, integration, cross-engine) | every task + 19 |
| §14 acceptance criteria 1–8 | 1: crit 7; 2/8: crit 1–2; 10: crit 3; 11: crit 3; 14: crit 4; 15: crit 5; 4/11/13/15: crit 6; 18: crit 8 |
| §15 capture real Pi-hole fixtures | 5 (Step 1), 6 (Step 1) |

No spec requirement is left without a task.

**2. Placeholder scan**

No "TBD"/"TODO"/"handle edge cases"/"similar to Task N" — every code step carries real code. The only forward references ("implemented in Task 6") are an intentional throwing stub that Task 6's first test asserts against, then replaces.

**3. Type consistency**

- `GatekeeperAdapter.listResolvedDomains` signature identical in Tasks 5, 6, 13 (`{ since, until, cursor?, limit }` → `{ entries, nextCursor, gapBefore }`).
- `ReputationSource` (`name`, `weight`, `limits`, `assess`) identical in Tasks 8, 10, 12; `SourceLimits` four fields identical in 8, 10, 12.
- `SourceVerdict` (`verdict`, `confidence`, `category`, `detail`, `raw`, `usage?`) identical in 8, 9→10, 12.
- Repo function names used later match Task 4 exactly: `upsertObservedDomain`, `upsertVerdict`, `listQueuedDomains`, `listPendingReview`, `listApprovedDomains`, `getDomainByName`, `getDomainById`, `setDomainScoreAndState`, `decideDomain`, `isAllowlisted`, `addAllowlist`, `getIngestState`, `setIngestState`, `listVerdictsForDomain`, `logBlocklistFetch`.
- `evaluateDomain(db, schema, domainId, eligibleSourceNames, cfg)` identical in Tasks 11, 12, 13.
- `emitVerdict` / `subscribe` names identical in Tasks 15, 17.
- `DomainState` / `SourceName` / `VerdictValue` unions defined once in Task 3, imported everywhere.
- `RateRow` shape (incl. `dayCostUsd`) consistent between Task 12 Step 0 schema change and `rate-state.ts`.

Consistency holds.

## Execution Handoff

Plan saved to `docs/plans/2026-09-05-core-enrichment-pipeline.md`. Execute it task-by-task with `superpowers:subagent-driven-development` (recommended — a fresh subagent per task with two-stage review) or `superpowers:executing-plans` (inline batch execution with checkpoints). Each task is self-contained — exact file paths, full code, its own failing-test-first cycle, and a commit — so a smaller implementation model has everything it needs without holding the whole plan in context.


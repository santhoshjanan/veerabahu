# Sub-project #1 — Core Enrichment Pipeline — Design Spec

_Status: draft for review · Date: 2026-09-05 · Traces to: [master-requirements.md](../master-requirements.md) §7 row #1_

---

## 1. Purpose

Deliver the vertical slice that proves the Veerabahu feedback loop end to end:

> read the domains Pi-hole is currently resolving → assess their reputation with three
> parallel sources → let a human approve/reject candidates → publish the approved set as
> an HTTP endpoint that Pi-hole subscribes to as an adlist.

Everything else in the product (rich dashboard, settings UI, AI cost observability,
telemetry) decorates this slice and is out of scope here.

## 2. Goals / Non-goals

**Goals**

- One read-only Pi-hole adapter behind a `GatekeeperAdapter` interface.
- Ingestion decoupled from assessment: a cheap 15-minute ingestion loop feeding a
  persistent queue drained by self-paced per-source workers that never exceed quota.
- Three reputation sources (`CuratedListSource`, `MetaDefenderSource`, `AiSource`) plus a
  built-but-disabled `VirusTotalSource`, all behind a `ReputationSource` interface.
- Provider-agnostic AI via a single `OpenAiCompatibleProvider` (base URL + key + model),
  usable with local runtimes at zero marginal cost.
- Weighted scoring with noise-floor auto-clear and a `max_review_wait` promotion rule.
- A bare, unstyled but functional review page + its backing API (list / detail / decide,
  with live verdict updates over SSE).
- `GET /blocklist.txt` — unauthenticated, both-gatekeeper-compatible plain domain list,
  conditional-fetch headers, fetch logging for consumption health.
- Append-only `audit_log` capturing every state transition, decision, and publish change.
- Drizzle schema portable across SQLite (default) and Postgres; test suite green on both.
- ≥ 90 % line coverage on the pipeline modules.

**Non-goals (this sub-project)**

- Any push/write to the gatekeeper API. The flow is pull-only.
- AdGuard Home adapter (interface is designed to accommodate it; implementation is later).
- Styled dashboard / polished review UX (sub-project #2, via the `impeccable` skill).
- Settings UI and moving config/secrets into the DB (sub-project #4).
- Auto-blocking without a human (deferred until human-in-loop is proven).
- Valkey, multi-process workers, BullMQ.
- Auth / multi-user. Decisions are attributed to the single actor `user`.

## 3. Architecture

### 3.1 Component map

| Component                 | Module (proposed)                                                               | Responsibility                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Gatekeeper adapter        | `src/lib/server/adapters/gatekeeper/{types,pihole}.ts`                          | `listResolvedDomains(...)`. Owns Pi-hole auth/session (re-auth on 401). Normalizes rows.                                          |
| Ingestion scheduler       | `src/lib/server/ingestion/{scheduler,normalize}.ts`                             | Every `VB_INGEST_INTERVAL_MIN`: page new rows via cursor, gap-detect, filter to `allowed`, dedupe, upsert `domains`, bump counts. |
| Reputation sources        | `src/lib/server/reputation/{types,curated-list,metadefender,ai,virustotal}.ts`  | Each implements `ReputationSource`.                                                                                               |
| LLM provider              | `src/lib/server/llm/{types,openai-compatible}.ts`                               | Chat-completions call; `json_schema` mode with prompt-JSON + Zod + 1 retry fallback.                                              |
| Quota governor / drainers | `src/lib/server/governor/{rate-state,drainer}.ts`                               | One loop per paced source; token bucket + amortized spacing; SQLite rate state; writes `verdicts`.                                |
| Scorer                    | `src/lib/server/scoring/score.ts`                                               | Combine `verdicts` → weighted score → `auto_cleared` / `pending_review`; apply `max_review_wait`.                                 |
| Enrichment                | `src/lib/server/enrichment/{whois,dns}.ts`                                      | Cheap WHOIS age/registrar + DNS records, cached; feeds `AiSource`.                                                                |
| Blocklist publisher       | `src/routes/blocklist.txt/+server.ts` + `src/lib/server/publisher/blocklist.ts` | Serve approved set; `ETag`/`Last-Modified`; log fetches; last-known-good.                                                         |
| Review API                | `src/routes/api/review/**`                                                      | List pending / domain detail / decide; SSE verdict stream.                                                                        |
| Review page               | `src/routes/review/+page.svelte`                                                | Bare functional list + detail + approve/reject. No styling.                                                                       |
| Audit writer              | `src/lib/server/audit/log.ts`                                                   | `appendAudit(event)` — called from every transition.                                                                              |
| DB                        | `src/lib/server/db/{schema,index}.ts` + `migrations/`                           | Drizzle; dialect chosen from `VB_DATABASE_URL`.                                                                                   |
| Runtime bootstrap         | `src/hooks.server.ts`                                                           | Start ingestion scheduler + drainer loops once, in-process (`adapter-node`, single process).                                      |

`ponytail: schedulers run in-process from hooks.server.ts. No separate worker entrypoint
until multi-process throughput is a measured need.`

### 3.2 Data flow

```
Pi-hole query log ─(every 15 min)→ ingestion
     │  filter disposition=allowed, dedupe, upsert domains (state=observed)
     ▼
assessment queue  (derived: domains where state ∈ {observed, assessing})
     │  each paced source-drainer pulls highest-priority domain when its rate allows
     ▼
verdicts (one row per (domain, source))
     │  scorer runs on every new verdict
     ├─ score ≥ AUTO_CLEAR_ABOVE ─────────────→ state=auto_cleared   (never shown)
     └─ ≥1 verdict, or waited > max_review_wait → state=pending_review
             │  human approve                     │ human reject
             ▼                                    ▼
        state=approved                       state=rejected + allowlist row
             │                                    (never re-queued)
             ▼
   publisher serves the approved set  ←─(HTTP GET, gatekeeper's own schedule)── Pi-hole
```

Late verdicts (a slow source finishing after a decision) are still written and, if they
strongly disagree with the decision, recorded via `audit_log` event `verdict.late_conflict`.

## 4. Interfaces (TypeScript)

```ts
// adapters/gatekeeper/types.ts
export interface GatekeeperAdapter {
  listResolvedDomains(opts: {
    since: number; // epoch ms, inclusive
    until: number; // epoch ms, exclusive
    cursor?: string; // opaque, adapter-specific; omit to start from `since`
    limit: number; // max rows this call
  }): Promise<{
    entries: ResolvedQuery[];
    nextCursor: string | null; // null ⇒ caught up to `until`
    gapBefore: number | null; // epoch ms of earliest data available when it is newer
    //   than requested `since` (a missed window); else null
  }>;
}

export interface ResolvedQuery {
  domain: string;
  client: { id: string; label: string | null };
  at: number; // epoch ms (normalized)
  disposition: 'allowed' | 'blocked' | 'other'; // from Pi-hole `status`
  rawStatus: string; // original status string, for audit
}

// reputation/types.ts
export interface ReputationSource {
  readonly name: 'curated_list' | 'metadefender' | 'ai' | 'virustotal';
  readonly weight: number; // MVP constant, see §6
  readonly limits: SourceLimits; // consumed by the governor
  assess(input: AssessmentInput): Promise<SourceVerdict>;
}

export interface SourceLimits {
  perMinute: number | null; // null ⇒ unlimited
  perDay: number | null;
  perMonth: number | null;
  dailyCostCeilingUsd: number | null; // AI only; null otherwise
}

export interface AssessmentInput {
  domain: string;
  hitCount: number;
  distinctClientCount: number;
  curatedListHits: string[]; // curated list names containing the domain
  enrichment: {
    whois: { ageDays: number | null; registrar: string | null } | null;
    dns: { a: string[]; cname: string[]; ns: string[] } | null;
  };
}

export interface SourceVerdict {
  verdict: 'block' | 'allow' | 'unsure';
  confidence: number; // 0..1
  category: string | null; // 'ad' | 'tracker' | 'malware' | ...
  detail: string | null; // human-readable one-liner
  raw: unknown; // provider payload, stored for audit
  usage?: { inputTokens: number; outputTokens: number; costUsd: number }; // AI only
}

// llm/types.ts
export interface LlmProvider {
  assess(req: {
    domain: string;
    context: string; // compact enrichment block
  }): Promise<{
    verdict: 'block' | 'allow' | 'unsure';
    category: string | null;
    confidence: number;
    reasoning: string;
    usage: { inputTokens: number; outputTokens: number };
  }>;
}
```

`CuratedListSource` implements `ReputationSource` with all `limits` null and is invoked
**inline during ingestion** (not through a drainer). It reports `block` with confidence
1.0 when the domain is present in any loaded list, otherwise `unsure` with confidence 0
(i.e. it abstains rather than voting `allow`).

## 5. Data model

Drizzle schema, lowest-common-denominator so one definition serves both engines:
timestamps are **epoch-ms integers**, enums are `text` + a `CHECK` constraint mirrored by
a TS union, booleans are `integer` 0/1, JSON is `text` on SQLite / `jsonb` on Postgres via
a dialect-aware column helper.

| Table                 | Columns (type — note)                                                                                                                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domains`             | `id` pk · `domain` text unique · `first_seen` int · `last_seen` int · `hit_count` int · `distinct_client_count` int · `state` text `CHECK in ('observed','assessing','pending_review','auto_cleared','approved','rejected')` · `score` real null · `decided_at` int null · `decision_note` text null                            |
| `verdicts`            | `id` pk · `domain_id` fk→domains · `source` text · `verdict` text `CHECK in ('block','allow','unsure','error')` · `confidence` real · `category` text null · `detail` text null · `raw` json · `assessed_at` int · `input_tokens` int null · `output_tokens` int null · `cost_usd` real null · **unique(`domain_id`,`source`)** |
| `source_rate_state`   | `source` text pk · `tokens` real · `last_refill` int · `day_count` int · `day_start` int · `month_count` int · `month_start` int · `last_call_at` int null · `paused_until` int null                                                                                                                                            |
| `allowlist`           | `domain` text pk · `reason` text · `added_at` int                                                                                                                                                                                                                                                                               |
| `domain_clients`      | `domain_id` fk→domains · `client_id` text · **primary key(`domain_id`,`client_id`)** — backs `distinct_client_count`                                                                                                                                                                                                            |
| `curated_domains`     | `domain` text · `source_list` text · **primary key(`domain`,`source_list`)** — raw store; the in-memory `Set<string>` is rebuilt from this on boot and on daily refresh                                                                                                                                                         |
| `curated_lists`       | `name` text pk · `url` text · `last_fetched` int null · `entry_count` int · `last_error` text null                                                                                                                                                                                                                              |
| `audit_log`           | `id` pk · `at` int · `actor` text (`'system'`\|`'user'`\|source name) · `domain_id` fk null · `event` text · `data` json                                                                                                                                                                                                        |
| `blocklist_fetch_log` | `id` pk · `at` int · `ip` text · `user_agent` text null · `status` int (200\|304)                                                                                                                                                                                                                                               |
| `ingest_state`        | `id` pk (single row) · `cursor` text null · `last_ingest_at` int null · `first_run_done` int 0/1                                                                                                                                                                                                                                |

The **assessment queue is derived**, not stored: `SELECT ... FROM domains WHERE state IN
('observed','assessing') ORDER BY (hit_count + 2*distinct_client_count) DESC, first_seen ASC`.
A domain is `assessing` once it has ≥ 1 verdict but not yet all eligible sources.

## 6. Scoring (constants for MVP; move to Settings in #4)

```
weight        = { curated_list: 1.0, metadefender: 1.0, ai: 0.6, virustotal: 1.0 }
value(v)      = { block: -1, allow: +1 }[v.verdict]                 // 'unsure'/'error' contribute nothing
contribution  = value(v) * v.confidence * weight[v.source]         // only for block|allow verdicts
denom         = Σ weight[v.source]   over sources that returned block|allow
score         = denom > 0 ? clamp(Σ contribution / denom, -1, 1) : null   // an abstaining source does not dilute

AUTO_CLEAR_ABOVE            = 0.6    // score ≥ 0.6 ⇒ state = auto_cleared
HIGH_CONFIDENCE_BLOCK_BELOW = -0.5  // display band only; reviewer still decides
max_review_wait            = VB_MAX_REVIEW_WAIT_HOURS (default 6h)
```

Transition rules, evaluated after each verdict write:

- All eligible sources reported **and** `score ≥ AUTO_CLEAR_ABOVE` → `auto_cleared`.
- Otherwise, if `score` is not null (≥ 1 vote) **and** (`domain.first_seen` older than
  `max_review_wait` **or** all eligible sources reported) → `pending_review`.
- Else remain `assessing`.

"Eligible sources" = sources enabled by config, minus any whose `limits` make them
unreachable this run (governor `paused_until` in the future).

## 7. Quota governor

Per paced source (`metadefender`, `ai`, `virustotal` — `curated_list` is inline):

```
amortizedInterval = max(
  perDay   ? 86_400_000       / perDay   : 0,
  perMonth ? 2_592_000_000    / perMonth : 0
)                                            // ms between calls to stay under the cap
bucket.capacity   = perMinute ?? Infinity
bucket refills perMinute tokens per 60_000 ms, capped at capacity
nextCallAt = max(
  bucket.hasToken(now) ? now : bucket.nextRefillAt,
  (last_call_at ?? 0) + amortizedInterval
)
```

- A drainer loop wakes on a short tick (e.g. 5 s), and if `now ≥ nextCallAt` and the
  queue is non-empty, takes one token, assesses the top domain, writes the verdict, sets
  `last_call_at`, and updates `day_count` / `month_count` (rolling `day_start` /
  `month_start` at UTC boundaries).
- **AI cost ceiling:** after each call, add `cost_usd` to the day total; when it reaches
  `dailyCostCeilingUsd`, set `paused_until` = next UTC midnight.
- Rate state is persisted every call so a restart cannot burst.

Default limits:

| source       | perMinute | perDay | perMonth | dailyCostCeilingUsd                                                           |
| ------------ | --------- | ------ | -------- | ----------------------------------------------------------------------------- |
| curated_list | null      | null   | null     | null                                                                          |
| metadefender | null      | 4000   | null     | null                                                                          |
| ai           | null      | null   | null     | env `VB_LLM_DAILY_USD` (default null ⇒ unlimited; expected 0/blank for local) |
| virustotal   | 4         | 500    | 15500    | null                                                                          |

## 8. Ingestion

- Window: `since` = `ingest_state.cursor` time if present, else `now - VB_FIRST_RUN_LOOKBACK_HOURS`; `until` = `now`.
- Page through `listResolvedDomains` following `nextCursor` until `null` or, on the first
  run, until `VB_FIRST_RUN_CAP` new domains have been enqueued (remainder picked up next tick).
- For each `entry` with `disposition === 'allowed'`:
  - if `domain` in `allowlist` → skip.
  - upsert `domains`: insert with `state='observed'` or bump `hit_count`, refresh
    `last_seen`; insert the `(domain_id, client_id)` pair into `domain_clients` and set
    `distinct_client_count` to that pair count.
  - run `CuratedListSource` inline; if it votes `block`, write that verdict immediately.
- Persist `cursor` + `last_ingest_at`. If `gapBefore` is not null, append `audit_log`
  event `ingest.gap` with the missing span and continue.

## 9. Blocklist publisher

- Route `GET {VB_BLOCKLIST_PATH}` (default `/blocklist.txt`), no auth.
- Body: `# Veerabahu blocklist — generated <ISO ts>, <N> domains\n` then one domain per
  line, sorted, for `domains` where `state = 'approved'`.
- `ETag` = hash of the domain set + count; respond `304` to matching
  `If-None-Match`. Also set `Last-Modified` from the newest `decided_at`.
- Every response appends `blocklist_fetch_log` (`ip` from `x-forwarded-for` first hop or
  socket, `user_agent`, `status`). Dashboard later reads "last pulled" from this.
- The route reads only committed DB state; it cannot 5xx the gatekeeper on pipeline
  errors — worst case it serves an older set.

## 10. Review API + page

| Method + path              | Behaviour                                                                                                                                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/review`          | `pending_review` domains, ranked as in §5, with current `score`, `verdicts` summary, counts. Query: `?limit`, `?cursor`.                                                                                                                  |
| `GET /api/review/:domain`  | Full detail: all `verdicts` (incl. `error`), enrichment, `audit_log` history for the domain.                                                                                                                                              |
| `POST /api/review/:domain` | Body `{ decision: 'approve' \| 'reject', note?: string }`. `approve` → `state='approved'`, `decided_at`, `decision_note`. `reject` → `state='rejected'` + `allowlist` row. Writes `audit_log`. Rejects if domain not in `pending_review`. |
| `GET /api/review/stream`   | SSE; emits `{ domain, score, verdict }` on each new verdict write so an open review screen updates live.                                                                                                                                  |

`src/routes/review/+page.svelte`: unstyled table (domain, score, category, hits,
clients), row expands to detail, two buttons. No design work — that is sub-project #2 via
the `impeccable` skill.

## 11. Error handling

| Failure                               | Handling                                                                                                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pi-hole 5xx / network                 | Exponential backoff (e.g. 1s→30s, 4 tries). Persistent → skip this ingestion tick, `audit_log` `ingest.error`, dashboard flag. Next tick's `gapBefore` recovers the window.                                |
| Pi-hole 401 mid-run                   | One transparent re-auth (`POST /auth`), then retry the call once.                                                                                                                                          |
| Source call throws / times out        | Write `verdicts` row `verdict='error'` with the message in `detail`; retried on the next drain pass up to 3× (backoff), then the `error` row stays and the domain proceeds to review on the other sources. |
| LLM returns non-JSON / schema-invalid | One retry with a stricter "return only JSON" prompt; then `verdict='error'`.                                                                                                                               |
| Curated list download fails           | Keep the previous in-memory set; record `curated_lists.last_error`; retry next daily refresh.                                                                                                              |
| DB busy (SQLite)                      | WAL mode + a single writer (all writes go through one process); short retry on `SQLITE_BUSY`.                                                                                                              |
| Publisher DB read fails               | Serve the last successfully rendered body from an in-memory cache; `audit_log` `publish.error`.                                                                                                            |

## 12. Configuration (env, MVP only — moves to DB in #4)

| Var                                                   | Default                    | Purpose                                 |
| ----------------------------------------------------- | -------------------------- | --------------------------------------- |
| `VB_PIHOLE_BASE_URL`                                  | — (required)               | e.g. `http://pi.hole/api`               |
| `VB_PIHOLE_APP_PASSWORD`                              | — (required)               | Pi-hole app password                    |
| `VB_METADEFENDER_API_KEY`                             | —                          | absent ⇒ `metadefender` source disabled |
| `VB_LLM_BASE_URL` / `VB_LLM_API_KEY` / `VB_LLM_MODEL` | —                          | absent ⇒ `ai` source disabled           |
| `VB_LLM_DAILY_USD`                                    | unset (unlimited)          | AI daily cost ceiling                   |
| `VB_VIRUSTOTAL_API_KEY`                               | —                          | stored but source stays off unless…     |
| `VB_VIRUSTOTAL_ENABLED`                               | `false`                    | …explicitly `true`                      |
| `VB_DATABASE_URL`                                     | `file:./data/veerabahu.db` | `postgres://…` selects the PG dialect   |
| `VB_INGEST_INTERVAL_MIN`                              | `15`                       | ingestion tick                          |
| `VB_FIRST_RUN_LOOKBACK_HOURS`                         | `24`                       | first-run seed window                   |
| `VB_FIRST_RUN_CAP`                                    | `5000`                     | max domains enqueued on first run       |
| `VB_MAX_REVIEW_WAIT_HOURS`                            | `6`                        | promote-to-review safety valve          |
| `VB_BLOCKLIST_PATH`                                   | `/blocklist.txt`           | publisher route                         |
| `VB_PORT`                                             | `3000`                     | HTTP port                               |

A source with missing credentials is simply absent from "eligible sources"; the pipeline
runs with whatever is configured (curated lists always work with no credentials).

## 13. Testing strategy (target ≥ 90 % lines on pipeline modules)

**Unit (Vitest)**

- `pihole.ts` normalization: real captured Pi-hole `GET /queries` JSON fixtures →
  `ResolvedQuery[]`; status→disposition mapping table; cursor + `gapBefore` computation.
- `scoring/score.ts`: table-driven cases covering auto-clear, pending, tie, single vote,
  all-error, `max_review_wait` promotion.
- `governor`: pacing math (`amortizedInterval`, bucket refill, `nextCallAt`), UTC
  day/month rollover, cost-ceiling pause. Time is injected (no real clock).
- `openai-compatible.ts`: `json_schema` happy path, non-JSON body → retry → success, and
  → `error`; usage/cost computation.
- `publisher/blocklist.ts`: body format, sorting, ETag stability, 304 path.

**Integration**

- End-to-end with a stub Pi-hole HTTP server (fixture responses) + fake sources:
  ingestion → queue → drain → score → `pending_review` → `POST approve` →
  domain present in `GET /blocklist.txt`; `reject` → domain in `allowlist`, never
  re-queued on the next ingestion tick.
- Governor honours limits: with `perDay=3` a fake source is called at most 3× across a
  simulated day.

**Cross-engine**

- The DB/repository suite runs twice in CI: SQLite (temp file) and Postgres (service
  container). Migrations applied from `migrations/` for both.

**Not in scope:** browser E2E of the review page (arrives with sub-project #2).

## 14. Acceptance criteria

1. With a reachable Pi-hole and no other credentials, the app ingests resolved domains,
   scores them via curated lists alone, and surfaces `pending_review` items.
2. Adding `VB_LLM_*` and/or `VB_METADEFENDER_API_KEY` brings those sources in with no
   code change; their verdicts appear and adjust the score live on the review page.
3. `VirusTotalSource` runs only when `VB_VIRUSTOTAL_ENABLED=true`, and when it does it
   makes ≤ 500 calls/day and ≤ 4 calls/minute under a sustained backlog (verified by the
   governor integration test).
4. Approving a domain makes it appear in the very next `GET /blocklist.txt` response
   (the body is rendered from committed DB state per request); the response carries
   `ETag` and returns `304` on an unchanged re-request.
5. Rejecting a domain adds it to `allowlist` and it is never enqueued again.
6. Every state transition, decision, and publish change has an `audit_log` row.
7. `pnpm test` passes with ≥ 90 % line coverage on `src/lib/server/**` pipeline modules,
   on both SQLite and Postgres in CI.
8. `docker compose up` starts the app with a SQLite volume and the schedulers running.

## 15. Open items carried forward

- **S-new:** capture real Pi-hole `GET /queries` and `POST /auth` responses from the
  user's instance as test fixtures (first implementation task).
- Curated list URL set and refresh cadence details (OISD / HaGeZi / AdGuard DNS /
  EasyList / EasyPrivacy / StevenBlack) — finalize exact URLs during implementation.
- Confirm Pi-hole applies nothing / needs nothing on our side for adlist consumption
  (it is purely the gatekeeper's pull) — expected trivially true.

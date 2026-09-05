# Veerabahu — Master Requirements

> **Purpose of this document:** the north star. Every sub-project spec, plan, and PR
> traces back to something here. If work isn't serving a line in this doc, we stop and
> ask why. Updated as understanding changes — see Changelog at the bottom.

_Last updated: 2026-09-05_

---

## 1. Problem

Pi-hole / AdGuard Home (the **gatekeeper**) block DNS requests against a static preset
blocklist (**Level 1**). Ad and tracker domains not on that list still get through.

**Veerabahu is Level 2:** a sidecar that sits next to the gatekeeper, pulls the domains
it is currently _allowing_, assesses their reputation (VirusTotal, AI analysis, etc.),
and **publishes a derived blocklist as an unauthenticated HTTP endpoint that the
gatekeeper subscribes to as one of its adlists / filter lists.** The flow is a **pull by
the gatekeeper, not a push from Veerabahu** — Veerabahu never writes to the gatekeeper's
API and needs no write credentials. A positive feedback loop that strengthens the
blocklist over time. Human-in-the-loop for every block in the MVP; auto-clear of
obviously-good domains is on so the review queue stays manageable.

## 2. Audience

Home users with some technical background who value privacy. Self-hosted, runs alongside
an existing Pi-hole / AdGuard Home install.

## 3. Topology

```
Internet ── Router (gateway) ── Pi-hole / AdGuard Home (Level 1 gatekeeper) ── Home devices
                                   │  read query log (API)   ▲
                                   ▼                         │ subscribe to blocklist URL
                                  Veerabahu (Level 2 sidecar) ┘
```

- **Level 1:** gatekeeper blocks against a preset list. Solved problem, not ours.
- **Level 2 (us):** read resolved domains via gatekeeper API → assess reputation →
  human review → publish our blocklist at an HTTP endpoint → gatekeeper pulls it as an
  adlist on its own refresh schedule.

## 4. Vision goals

1. Lean stack (see §6)
2. Rich dashboard
3. Audit trails
4. Observability for AI calls and cost
5. Detailed settings section
6. Onboarding wizard
7. > 90% test coverage
8. Continuous integration
9. Anonymized usage collection (consent-based)
10. Privacy and security first

## 5. Non-negotiables

- **Privacy/security first.** DNS query data is sensitive. No data leaves the box without
  explicit consent. Telemetry is opt-in and anonymized.
- **UX decisions are made by Impeccable** (the `impeccable` skill), not ad hoc.
- **Token frugality.** Delegate work to the smallest capable model (subagents on Haiku
  etc.) where practical.
- **> 90% test coverage** and **CI** are requirements, not aspirations.
- **Human in the loop** for blocklist changes until autonomy is explicitly earned.

## 6. Intended stack (not yet locked)

- SvelteKit 2 + Svelte 5 (Runes) + TypeScript
- Melt UI for components
- **Drizzle ORM** over **SQLite** for the MVP; **PostgreSQL** is a supported swap via
  Drizzle's dialect support. One LCD-portable schema (epoch-ms integer timestamps,
  `text`+check-constraint enums, 0/1 booleans, JSON-as-text on SQLite). CI runs the test
  suite against **both** engines. Drizzle is the DB seam — no repository pattern on top.
- **Valkey: deferred.** MVP uses a SQLite `jobs` table for the queue, SQLite rows for
  quota-governor counters, and in-process SSE for streaming verdicts to the HITL screen.
  Add Valkey only when multi-worker / cross-process pub-sub is a measured need. Docker
  Compose ships it commented-out.
- LangChain (or similar) for AI domain-reputation assessment

## 7. Architecture — sub-projects

Each gets its own spec → plan → build cycle. Order is a recommendation, not a contract.

| #     | Sub-project                        | Scope                                                                                                                                                                                                                                                                                                                                  | Status                                                                                                                                                                                                                                                        |
| ----- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **Core enrichment pipeline (MVP)** | Pi-hole read adapter → pull resolved domains → assess reputation via 3 parallel sources (local curated lists + MetaDefender + AI) → ranked candidate list → HITL review → **publish blocklist HTTP endpoint** for the gatekeeper to subscribe to. Includes DB schema, job runner, quota governor (§9), and consumption-health logging. | **Plan ready** → spec [`docs/specs/2026-09-05-core-enrichment-pipeline-design.md`](specs/2026-09-05-core-enrichment-pipeline-design.md) · plan [`docs/plans/2026-09-05-core-enrichment-pipeline.md`](plans/2026-09-05-core-enrichment-pipeline.md) (19 tasks) |
| 2     | Dashboard & audit-trail UI         | Read-only view over pipeline data.                                                                                                                                                                                                                                                                                                     | Backlog                                                                                                                                                                                                                                                       |
| 3     | AI observability & cost tracking   | Token/cost metrics and call traces for AI reputation calls.                                                                                                                                                                                                                                                                            | Backlog                                                                                                                                                                                                                                                       |
| 4     | Settings + onboarding wizard       | **First task: move config + secrets from env into the DB** (env demoted to bootstrap/override) — implies **encryption-at-rest for DB-stored secrets**. Then: connection/credential config (gatekeeper API + per-reputation-source API key/auth/endpoint), quota-governor limits, weights, first-run wizard.                            | Backlog                                                                                                                                                                                                                                                       |
| 5     | Consent-based anonymized telemetry | Opt-in usage collection.                                                                                                                                                                                                                                                                                                               | Backlog                                                                                                                                                                                                                                                       |
| —     | CI + test harness                  | Cross-cutting. Set up minimally alongside #1.                                                                                                                                                                                                                                                                                          | Backlog                                                                                                                                                                                                                                                       |

## 8. Open spikes / unknowns

- **S1 — RESOLVED (2026-09-05).** Both expose the query log. Pi-hole: `GET /queries`
  (`from`/`until`/`length`/`cursor` + server-side `status`/`domain`/`client` filters;
  monotonic `id` cursor). AdGuard: `GET /querylog` (`older_than`/`limit`/`offset` +
  `reason[]` filter; timestamp-only cursor, no stable row id). Both carry a per-entry
  disposition — Pi-hole `status` (FORWARDED/CACHE/… = allowed; GRAVITY/DENYLIST/REGEX/… =
  blocked), AdGuard `reason` (NotFiltered* = allowed; Filtered* = blocked).
- **S2 — RESOLVED (2026-09-05), but NOT USED.** We chose the **pull** model: Veerabahu
  publishes a blocklist URL, the gatekeeper subscribes to it. Kept for reference in case
  a push mode is ever added. Pi-hole write side: `POST/DELETE /domains/deny/exact`
  (+ regex), array + `comment`. AdGuard write side: `GET /filtering/status` →
  `user_rules[]`, mutate, `POST /filtering/set_rules` (whole array, `||domain^`). The
  "ownership tagging" problem this created is now moot — the published list is our
  namespace by construction.
- **S3 — RESOLVED (2026-09-05).** Drizzle ORM; SQLite for MVP, Postgres a supported
  swap; CI against both. Valkey deferred (see §6).

### Gatekeeper adapter interface (from S1)

`GatekeeperAdapter` — **read-only**, auth handled internally per adapter:

- `listResolvedDomains({since, until, cursor?, limit}) → {entries, nextCursor, gapBefore}`
  where each entry is `{domain, client:{id,label}, at (epoch ms), disposition:
'allowed'|'blocked'|'other', rawStatus}`

Design must handle: firehose filtering to `allowed` + dedupe; per-adapter opaque cursor
(AdGuard timestamp-tie risk); timestamp normalization; Pi-hole in-memory vs on-disk +
gap detection; Pi-hole session re-auth on 401.

### Blocklist publisher

- `GET /blocklist.txt` — **unauthenticated** (deliberate; optional URL token is a later
  add). Plain one-domain-per-line (consumed by both Pi-hole gravity and AdGuard
  filters). `# generated <ts>, N domains` header. `ETag` / `Last-Modified` for
  conditional fetches.
- Every fetch is logged (IP, User-Agent, timestamp) → dashboard shows "last pulled by
  gatekeeper" as a **consumption-health** signal (replaces write-side drift
  reconciliation).
- **Enforcement latency:** the gatekeeper refreshes on its own schedule (Pi-hole
  gravity often weekly, AdGuard often 24h). Onboarding must tell the user to set a tight
  refresh interval (~1h). Veerabahu cannot force a refresh.

## 9. Reputation sources & quota governor

Each source implements a common `ReputationSource` interface; the pipeline runs them
**in parallel** and streams each verdict into the HITL screen as it lands. Per-source
verdict shown independently + a combined **weighted** score that updates as sources
report.

| Source                                                                                                                                                 | Cost model                    | Default                                         | Weight       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | ----------------------------------------------- | ------------ |
| Local curated blocklists (OISD, HaGeZi, AdGuard DNS, EasyList/EasyPrivacy, StevenBlack) — downloaded, refreshed daily, checked by local set-membership | Free, instant                 | On                                              | High         |
| MetaDefender Cloud reputation API                                                                                                                      | ~4,000 lookups/day free       | On (needs key)                                  | High         |
| AI assessor (provider-agnostic — see below)                                                                                                            | Token cost (0 for local)      | On (needs endpoint)                             | Medium       |
| VirusTotal                                                                                                                                             | 4/min · 500/day · 15.5k/month | **Off** by default (built behind the interface) | High when on |

**Ingestion is decoupled from assessment.** The ingestion loop (every ~15 min) only
pulls new resolved domains from Pi-hole, dedupes against known domains, and enqueues
unseen ones into a persistent `assessment_queue` (SQLite), ranked by hit/client counts.
No external API calls in that loop.

**Quota governor = one continuous drainer per source, self-paced.** Every source declares
its limits (`perMinute`, `perDay`, `perMonth`, and for AI a `dailyCostCeiling`). Each
source's worker computes a sustainable spacing from its _most restrictive_ quota
(daily/monthly amortized to a per-request interval) and draws the next-highest-priority
queued domain only when `nextCallAt = max(tokenBucket.nextRefill, lastCall +
amortizedInterval)` has passed. Token bucket covers per-minute bursts; amortized spacing
covers the daily/monthly cap so a slow source (VirusTotal ≈ 1 lookup / 170s) can never
max out. Rate state is SQLite-backed (survives restart). Limits editable in Settings
(sub-project #4).

- Local curated-list check runs **inline at enqueue** (no pacing needed).
- A domain enters `pending_review` as soon as **any** source reports. If it has waited
  only on slow sources past `max_review_wait` (~6h), it is promoted with partial
  verdicts; a late verdict is still recorded for audit and flagged if it strongly
  disagrees with the decision already taken.
- Unique domains for one home network converge (a few thousand, then repeats), so the
  queue does not grow unbounded after the initial backfill drains.

`ponytail: single in-process scheduler loop round-robining sources against SQLite rate
state. Move to a real queue (BullMQ/Valkey) only if multi-worker throughput becomes a
measured need.`

### AI assessor — provider-agnostic (no lock-in, no LangChain)

Cost is the binding constraint for the target audience. `LlmProvider` interface
(`assess(input) → {verdict, category, confidence, reasoning}`); MVP ships **one**
implementation, `OpenAiCompatibleProvider`, configured by **base URL + API key + model**.
This covers OpenAI, OpenRouter, Groq, DeepSeek, Mistral, Together, Anthropic/Gemini
OpenAI-compat endpoints, **and local runtimes** (Ollama, LM Studio, llama.cpp, vLLM) —
local = zero marginal cost.

- Structured output: `response_format: json_schema` where supported; fallback is
  prompt-for-JSON → Zod parse → one retry (required — many local servers lack JSON mode).
- Input: domain + cheap enrichment we already hold (WHOIS age/registrar, DNS records,
  curated-list hits, hit/client counts). No page fetching in MVP. One domain per call,
  compact prompt (token frugality).
- Cost: Settings holds per-Mtoken input/output prices (pre-seeded for known providers,
  `0`/blank for local); spend computed from reported token usage; governor enforces
  `dailyCostCeiling`.
- A native Anthropic/Gemini adapter may be added later if the compat shim proves lossy;
  not in MVP.

## 10. Cross-cutting concerns (MVP)

**Audit trail.** Append-only `audit_log`. Enough to answer "what happened and what did I
do" — every domain state transition (trigger + timestamp + verdicts at the time), every
human decision, every change to the published blocklist. No more than that. Sub-project
#2 builds the viewer; #1 writes the rows.

**Config & secrets.** MVP bootstraps from env vars (`.env` / compose `environment:`) with
sane code defaults for everything non-secret. This is a **bootstrap, not a home** —
sub-project #4's first task is moving config **and secrets** into the DB, with env
demoted to override/bootstrap only. That pulls in an **encryption-at-rest requirement
for secrets stored in the DB** (record against #4). Until #4, secrets stay in env and
out of the DB.

## 11. Out of scope (for now)

- Multi-gatekeeper / multi-site management
- Non-home / enterprise deployment
- Fully autonomous blocklist changes (deferred until human-in-loop is proven)

## 12. Changelog

- **2026-09-05** — Initial draft. Decomposition into 5 sub-projects + CI agreed.
  Sub-project #1 selected for first brainstorm.
- **2026-09-05** — Spikes S1/S2 resolved (Pi-hole + AdGuard API paper spike).
  `GatekeeperAdapter` interface sketched. Reputation strategy set: 3 parallel sources
  (local curated lists + MetaDefender + AI), VirusTotal built but off by default.
  Added §9 quota governor. Per-source API/auth config assigned to Settings (#4).
- **2026-09-05** — **Architecture: pull, not push.** Veerabahu publishes an
  unauthenticated blocklist URL; the gatekeeper subscribes to it as an adlist. No
  gatekeeper write credentials. `GatekeeperAdapter` reduced to read-only
  (`listResolvedDomains`). Added Blocklist Publisher component + consumption-health
  logging. Domain lifecycle: observed → assessing → pending_review →
  approved/published | rejected/allowlisted | auto_cleared. Every block
  human-approved for MVP; auto-clear below noise floor is on.
- **2026-09-05** — S3 resolved: Drizzle + SQLite (MVP) / Postgres (option), CI both,
  Valkey deferred. AI assessor is provider-agnostic via one `OpenAiCompatibleProvider`
  (base URL + key + model), local runtimes supported, no LangChain.
- **2026-09-05** — Ingestion decoupled from assessment: 15-min ingestion loop feeds a
  persistent `assessment_queue`; one self-paced continuous drainer per source (amortized
  spacing from the tightest quota) so slow sources never max out. `max_review_wait`
  promotes a domain to review on partial verdicts. Packaging: single Docker image +
  compose, SQLite volume. First run seeds last 24h, capped ~5k domains.
- **2026-09-05** — Audit = minimal append-only `audit_log`. Config/secrets in env for
  MVP; #4's first task is moving them to the DB (implies encryption-at-rest). Sub-project
  #1 full design spec written and self-reviewed:
  `docs/specs/2026-09-05-core-enrichment-pipeline-design.md`.
- **2026-09-05** — Sub-project #1 implementation plan written and self-reviewed
  (`docs/plans/2026-09-05-core-enrichment-pipeline.md`): 19 TDD tasks, each with exact
  paths + full code + failing-test-first steps, sized for a smaller implementation model.
  Stack pinned: SvelteKit 2 + adapter-node, Drizzle (better-sqlite3 / postgres-js),
  Zod, Vitest, pnpm. Ready to execute.

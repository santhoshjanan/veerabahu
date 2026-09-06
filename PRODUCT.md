# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Privacy-minded home users with some technical background. They already run Pi-hole or
AdGuard Home on their home network and self-host Veerabahu alongside it (Docker on a
NAS, mini-PC, or Raspberry Pi). They reach the UI from a laptop or desktop on the home
LAN, usually in short check-in sessions: glance at what the pipeline found, clear the
review queue, occasionally investigate why a domain was blocked. Not a full-time
operator — an attentive owner.

## Product Purpose

Veerabahu is a "Level 2" sidecar for Pi-hole / AdGuard Home. The gatekeeper blocks DNS
against a static preset list (Level 1); ad and tracker domains not on that list still
resolve. Veerabahu reads the domains the gatekeeper is _allowing_, assesses each domain's
reputation through several sources (local curated blocklists, MetaDefender Cloud, a
provider-agnostic AI assessor, VirusTotal off by default), lets a human approve or reject
each proposed block, and publishes the resulting blocklist at an unauthenticated HTTP
endpoint that the gatekeeper subscribes to as an adlist. A positive feedback loop that
strengthens the blocklist over time. Success: the review queue stays small enough to
clear in a sitting, blocks are trustworthy because a human saw the evidence, and the
owner can always answer "what happened and what did I do".

## Positioning

Not a blocklist subscription and not a replacement DNS filter. Veerabahu is the feedback
loop _around_ an existing gatekeeper: it observes real resolved traffic on this specific
network, scores those specific domains, and derives a blocklist tailored to this
household — with a human in the loop for every block. It never writes to the gatekeeper's
API (pull, not push) and needs no write credentials.

## Operating Context

- Runs as a single Docker container next to Pi-hole / AdGuard Home; SQLite by default,
  Postgres a supported swap.
- Background pipeline runs on its own: a ~15-min ingestion loop pulls newly-resolved
  domains, a persistent queue feeds one self-paced drainer per reputation source
  (quota-governed so slow sources never exceed free-tier limits).
- Domain lifecycle: observed -> assessing -> pending_review ->
  approved/published | rejected/allowlisted | auto_cleared. Obvious-good domains
  auto-clear below a noise floor so the queue stays manageable.
- The gatekeeper refreshes its adlists on its own schedule; Veerabahu cannot force a
  refresh. Every fetch of the published blocklist is logged (IP, User-Agent, time) and
  surfaced as a "consumption health" signal.
- Append-only `audit_log` records every domain state transition (with the verdicts at
  the time), every human decision, and every change to the published blocklist.

## Capabilities and Constraints

- Stack is already scaffolded: SvelteKit 2 + Svelte 5 (Runes) + TypeScript,
  `adapter-node`, Drizzle ORM (better-sqlite3 / postgres-js), Zod, Vitest, pnpm.
  Melt UI is the intended component library and is introduced by this sub-project.
- Data available to the UI: `domains` (state, score, hit_count, first/last seen,
  decision note), `verdicts` (per-source verdict, confidence, category, detail, token
  counts, cost_usd), `audit_log`, `blocklist_fetch_log`, `curated_lists` (freshness,
  entry count, last error), `source_rate_state` (per-source quota/pacing), `allowlist`,
  `ingest_state`.
- Sub-project #2 scope: the Melt UI foundation plus four screens — dashboard overview,
  a rebuilt (polished) HITL review queue, a domain browser + detail view, and a global
  audit-log viewer. All read-only except the review queue's approve/reject.
- Live data: the review queue updates via in-process Server-Sent Events (verdicts land
  individually, weighted score patches in place); dashboard/domains/audit refresh via a
  background re-fetch every ~20s that diffs into the DOM (no full-page reload).
- No authentication in this sub-project — assumed reachable only on the trusted home
  LAN. Real auth and DB-stored encrypted secrets are sub-project #4.
- Terminology: **gatekeeper** (Pi-hole / AdGuard Home), **verdict** (one source's
  opinion on a domain), **score** (weighted combination), **review queue** /
  **HITL** (human-in-the-loop), **published blocklist**, **consumption health**,
  **auto-clear**, **allowlist**.
- Testing is a non-negotiable: >90% coverage measured on server + `lib` TypeScript
  (load functions, read APIs, the SSE stream, view-model/formatter helpers); Svelte
  components get a render smoke test each plus 2–3 Playwright end-to-end flows.
- Token frugality is a project rule: delegate work to the smallest capable model.

## Brand Commitments

- Name: **Veerabahu** (working nickname "Donut Hole v2"). No logo, wordmark, or existing
  visual identity yet — this sub-project establishes the first one.
- UX decisions are owned by the `impeccable` skill, per the project's CLAUDE.md.
- Privacy/security first is a stated, binding product value: DNS query data is sensitive
  and nothing leaves the box without explicit consent; telemetry (sub-project #5) is
  opt-in and anonymized.

## Evidence on Hand

- `docs/master-requirements.md` — the maintained north-star requirements doc.
- `docs/specs/2026-09-05-core-enrichment-pipeline-design.md` and
  `docs/plans/2026-09-05-core-enrichment-pipeline.md` — sub-project #1 spec and plan.
- Working sub-project #1 code under `src/lib/server/**` and a bare functional
  `/review` screen at `src/routes/review/`.
- No real production data, screenshots, users, testimonials, or metrics exist yet.
  Any sample domains/verdicts shown in design work are synthetic and must be labeled
  as such.

## Product Principles

- **Evidence before action.** Every block a human approves is shown with the verdicts,
  score, and traffic context that justify it. No decision without its reasons on screen.
- **The queue must stay clearable.** Auto-clear the obvious, rank by real impact
  (hits, distinct clients), and design the review flow for a short sitting, not a shift.
- **Always answerable: "what happened and what did I do".** The audit trail is a
  first-class surface, not a debug log.
- **Calm by default.** This runs unattended in a closet; the UI is a place you check in
  on, not a cockpit demanding attention. Live updates inform, they don't alarm.
- **Read-only is the norm.** One deliberate action (approve/reject a block) plus
  allowlist management; everything else is observation.

## Accessibility & Inclusion

No formal standard mandated by the user. Baseline: full keyboard operation of the
review flow, visible focus, WCAG AA contrast, respects `prefers-reduced-motion`,
and verdict/state never encoded by color alone (paired with text/icon).

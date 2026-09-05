# Sub-project #2 — Dashboard, Queue & Audit UI — Design Spec

_Status: draft for review · Date: 2026-09-05 · Traces to: [master-requirements.md](../master-requirements.md) §7 row #2, vision goals 2 / 3 / 5 · Branch: `feat/sub2-dashboard-ui`_

---

## 1. Purpose

Sub-project #1 shipped the working feedback loop behind a bare, unstyled `/review` table.
This sub-project builds the operator-facing surface over that pipeline: a coherent visual
world, a reusable component system, and six screens that let a privacy-minded home user
check in on the box, understand what it found and why, clear the review queue, and always
answer _"what happened and what did I do"_.

Everything here is **read-only except the review queue's approve/reject and the per-domain
allowlist toggle**. No new pipeline behaviour; the only change to sub-project #1 code is a
handful of event-publish calls (§5.2).

## 2. Goals / Non-goals

**Goals**

- A durable visual world — _The Disposition Log_ — recorded in DESIGN.md at finish (§9),
  with light + dark themes, WCAG AA contrast, `prefers-reduced-motion` support, and state
  never encoded by colour alone.
- A component kit (`src/lib/components/`) plus a token layer (`src/lib/design/`), built to
  be inherited by sub-projects #3–#5. Melt UI (`@melt-ui/svelte`) supplies the two
  primitives where hand-rolling accessible behaviour is genuinely error-prone — a modal
  **Dialog** (reused for the side **Sheet**) and a **Combobox** — and every other control
  (tables, pagination, disclosure, tabs, toasts) is native HTML styled into the world.
  This keeps the headless-library surface small and copy-paste-able for a smaller
  implementation model, and the kit stays open for #4 to widen.
- Six routes: `/` (dashboard), `/queue` (live pipeline status), `/review` (rebuilt HITL),
  `/domains` (browser), `/domains/[domain]` (detail as URL-addressable side sheet),
  `/audit` (master log).
- Live data: `/review` and `/queue` stream from an in-process SSE bus; `/`, `/domains`,
  `/audit` use background revalidation that diffs into the DOM. No full-page reload
  anywhere.
- All reads flow through `+page.server.ts` load functions (SSR-first). The only new HTTP
  surface is the SSE endpoint.
- Read models are pure, testable TypeScript modules mirroring `pipeline/review.ts`.
- ≥ 90 % line coverage measured on `src/lib/**` and `src/routes/**/*.ts` (TypeScript),
  `**/*.svelte` excluded from the threshold; Svelte components are covered by Playwright
  E2E flows, not unit-render tests (keeps the test toolchain to node Vitest + Playwright,
  no browser-mode Vitest for a smaller model to configure).
- CI stays green on both SQLite and Postgres.

**Non-goals (this sub-project)**

- Authentication / sessions / multi-user. The UI is assumed reachable only on the trusted
  home LAN. Real auth + encrypted DB secrets are sub-project #4.
- AI cost **charts and per-call traces** — sub-project #3. The dashboard shows today's
  aggregate spend only (one number).
- Consent / telemetry UI — sub-project #5.
- Any settings, configuration editing, weight tuning, or quota editing — sub-project #4.
- Any gatekeeper write path.
- Valkey / cross-process pub-sub. The SSE bus is a single in-process emitter.
- Server-side SSE event replay / backfill buffer. Reconnect refetches instead.
- Changing the domain lifecycle, scoring, or queue mechanics.

## 3. Visual direction — _The Disposition Log_

Chosen via the `impeccable` skill's direction roll (seed `9ed67ee5`, mode `operate`,
kind `pick`). Impeccable owns UX/UI and has final say; this section is the development
contract the finish review audits against.

**THESIS.** The UI is a field-signals **disposition log**: a running, timestamped,
append-only record of domains and what was decided about each. It refuses the two
category defaults — the card-grid metrics dashboard and the neon "cyber" data table.

**OWN-WORLD.**

- Ruled log-sheet ground: warm bone in light, warm near-black in dark. The physical
  scene — _a tinkerer at a laptop in a dim room at 11 pm, checking a box in the closet_ —
  makes the dark theme first-class, not an afterthought.
- **One ink** (dark ink-blue-black). **One signal accent**, used only for the disposition
  stamp and a hairline left-margin status edge — never as fills or pills.
- Fixed columnar grid: **TIME · SOURCE (call-sign) · ENTRY · DISPOSITION**.
- Type: monospace for domains, timestamps, DNS records, and stamp text; a tight condensed
  grotesque for column heads and section rules; a workhorse sans for prose. Explicitly
  **not** Inter / Space Grotesk / the other training-data default faces.
- **Disposition = a stamp overlay** (`PENDING` / `BLOCKED` / `KEPT` / `AUTO-CLEAR` /
  `PUBLISHED` / `EXCEPTION`) — slightly rotated, ink-pressed texture, never a filled
  badge.
- **Status also as a hairline colour edge** in the row's left margin _(raise donated by
  the iridescent-cloud-edge challenger)_ — so state survives greyscale and colour
  blindness. Every state also carries a text label or glyph.
- **Score is never bare** — leader lines / a bracket connect each contributing source
  verdict to the summed score _(raise donated by the tensegrity-column challenger)_.
- **Read before you commit** — before a stamp commits, a one-line proof states its effect
  (`adds to /blocklist.txt — gatekeeper last pulled 41m ago`) _(raise donated by the
  darkroom challenger)_.

**FIRST VIEWPORT (`/`).** Masthead `VEERABAHU · LEVEL 2 DISPOSITION LOG`; standing counts
as a typed header block (`IN QUEUE` / `PUBLISHED` / `AUTO-CLEARED 24H` / `OBSERVED 24H`).
Below: the open review entries — each a domain in mono with its source call-sign lines,
summed score with leader lines, and the stamp action inline. Right margin: a consumption
record (`LAST PULL: 41m ago · 1,204 DOMAINS · 200`) and a source-quota summary strip
linking to `/queue`. Foot: the last committed log lines continuing downward. Primary
action = stamp the first open entry; fully keyboard-operable.

**SIGNATURE INTERACTION.** An SSE verdict landing = a source line written into the open
entry, the leader line redrawing, the summed score re-summing visibly. A decision = a new
stamped log line. A strongly-disagreeing late verdict = a log line stamped with a
correction rule. All motion gated by `prefers-reduced-motion` (stamps just appear).

**FINISH.** unreviewed and undocumented is unfinished; this build ends with the finish
review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## 4. Screens

| Route | In the world | Live? | Primary read model |
| --- | --- | --- | --- |
| `/` | the log's current page — masthead, open entries, consumption record, recent lines | poll ~20 s | `dashboard.ts` |
| `/queue` | the _pending_ half of the log, broken out by source: backlog, pacing, ETA, in-focus domain, ingestion loop status | SSE | `queue.ts` |
| `/review` | the incoming tray — entries whose assessment is done and a human decision is pending, worked top to bottom | SSE | `review.ts` (exists) |
| `/domains` | the log index — dense filterable register of every domain, one line each, status hairline in the margin | poll ~20 s | `domains.ts` |
| `/domains/[domain]` | a record card pulled from the drawer — every source verdict + raw detail, score derivation, full per-domain log lines, DNS/enrichment block, allowlist toggle | poll ~20 s | `review.ts#getReviewDetail` (extended) |
| `/audit` | the master log — unbroken append-only ledger, all event types, filterable, page-footed | poll ~20 s | `audit.ts` |

### 4.1 `/domains/[domain]` — side-sheet dual render

- Navigated to from within the app (`/domains`, `/review`, `/queue`, `/audit`): renders as
  a right-hand **side sheet** over the current route. Background list is preserved and not
  re-fetched. `Esc` / overlay click / close button returns. Focus is trapped in the sheet
  while open and restored to the triggering row on close.
- Loaded directly or refreshed: renders as a standalone full page with the same component
  and the same `+page.server.ts` load.
- Implementation: a `[domain]` route whose `+page.svelte` detects presentation mode from a
  layout-provided context / `page.state` (SvelteKit shallow routing via `pushState`), with
  the full-page fallback as the default. One component, two frames.

### 4.2 `/queue` contents

Per paced source (`curated_list` runs inline, so it is shown as "inline, no backlog"):

- domains still awaiting this source's verdict — derived count
  (`state IN (observed, assessing)` minus those with a verdict row for the source).
- amortized pacing interval and `nextCallAt`, remaining `perDay` / `perMonth` budget from
  `source_rate_state`, `pausedUntil`, last error.
- **drain ETA** = backlog × amortized interval, rendered human-readable
  (`~18 h`, `~4 m`, `drained`).
- **in focus** — the domain this drainer is currently assessing (from `assess.start` /
  `assess.done` events, §5.2).

Ingestion loop panel: `ingest_state.lastIngestAt`, cursor position, `firstRunDone`,
gap-detected flag if surfaced by the scheduler, next scheduled run.

Empty state: **"all domains assessed — nothing queued"**, styled as an all-clear stamp.

## 5. Architecture

### 5.1 Component map

| Component | Module (proposed) | Responsibility |
| --- | --- | --- |
| App shell | `src/routes/+layout.svelte`, `src/routes/+layout.server.ts` | Log-sheet frame, nav, SSE status indicator, theme attribute. Server layout loads only the masthead badge counts (in-queue, published) shown on every screen; `/` loads the fuller set via `dashboard.ts`. |
| Review entry | `src/lib/components/ReviewEntry.svelte` | One open entry: source lines, `ScoreBracket`, stamp action, decision `Dialog` + read-before-commit proof. Used by both `/` and `/review` so the decide flow lives in one place. |
| Token layer | `src/lib/design/tokens.css`, `src/lib/design/theme.ts` | Colour / space / type / motion tokens. Light default on `:root`; dark under `prefers-color-scheme` and `[data-theme="dark"]`; `[data-theme="light"]` override. |
| Component kit | `src/lib/components/*.svelte` | `Dialog` + `Sheet` (Melt `createDialog`), `Combobox` (Melt `createCombobox`); native-HTML wrappers `LogTable`, `LogRow`, `Stamp`, `ScoreBracket`, `Pagination`, `Toaster` (+ `toast` store), `SseStatus`, `RelativeTime`, `EmptyState`, `Masthead`. |
| SSE bus | `src/lib/server/events.ts` | Module-level emitter. `publish(evt)`, `subscribe() -> ReadableStream`. No persistence. |
| SSE endpoint | `src/routes/events/+server.ts` | `GET` → `text/event-stream`; registers a subscriber, heartbeat comment ~25 s, cleanup on `cancel`. |
| Dashboard read model | `src/lib/server/pipeline/dashboard.ts` | `getDashboard(db, schema)` → counts by state, 24 h observed / auto-cleared, published count, today's verdict count + summed `cost_usd`, last + recent blocklist pulls, `curated_lists` freshness, per-source quota summary. |
| Queue read model | `src/lib/server/pipeline/queue.ts` | `getQueue(db, schema)` → per-source backlog, pacing, remaining budget, ETA, in-focus domain; ingestion-loop status. |
| Domains read model | `src/lib/server/pipeline/domains.ts` | `listDomains(db, schema, { search, state, limit, offset })` + `countDomains(...)`. |
| Audit read model | `src/lib/server/pipeline/audit.ts` | `listAudit(db, schema, { event, actor, since, until, limit, offset })` + `countAudit(...)`. |
| Repo additions | `src/lib/server/db/repo.ts` | Thin Drizzle selects backing the read models. No ORM-on-ORM, no repository abstraction beyond the existing file. |
| Format helpers | `src/lib/format.ts` | Pure: relative time, score bucket → label, verdict / state → label + stamp text, byte / count formatting. Shared client + server. |
| Auto-refresh helper | `src/lib/client/auto-refresh.ts` | `autoRefresh(fn, ms)` — interval calling `invalidate('vb:data')`; cleared on unmount; paused when `document.hidden`. |
| SSE client helper | `src/lib/client/sse.ts` | Wraps `EventSource`; exposes a Svelte store of the latest events; on `reconnect` calls `invalidate('vb:data')`. |

### 5.2 Change to sub-project #1 code

The only pipeline change. `src/lib/server/events.ts` exports a `publish()` that is a no-op
when nothing is subscribed, so importing it from pipeline modules is safe and untested
paths stay cheap.

| Site | Event | Payload |
| --- | --- | --- |
| `governor/drainer.ts` — before a source call | `assess.start` | `{ source, domain }` |
| `governor/drainer.ts` — after the verdict is written | `assess.done` | `{ source, domain }` |
| `governor/drainer.ts` / wherever `upsertVerdict` is called | `verdict` | `{ domain, source, verdict, confidence, category }` |
| `scoring/score.ts` — after `setDomainScoreAndState` | `domain.state` | `{ domain, state, score }` |
| `publisher/blocklist.ts` — after a published-set change | `blocklist.published` | `{ count, at }` |

Each is a single line behind the existing imports. No behavioural change, no new
dependency. Covered by `events.test.ts` and an assertion in the relevant existing tests.

### 5.3 Data-loading rules

- Every screen's initial data comes from its `+page.server.ts` `load`. `/domains` and
  `/audit` read `search` / `state` / `event` / `actor` / date / `page` from the URL query
  so filters are shareable and back/forward works.
- Poll screens: `autoRefresh` re-runs the active `load` via `invalidate('vb:data')` every
  ~20 s; Svelte diffs the DOM. Paused while the tab is hidden.
- SSE screens (`/review`, `/queue`): subscribe on mount; patch local `$state` from events;
  on `EventSource` reconnect, `invalidate('vb:data')` to reconcile. No replay buffer.
- The existing `GET /api/review` JSON endpoint is **removed** — the `/review` loader
  covers it. `POST /api/review/[domain]` (decide) is unchanged and remains the only
  mutation endpoint.
- `getReviewDetail` in `pipeline/review.ts` is extended to also return the domain's
  `allowlist` row (if any) and full raw verdict `detail` for the side sheet.

### 5.4 Component kit

- **Melt UI** (`@melt-ui/svelte`, pinned) is used for exactly two primitives:
  `createDialog` — wrapped once as `Dialog.svelte` and again, side-anchored, as
  `Sheet.svelte` (decision-note + read-before-commit proof; `/domains/[domain]`) — and
  `createCombobox`, wrapped as `Combobox.svelte` (the `/domains` and `/audit` filters).
  Screens never touch a Melt builder directly.
- **Everything else is native HTML** styled with the token layer: `<table>` for the log
  tables, `<a>` + URL query params for `Pagination`, `<details>`/`<summary>` for raw-JSON
  disclosure, a `$state` array + `role="status"` for `Toaster`. Full component source is
  given in the implementation plan so a smaller model transcribes rather than invents.
- `src/lib/design/README.md` records the token names and every wrapper's props.

## 6. Data shapes (read models)

```ts
// dashboard.ts
interface DashboardView {
  counts: Record<DomainState, number>;
  observed24h: number;
  autoCleared24h: number;
  publishedCount: number;
  verdictsToday: number;
  aiCostTodayUsd: number;
  lastPull: { at: number; ip: string; status: number } | null;
  recentPulls: { at: number; status: number }[]; // last ~10
  curatedLists: { name: string; lastFetched: number | null; entryCount: number; lastError: string | null }[];
  sources: SourceQuotaSummary[]; // name, remainingDay, remainingMonth, pausedUntil
}

// queue.ts
interface QueueView {
  sources: {
    source: SourceName;
    inline: boolean;
    backlog: number;
    amortizedIntervalMs: number | null;
    nextCallAt: number | null;
    remainingDay: number | null;
    remainingMonth: number | null;
    pausedUntil: number | null;
    lastError: string | null;
    etaMs: number | null; // backlog * amortizedInterval; null when inline or drained
    inFocus: string | null; // domain
  }[];
  ingestion: { lastIngestAt: number | null; cursor: string | null; firstRunDone: boolean; nextRunAt: number | null };
  totalBacklog: number;
}

// domains.ts
interface DomainListItem {
  domain: string; state: DomainState; score: number | null;
  hitCount: number; firstSeen: number; lastSeen: number;
  decidedAt: number | null; verdictCount: number;
}

// audit.ts
interface AuditEntry { id: number; at: number; actor: string; event: string; domain: string | null; data: unknown; }
```

`in-focus` domain is held in a small module-level map in `events.ts` (last `assess.start`
minus `assess.done` per source), read synchronously by `queue.ts`. Lost on restart, which
is correct — nothing is in focus until a drainer picks the next domain.

## 7. States & edge cases

| Screen | Empty | Error / degraded |
| --- | --- | --- |
| `/` | fresh install, first ingestion not done — "log opened, no entries yet" | gatekeeper never pulled — `LAST PULL: never` as an `EXCEPTION` stamp; last pull > 24 h ago flagged |
| `/queue` | "all domains assessed — nothing queued" all-clear | source `pausedUntil` in the future, or `lastError` set — the source's line carries an `EXCEPTION` stamp and the error text |
| `/review` | "no entries awaiting a decision" | SSE dropped — `SseStatus` shows _reconnecting_; falls back to a 20 s poll until restored |
| `/domains` | no match for the filter — "no domains match" with a clear-filter action | — |
| `/domains/[domain]` | unknown domain — 404 page in the world | verdict with malformed `raw` — shows the parsed summary, raw block behind a disclosure |
| `/audit` | "no events in this range" | — |

Overflow: `/domains` and `/audit` paginate (URL `page` param, 50/page). Queue backlog of
thousands renders a count, never a list. Long decision notes clamp with a disclosure.

## 8. Testing

| Layer | Tool | Coverage |
| --- | --- | --- |
| Read models (`dashboard`, `queue`, `domains`, `audit`), `format.ts`, `events.ts` | Vitest, SQLite + Postgres in CI | full — the ≥ 90 % surface |
| SSE endpoint `events/+server.ts` | Vitest | subscribe, receive a published event, cleanup on cancel, heartbeat |
| Every `+page.server.ts` load + the extended `getReviewDetail` | Vitest | happy path + empty + filter params |
| Drainer `assess.start` / `assess.done` + score `domain.state` publish | Vitest | assertion added to existing drainer / scoring tests |
| `format.ts` pure helpers | Vitest | every branch of every helper |
| Screens / components | Playwright (against `vite preview`) | (1) stamp a domain in `/review` → it appears in `/audit`; (2) filter `/audit` by event type; (3) search `/domains`, open the detail sheet, toggle allowlist; (4) `/queue` shows a backlog count and an in-focus domain from a seeded event; (5) dark/light theme toggle persists |

Coverage gate: `src/lib/**` and `src/routes/**/*.ts`; `**/*.svelte` excluded from the
threshold (Playwright covers screens). The `include` / `exclude` change is recorded in
`vitest.config.ts` with a comment pointing here. No browser-mode Vitest.

## 9. Build order

Each step is independently reviewable and leaves CI green.

1. Token layer + `theme.ts` + `format.ts` (unit-tested) + the component kit + `+layout`
   shell + `src/lib/design/README.md`.
2. `events.ts` + `events/+server.ts` + the §5.2 publish calls wired into sub-project #1.
   Unit + endpoint tests.
3. `/review` rebuilt — SSE subscription, stamp flow, decision `Dialog`, read-before-commit
   proof, keyboard operation.
4. `dashboard.ts` + repo additions + `/` + `autoRefresh` / `sse` client helpers.
5. `queue.ts` + `/queue`.
6. `domains.ts` + `/domains` + `/domains/[domain]` side-sheet dual render + allowlist
   toggle + `getReviewDetail` extension.
7. `audit.ts` + `/audit`.
8. Playwright flows, Impeccable finish review + `detect`, DESIGN.md via the documenter.

## 10. Open decisions for the implementer

- Exact face choices within the type register of §3 — Impeccable's finish step resolves
  against the world, not invented here.
- Whether the `nextRunAt` for the ingestion loop is exposed by the scheduler or computed
  as `lastIngestAt + interval`; prefer reading it if the scheduler already holds it.
- `page.state` vs. a layout context for the side-sheet presentation flag — pick one during
  step 6; both are acceptable SvelteKit shallow-routing patterns.

## 11. Traceability

| Requirement | Where |
| --- | --- |
| Vision goal 2 — rich dashboard | `/`, `/queue` |
| Vision goal 3 — audit trails | `/audit`, per-domain log lines in `/domains/[domain]` |
| Vision goal 5 — detailed settings | out of scope — sub-project #4 |
| §5 non-negotiable — UX owned by Impeccable | §3, finish review §9 |
| §10 — audit trail is _"what happened and what did I do"_ | `/audit` reads the append-only `audit_log`; no writes |
| §6 — in-process SSE for HITL | `events.ts`, single emitter, Valkey still deferred |
| Vision goals 7 / 8 — ≥ 90 % coverage, CI | §8 |

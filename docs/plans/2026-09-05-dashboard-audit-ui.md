# Sub-project #2 — Dashboard, Queue & Audit UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the operator UI over the sub-project #1 pipeline — six screens (dashboard, live queue status, rebuilt review, domain browser, domain detail side-sheet, audit log) in the _Disposition Log_ visual world, with an in-process SSE bus and no full-page reloads.

**Architecture:** All reads go through SvelteKit `+page.server.ts` load functions (SSR-first). Read models are pure TS modules in `src/lib/server/pipeline/` mirroring the existing `review.ts`. Live data flows over one in-process `EventEmitter`-style bus (`src/lib/server/events.ts`) exposed as a single `GET /events` SSE endpoint; `/review` and `/queue` subscribe and patch state, other screens re-run their loader on a ~20 s timer. Components are native HTML styled with a CSS-custom-property token layer, except a Melt UI `Dialog`/`Sheet` and `Combobox`.

**Tech Stack:** SvelteKit 2 + Svelte 5 Runes + TypeScript, `adapter-node`, Drizzle ORM (better-sqlite3 / postgres-js), Zod, Vitest (node), Playwright, `@melt-ui/svelte`, pnpm.

**Spec:** `docs/specs/2026-09-05-dashboard-audit-ui-design.md` — read it alongside this plan. Every task traces to a section there.

**Execution status (updated as tasks land):** a task carries `- [x] **TASK COMPLETE** — commits <a>..<b>` under its heading when its SDD task-review is clean. No marker = not started or in progress. Authoritative recovery map is the SDD ledger at `.superpowers/sdd/2026-09-05-dashboard-audit-ui/progress.md`; this plan's markers are a convenience for a cold resume.

## Global Constraints

- **Node** `>=20` (package.json `engines`). CI runs Node 24.
- **Package manager** is pnpm. Never run `npm`/`yarn`. Add deps with `pnpm add -D <pkg>` (all new deps here are dev deps — SSR-only or build-time).
- **Pinned new deps:** `@melt-ui/svelte@0.86.6`, `@playwright/test@1.48.0`.
- **DB portability:** every query must work on both SQLite and Postgres. Use Drizzle query-builder operators (`eq`, `and`, `gte`, `like`, `sql`), never dialect-specific SQL. `sql` template fragments must use portable functions only (`count(*)`, `sum(...)`, `lower(...)`). Timestamps are epoch-ms integers.
- **No web fonts.** System font stacks only (see Task 5).
- **No new runtime dependencies.** Everything ships SSR/build-time.
- **Coverage gate:** `pnpm test:cov` must stay ≥ 90 % lines/functions/statements, ≥ 80 % branches, measured on `src/lib/**` + `src/routes/**/*.ts`, `**/*.svelte` excluded (configured in Task 1).
- **Both engines green:** `pnpm test` (SQLite) and `pnpm test:pg` (Postgres, needs a local Postgres) must pass. CI runs both.
- **Actor string** for human decisions is the literal `'user'`; system events use `'system'`; source events use the source name. Do not invent new actor values.
- **Domain states** (`src/lib/server/db/types.ts`): `observed`, `assessing`, `pending_review`, `auto_cleared`, `approved`, `rejected`. **Source names:** `curated_list`, `metadefender`, `ai`, `virustotal`. **Verdict values:** `block`, `allow`, `unsure`, `error`.
- **Commit** after every task with the message shown in the task's final step. Keep the working tree clean between tasks.

---

## File Structure

**Created:**

| Path                                                           | Responsibility                                                                                                                                                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/format.ts`                                            | Pure display helpers (time, duration, score/state/verdict labels, counts, USD). Shared client + server.                                                                                            |
| `src/lib/server/events.ts`                                     | In-process event bus: `publish`, `subscribe`, `getInFocus`, `_resetForTest`. No persistence.                                                                                                       |
| `src/routes/events/+server.ts`                                 | `GET` → `text/event-stream`; one subscriber per connection, heartbeat, cleanup on cancel.                                                                                                          |
| `src/lib/server/pipeline/dashboard.ts`                         | `getDashboard(db, schema)` → `DashboardView`.                                                                                                                                                      |
| `src/lib/server/pipeline/queue.ts`                             | `getQueue(db, schema)` → `QueueView` (per-source backlog, pacing, ETA, in-focus).                                                                                                                  |
| `src/lib/server/pipeline/domains.ts`                           | `listDomains` + `countDomains`.                                                                                                                                                                    |
| `src/lib/server/pipeline/audit.ts`                             | `listAudit` + `countAudit` (joins domain name).                                                                                                                                                    |
| `src/lib/design/tokens.css`                                    | Colour / space / type / motion CSS custom properties; light default + `@media (prefers-color-scheme: dark)`. No JS theme layer — the OS setting decides (a manual toggle is sub-project #4's job). |
| `src/lib/design/README.md`                                     | Token names + component prop reference for #3–#5.                                                                                                                                                  |
| `src/lib/client/sse.ts`                                        | `createEventStream()` — `EventSource` wrapper, Svelte store of last event, reconnect → `invalidate('vb:data')`.                                                                                    |
| `src/lib/client/auto-refresh.ts`                               | `autoRefresh(ms)` — `$effect`-friendly interval calling `invalidate('vb:data')`, paused while `document.hidden`.                                                                                   |
| `src/lib/components/Stamp.svelte`                              | Disposition stamp overlay (rotated, pressed, text label).                                                                                                                                          |
| `src/lib/components/ScoreBracket.svelte`                       | Summed score with leader lines to contributing verdict chips.                                                                                                                                      |
| `src/lib/components/StatusEdge.svelte`                         | Hairline left-margin status colour + sr-only label.                                                                                                                                                |
| `src/lib/components/RelativeTime.svelte`                       | `<time datetime>` with relative text, computed once at render (the page's own reload cadence refreshes it — no per-instance timer).                                                                |
| `src/lib/components/EmptyState.svelte`                         | Centered empty/all-clear message with optional action slot.                                                                                                                                        |
| `src/lib/components/SseStatus.svelte`                          | Live/reconnecting indicator, driven by an sse-store prop.                                                                                                                                          |
| `src/lib/components/Masthead.svelte`                           | Log masthead: title + typed count block.                                                                                                                                                           |
| `src/lib/components/LogTable.svelte`                           | `<table>` shell with the fixed column grammar; row content via slot.                                                                                                                               |
| `src/lib/components/Pagination.svelte`                         | Prev/next + page N of M as `<a>` links carrying existing query params.                                                                                                                             |
| `src/lib/components/Dialog.svelte`                             | Melt `createDialog` wrapper (modal, centered).                                                                                                                                                     |
| `src/lib/components/Sheet.svelte`                              | Melt `createDialog` wrapper, right-anchored, full height.                                                                                                                                          |
| `src/lib/components/Select.svelte`                             | Styled native `<select>` for the fixed-option filters.                                                                                                                                             |
| `src/lib/components/ReviewEntry.svelte`                        | One open review entry: source lines, `ScoreBracket`, stamp actions, decision `Dialog`, read-before-commit proof. Used by `/` and `/review`.                                                        |
| `src/routes/+layout.server.ts`                                 | Masthead badge counts (in-queue, published) for every screen.                                                                                                                                      |
| `src/routes/+layout.svelte`                                    | App shell: ground, nav, `SseStatus`, `{@render children()}`.                                                                                                                                       |
| `src/routes/+page.server.ts`                                   | Dashboard loader.                                                                                                                                                                                  |
| `src/routes/queue/+page.server.ts` + `+page.svelte`            | Queue screen.                                                                                                                                                                                      |
| `src/routes/domains/+page.server.ts` + `+page.svelte`          | Domain browser.                                                                                                                                                                                    |
| `src/routes/domains/[domain]/+page.server.ts` + `+page.svelte` | Domain detail (page + sheet), allowlist form action.                                                                                                                                               |
| `src/routes/audit/+page.server.ts` + `+page.svelte`            | Audit log.                                                                                                                                                                                         |
| `playwright.config.ts`                                         | Playwright config: build+preview webServer, chromium project.                                                                                                                                      |
| `tests/e2e/seed.ts`                                            | Seed a fixed SQLite file for the E2E preview server.                                                                                                                                               |
| `tests/e2e/*.spec.ts`                                          | Two Playwright specs — the review→audit flow and the domains→side-sheet flow.                                                                                                                      |

**Modified:**

| Path                                 | Change                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `package.json`                       | Add dev deps; add `test:e2e` script.                                                      |
| `vitest.config.ts`                   | Coverage `include` → `src/lib/**` + `src/routes/**/*.ts`; `exclude` `**/*.svelte`.        |
| `src/routes/+page.svelte`            | Replace the stub with the dashboard.                                                      |
| `src/routes/review/+page.server.ts`  | Add `depends('vb:data')`.                                                                 |
| `src/routes/review/+page.svelte`     | Rebuild against the kit + SSE.                                                            |
| `src/lib/server/pipeline/review.ts`  | Extend `getReviewDetail` (allowlist row + raw detail); `publish('decision')` in `decide`. |
| `src/lib/server/db/repo.ts`          | Add read queries (Task 6).                                                                |
| `src/lib/server/governor/drainer.ts` | `publish` `assess.start` / `assess.done` / `verdict`.                                     |
| `src/lib/server/scoring/score.ts`    | `publish` `domain.state`.                                                                 |
| `src/routes/api/review/+server.ts`   | **Delete** (loader replaces it).                                                          |
| `.github/workflows/ci.yml`           | Add a Playwright job.                                                                     |

---

## Task 1: Dev dependencies + coverage config

- [x] **TASK COMPLETE** — commits 190fab6..3e5a463, review clean

**Files:**

- Modify: `package.json`
- Modify: `vitest.config.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `@melt-ui/svelte`, `@playwright/test` installed; `pnpm test:cov` measures the new surface.

- [ ] **Step 1: Add the dependencies**

Run:

```bash
pnpm add -D @melt-ui/svelte@0.86.6 @playwright/test@1.48.0
pnpm exec playwright install --with-deps chromium
```

- [ ] **Step 2: Add the e2e script**

In `package.json` `"scripts"`, add:

```json
"test:e2e": "playwright test"
```

- [ ] **Step 3: Widen coverage measurement**

Replace the `coverage` block in `vitest.config.ts` with:

```ts
    coverage: {
      provider: 'v8',
      // Sub-project #2 spec §8: gate on TypeScript only; screens are covered by Playwright.
      include: ['src/lib/**', 'src/routes/**/*.ts'],
      exclude: ['**/*.svelte', 'src/routes/**/*.svelte'],
      thresholds: { lines: 90, functions: 90, branches: 80, statements: 90 }
    }
```

- [ ] **Step 4: Verify the existing suite still passes under the new config**

Run: `pnpm test:cov`
Expected: PASS, coverage report now also lists `src/routes/**/*.ts` (currently only `blocklist.txt` + review routes). If the gate fails only because the new `src/routes/**/*.ts` files are uncovered, that is expected to resolve as later tasks add their tests — but for THIS task, confirm the number is still ≥ 90 % (the existing route files already have tests). If it dips below, stop and report.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts
git commit -m "chore(sub2): add melt-ui + playwright, widen coverage to routes"
```

---

## Task 2: `format.ts` pure display helpers

- [x] **TASK COMPLETE** — commits 3e5a463..75f4bfa, review clean

**Files:**

- Create: `src/lib/format.ts`
- Test: `tests/lib/format.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `relativeTime(atMs: number, nowMs?: number): string` — `"just now"`, `"3m ago"`, `"5h ago"`, `"2d ago"`, `"never"` when `atMs` is `0`/`NaN`/`null`-ish (accepts `number | null | undefined`).
  - `formatDuration(ms: number | null): string` — `"drained"` when `null`/`<=0`, else `"~4m"`, `"~3h"`, `"~2d"`, `"~1d 4h"`.
  - `scoreLabel(score: number | null): { text: string; tone: 'block' | 'allow' | 'mixed' | 'none' }` — `null` → `{ text: '—', tone: 'none' }`; `<= -0.5` → `strong block`; `< 0` → `leans block`; `=== 0` → `mixed`; `> 0 && < 0.6` → `leans allow`; `>= 0.6` → `strong allow`.
  - `stateLabel(state: DomainState): string` — human text (`observed` → `"Observed"`, `pending_review` → `"Awaiting decision"`, `auto_cleared` → `"Auto-cleared"`, `approved` → `"Published"`, `rejected` → `"Kept"`, `assessing` → `"Assessing"`).
  - `stateStampText(state: DomainState): string` — `observed`→`OBSERVED`, `assessing`→`ASSESSING`, `pending_review`→`PENDING`, `auto_cleared`→`AUTO-CLEAR`, `approved`→`BLOCKED`, `rejected`→`KEPT`.
  - `verdictLabel(v: VerdictValue): string` — `block`→`"Block"`, `allow`→`"Allow"`, `unsure`→`"Unsure"`, `error`→`"Error"`.
  - `formatCount(n: number): string` — `1234` → `"1,234"` (`Intl.NumberFormat('en-US')`).
  - `formatUsd(n: number): string` — `0` → `"$0.00"`, `1.2` → `"$1.20"`, `0.0034` → `"$0.0034"` (≥ `$1` → 2 dp; `< $1` → 4 dp).

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/format.test.ts
import { describe, expect, it } from 'vitest';
import {
  relativeTime,
  formatDuration,
  scoreLabel,
  stateLabel,
  stateStampText,
  verdictLabel,
  formatCount,
  formatUsd
} from '../../src/lib/format';

const T0 = 1_700_000_000_000;

describe('relativeTime', () => {
  it('handles the recent past and missing values', () => {
    expect(relativeTime(T0, T0 + 10_000)).toBe('just now');
    expect(relativeTime(T0, T0 + 3 * 60_000)).toBe('3m ago');
    expect(relativeTime(T0, T0 + 5 * 3_600_000)).toBe('5h ago');
    expect(relativeTime(T0, T0 + 2 * 86_400_000)).toBe('2d ago');
    expect(relativeTime(0, T0)).toBe('never');
    expect(relativeTime(null, T0)).toBe('never');
  });
});

describe('formatDuration', () => {
  it('formats or reports drained', () => {
    expect(formatDuration(null)).toBe('drained');
    expect(formatDuration(0)).toBe('drained');
    expect(formatDuration(4 * 60_000)).toBe('~4m');
    expect(formatDuration(3 * 3_600_000)).toBe('~3h');
    expect(formatDuration(28 * 3_600_000)).toBe('~1d 4h');
  });
});

describe('scoreLabel', () => {
  it('buckets the score', () => {
    expect(scoreLabel(null)).toEqual({ text: '—', tone: 'none' });
    expect(scoreLabel(-0.8).tone).toBe('block');
    expect(scoreLabel(-0.2).text).toBe('leans block');
    expect(scoreLabel(0).tone).toBe('mixed');
    expect(scoreLabel(0.3).text).toBe('leans allow');
    expect(scoreLabel(0.9).text).toBe('strong allow');
  });
});

describe('label helpers', () => {
  it('maps states and verdicts', () => {
    expect(stateLabel('pending_review')).toBe('Awaiting decision');
    expect(stateStampText('approved')).toBe('BLOCKED');
    expect(stateStampText('rejected')).toBe('KEPT');
    expect(verdictLabel('unsure')).toBe('Unsure');
  });
});

describe('number helpers', () => {
  it('formats counts and money', () => {
    expect(formatCount(1234)).toBe('1,234');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(1.2)).toBe('$1.20');
    expect(formatUsd(0.0034)).toBe('$0.0034');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/lib/format.test.ts`
Expected: FAIL — `Cannot find module '../../src/lib/format'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/format.ts
import type { DomainState, VerdictValue } from './server/db/types';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export function relativeTime(
  atMs: number | null | undefined,
  nowMs: number = Date.now()
): string {
  if (!atMs || Number.isNaN(atMs)) return 'never';
  const d = Math.max(0, nowMs - atMs);
  if (d < MIN) return 'just now';
  if (d < HOUR) return `${Math.floor(d / MIN)}m ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h ago`;
  return `${Math.floor(d / DAY)}d ago`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return 'drained';
  if (ms < HOUR) return `~${Math.round(ms / MIN)}m`;
  if (ms < DAY) return `~${Math.round(ms / HOUR)}h`;
  const days = Math.floor(ms / DAY);
  const hours = Math.round((ms % DAY) / HOUR);
  return hours ? `~${days}d ${hours}h` : `~${days}d`;
}

export function scoreLabel(score: number | null): {
  text: string;
  tone: 'block' | 'allow' | 'mixed' | 'none';
} {
  if (score === null) return { text: '—', tone: 'none' };
  if (score <= -0.5) return { text: 'strong block', tone: 'block' };
  if (score < 0) return { text: 'leans block', tone: 'block' };
  if (score === 0) return { text: 'mixed', tone: 'mixed' };
  if (score < 0.6) return { text: 'leans allow', tone: 'allow' };
  return { text: 'strong allow', tone: 'allow' };
}

const STATE_LABEL: Record<DomainState, string> = {
  observed: 'Observed',
  assessing: 'Assessing',
  pending_review: 'Awaiting decision',
  auto_cleared: 'Auto-cleared',
  approved: 'Published',
  rejected: 'Kept'
};
export const stateLabel = (s: DomainState): string => STATE_LABEL[s];

const STATE_STAMP: Record<DomainState, string> = {
  observed: 'OBSERVED',
  assessing: 'ASSESSING',
  pending_review: 'PENDING',
  auto_cleared: 'AUTO-CLEAR',
  approved: 'BLOCKED',
  rejected: 'KEPT'
};
export const stateStampText = (s: DomainState): string => STATE_STAMP[s];

const VERDICT_LABEL: Record<VerdictValue, string> = {
  block: 'Block',
  allow: 'Allow',
  unsure: 'Unsure',
  error: 'Error'
};
export const verdictLabel = (v: VerdictValue): string => VERDICT_LABEL[v];

const NUM = new Intl.NumberFormat('en-US');
export const formatCount = (n: number): string => NUM.format(n);

export function formatUsd(n: number): string {
  const dp = n >= 1 || n === 0 ? 2 : 4;
  return `$${n.toFixed(dp)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/lib/format.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts tests/lib/format.test.ts
git commit -m "feat(sub2): format.ts display helpers"
```

---

## Task 3: `events.ts` in-process event bus

- [x] **TASK COMPLETE** — commits 75f4bfa..b96adaa, review clean

**Files:**

- Create: `src/lib/server/events.ts`
- Test: `tests/server/events.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `type VbEvent` — discriminated union on `type`:
    - `{ type: 'assess.start'; source: SourceName; domain: string }`
    - `{ type: 'assess.done'; source: SourceName; domain: string }`
    - `{ type: 'verdict'; domain: string; source: SourceName; verdict: VerdictValue; confidence: number; category: string | null }`
    - `{ type: 'domain.state'; domain: string; state: DomainState; score: number | null }`
    - `{ type: 'decision'; domain: string; decision: 'approve' | 'reject' }`
  - `publish(evt: VbEvent): void` — fan out to all listeners (listener throw is swallowed); maintains the in-focus map from `assess.start` / `assess.done`.
  - `subscribe(listener: (evt: VbEvent) => void): () => void` — returns an unsubscribe function.
  - `getInFocus(): Record<string, string>` — `{ [source]: domain }` currently being assessed.
  - `_resetForTest(): void` — clears listeners and the in-focus map.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/events.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  publish,
  subscribe,
  getInFocus,
  _resetForTest,
  type VbEvent
} from '../../src/lib/server/events';

afterEach(() => _resetForTest());

describe('events bus', () => {
  it('delivers to every subscriber and unsubscribes cleanly', () => {
    const a: VbEvent[] = [];
    const b: VbEvent[] = [];
    const offA = subscribe((e) => a.push(e));
    subscribe((e) => b.push(e));
    publish({ type: 'decision', domain: 'x.com', decision: 'approve' });
    offA();
    publish({ type: 'decision', domain: 'y.com', decision: 'reject' });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(2);
  });

  it('isolates a throwing listener', () => {
    const seen: VbEvent[] = [];
    subscribe(() => {
      throw new Error('boom');
    });
    subscribe((e) => seen.push(e));
    expect(() =>
      publish({ type: 'decision', domain: 'z.com', decision: 'approve' })
    ).not.toThrow();
    expect(seen).toHaveLength(1);
  });

  it('tracks the in-focus domain per source', () => {
    publish({ type: 'assess.start', source: 'metadefender', domain: 'a.com' });
    publish({ type: 'assess.start', source: 'ai', domain: 'b.com' });
    expect(getInFocus()).toEqual({ metadefender: 'a.com', ai: 'b.com' });
    publish({ type: 'assess.done', source: 'metadefender', domain: 'a.com' });
    expect(getInFocus()).toEqual({ ai: 'b.com' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/server/events.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/server/events.ts
import type { DomainState, SourceName, VerdictValue } from './db/types';

export type VbEvent =
  | { type: 'assess.start'; source: SourceName; domain: string }
  | { type: 'assess.done'; source: SourceName; domain: string }
  | {
      type: 'verdict';
      domain: string;
      source: SourceName;
      verdict: VerdictValue;
      confidence: number;
      category: string | null;
    }
  | {
      type: 'domain.state';
      domain: string;
      state: DomainState;
      score: number | null;
    }
  | { type: 'decision'; domain: string; decision: 'approve' | 'reject' };

type Listener = (evt: VbEvent) => void;

const listeners = new Set<Listener>();
const inFocus = new Map<string, string>();

export function publish(evt: VbEvent): void {
  if (evt.type === 'assess.start') inFocus.set(evt.source, evt.domain);
  else if (evt.type === 'assess.done') inFocus.delete(evt.source);
  for (const l of listeners) {
    try {
      l(evt);
    } catch (e) {
      console.error('[events] listener threw:', e);
    }
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getInFocus(): Record<string, string> {
  return Object.fromEntries(inFocus);
}

export function _resetForTest(): void {
  listeners.clear();
  inFocus.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/server/events.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/events.ts tests/server/events.test.ts
git commit -m "feat(sub2): in-process event bus"
```

---

## Task 4: `GET /events` SSE endpoint

- [x] **TASK COMPLETE** — commits b96adaa..8240b99, review clean

**Files:**

- Create: `src/routes/events/+server.ts`
- Test: `tests/server/routes/events-route.test.ts`

**Interfaces:**

- Consumes: `subscribe` from `src/lib/server/events.ts`.
- Produces: `GET` `RequestHandler` returning a `Response` with `content-type: text/event-stream`. Body frames: an opening `: connected\n\n` comment, then `data: <json>\n\n` per event, then `: hb\n\n` every 25 s. Unsubscribes and clears the heartbeat when the stream is cancelled.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/routes/events-route.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { GET } from '../../../src/routes/events/+server';
import { publish, _resetForTest } from '../../../src/lib/server/events';

afterEach(() => _resetForTest());

describe('GET /events', () => {
  it('streams published events as SSE frames', async () => {
    const res = (GET as any)({});
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const reader = res.body!.getReader();
    const dec = new TextDecoder();

    const first = await reader.read();
    expect(dec.decode(first.value)).toContain(': connected');

    publish({ type: 'decision', domain: 'a.com', decision: 'approve' });
    const next = await reader.read();
    const frame = dec.decode(next.value);
    expect(frame.startsWith('data: ')).toBe(true);
    expect(JSON.parse(frame.slice(6).trim())).toEqual({
      type: 'decision',
      domain: 'a.com',
      decision: 'approve'
    });

    await reader.cancel();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/server/routes/events-route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/routes/events/+server.ts
import { subscribe } from '$lib/server/events';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
  const enc = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const push = (chunk: string) => {
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          // stream already closed; cancel() will clean up
        }
      };
      push(': connected\n\n');
      unsubscribe = subscribe((evt) =>
        push(`data: ${JSON.stringify(evt)}\n\n`)
      );
      heartbeat = setInterval(() => push(': hb\n\n'), 25_000);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    }
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    }
  });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/server/routes/events-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite + typecheck**

Run: `pnpm exec vitest run && pnpm check`
Expected: PASS (`pnpm check` needs `svelte-kit sync` to have generated `./$types`; it runs that first).

- [ ] **Step 6: Commit**

```bash
git add src/routes/events/+server.ts tests/server/routes/events-route.test.ts
git commit -m "feat(sub2): GET /events SSE endpoint"
```

---

## Task 5: Publish pipeline events

- [x] **TASK COMPLETE** — commits 8240b99..074e728, review clean

**Files:**

- Modify: `src/lib/server/governor/drainer.ts`
- Modify: `src/lib/server/scoring/score.ts`
- Modify: `src/lib/server/pipeline/review.ts` (the `decide` function only; the `getReviewDetail` extension is Task 11)
- Test: `tests/server/events-integration.test.ts` (new)

**Interfaces:**

- Consumes: `publish` from `src/lib/server/events.ts`.
- Produces: no signature changes. `drainer.tick()` now emits `assess.start` / `assess.done` / `verdict`; `evaluateDomain(...)` emits `domain.state` when it writes a transition; `decide(...)` emits `decision`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/events-integration.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '../helpers/test-db';
import {
  subscribe,
  _resetForTest,
  type VbEvent
} from '../../src/lib/server/events';
import { decide } from '../../src/lib/server/pipeline/review';
import * as repo from '../../src/lib/server/db/repo';

let tdb: TestDb;
let events: VbEvent[];
let off: () => void;

beforeEach(async () => {
  tdb = await makeTestDb();
  events = [];
  off = subscribe((e) => events.push(e));
});
afterEach(() => {
  off();
  _resetForTest();
  tdb.close();
});

describe('decide emits a decision event', () => {
  it('fires on approve', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.domains).values({
      domain: 'ads.example',
      firstSeen: 1,
      lastSeen: 1,
      hitCount: 3,
      state: 'pending_review',
      score: -0.7
    });
    const r = await decide(db, schema, 'ads.example', 'approve', 'looks bad');
    expect(r).toEqual({ ok: true });
    expect(events).toContainEqual({
      type: 'decision',
      domain: 'ads.example',
      decision: 'approve'
    });
  });
});
```

(The drainer / score emissions are asserted by extending their existing tests in Step 4; this new file covers `decide`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/server/events-integration.test.ts`
Expected: FAIL — `events` is empty; no `decision` event.

- [ ] **Step 3: Wire the publishers**

In `src/lib/server/pipeline/review.ts`:

- add to the imports: `import { publish } from '../events';`
- in `decide`, immediately after `await repo.decideDomain(db, schema, d.id, decision, note, at);` add:

```ts
publish({ type: 'decision', domain, decision });
```

In `src/lib/server/scoring/score.ts`:

- add to the imports: `import { publish } from '../events';`
- in `evaluateDomain`, inside the `if (score !== domain.score || state !== domain.state) {` block, immediately after `await setDomainScoreAndState(db, schema, domainId, score, state);` add:

```ts
publish({ type: 'domain.state', domain: domain.domain, state, score });
```

In `src/lib/server/governor/drainer.ts`:

- add to the imports: `import { publish } from '../events';`
- in `tick()`, immediately after the `if (!domain) { ... continue; }` block and before `const input: AssessmentInput = {`, add:

```ts
publish({ type: 'assess.start', source: source.name, domain: domain.domain });
```

- in the `catch (e)` block, immediately after the `await repo.upsertVerdict(...)` call, add:

```ts
publish({
  type: 'verdict',
  domain: domain.domain,
  source: source.name,
  verdict: 'error',
  confidence: 0,
  category: null
});
```

- in the `if (v) { await repo.upsertVerdict(...) }` block, immediately after `upsertVerdict`, add:

```ts
publish({
  type: 'verdict',
  domain: domain.domain,
  source: source.name,
  verdict: v.verdict,
  confidence: v.confidence,
  category: v.category
});
```

- immediately after `state = afterCall(state, source.limits, nowMs);` add:

```ts
publish({ type: 'assess.done', source: source.name, domain: domain.domain });
```

- [ ] **Step 4: Extend the existing drainer test to assert emissions**

Open `tests/server/governor/drainer.test.ts`. At the top add:

```ts
import {
  subscribe,
  _resetForTest,
  type VbEvent
} from '../../../src/lib/server/events';
```

In the test that runs a successful `tick()` (the one that asserts a verdict row is written), before calling `tick()` add:

```ts
const evts: VbEvent[] = [];
const off = subscribe((e) => evts.push(e));
```

and after the `tick()` assertions add:

```ts
off();
expect(evts.map((e) => e.type)).toEqual(
  expect.arrayContaining(['assess.start', 'verdict', 'assess.done'])
);
_resetForTest();
```

If the file has multiple `tick` tests and this makes them interfere, add `_resetForTest()` in an `afterEach`.

- [ ] **Step 5: Run the affected tests**

Run: `pnpm exec vitest run tests/server/events-integration.test.ts tests/server/governor/drainer.test.ts tests/server/scoring/score.test.ts tests/server/pipeline/review.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite**

Run: `pnpm test`
Expected: PASS. (If `score.test.ts` unit-tests `evaluateDomain` and a stray `domain.state` event leaks between tests, add `import { _resetForTest } from ...` + `afterEach(_resetForTest)` there too.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/governor/drainer.ts src/lib/server/scoring/score.ts src/lib/server/pipeline/review.ts tests/server/events-integration.test.ts tests/server/governor/drainer.test.ts
git commit -m "feat(sub2): publish pipeline events onto the bus"
```

---

## Task 6: Read queries in `repo.ts`

- [x] **TASK COMPLETE** — commits 99f3927..f3c0ea5, review clean (searchDomains rewritten as leftJoin+groupBy — ruling in ledger)

**Files:**

- Modify: `src/lib/server/db/repo.ts` (append; do not touch existing exports)
- Test: `tests/server/db/repo-reads.test.ts`

**Interfaces:**

- Consumes: `db`, `schema` (Drizzle), existing imports in `repo.ts` (`and`, `asc`, `desc`, `eq`, `gte`, `like`, `sql` — add the missing operators to the existing `import { ... } from 'drizzle-orm'` line: `gte`, `lt`, `like`, `sql`, `count`, `sum`, `inArray`, `notInArray` — `inArray`/`notInArray` are already imported).
- Produces (all `async`, all `(db, schema, ...) =>`):
  - `countDomainsByState(db, schema): Promise<Record<DomainState, number>>` — every state present, missing states → `0`.
  - `countDomainsSince(db, schema, field: 'firstSeen', sinceMs): Promise<number>`
  - `countDomainsInStateSince(db, schema, state: DomainState, field: 'decidedAt' | 'lastSeen', sinceMs): Promise<number>`
  - `countPublished(db, schema): Promise<number>` — domains in state `approved`.
  - `listRecentBlocklistFetches(db, schema, limit): Promise<BlocklistFetchLogRow[]>` — newest first.
  - `getCuratedLists(db, schema): Promise<CuratedListRow[]>` — ordered by `name`.
  - `getAllSourceRateState(db, schema): Promise<SourceRateStateRow[]>`
  - `countVerdictsSince(db, schema, sinceMs): Promise<number>` — rows with `assessedAt >= sinceMs`.
  - `sumVerdictCostSince(db, schema, sinceMs): Promise<number>` — `sum(costUsd)` over `assessedAt >= sinceMs`, `null` → `0`.
  - `countBacklogForSource(db, schema, source: SourceName): Promise<number>` — domains in `('observed','assessing')` with no verdict row for `source`.
  - `searchDomains(db, schema, opts: { search?: string; state?: DomainState; limit: number; offset: number }): Promise<(DomainRow & { verdictCount: number })[]>` — `search` matches `lower(domain) like lower('%'||q||'%')`; ordered `desc(lastSeen)`.
  - `countDomainsMatching(db, schema, opts: { search?: string; state?: DomainState }): Promise<number>`
  - `listAuditRows(db, schema, opts: { event?: string; actor?: string; since?: number; until?: number; limit: number; offset: number }): Promise<(AuditLogRow & { domain: string | null })[]>` — left join `domains` on `domainId`; ordered `desc(at), desc(id)`.
  - `countAuditRows(db, schema, opts: { event?: string; actor?: string; since?: number; until?: number }): Promise<number>`
  - `getAllowlistRow(db, schema, domain): Promise<AllowlistRow | undefined>`
  - `removeAllowlist(db, schema, domain): Promise<void>` — delete by `domain`.
  - `getIngestStateRow(db, schema): Promise<IngestStateRow>` — reuse existing `getIngestState`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/db/repo-reads.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '../../helpers/test-db';
import * as repo from '../../../src/lib/server/db/repo';

let tdb: TestDb;
beforeEach(async () => (tdb = await makeTestDb()));
afterEach(() => tdb.close());

async function seed() {
  const { db, schema } = tdb;
  const [d1] = await db
    .insert(schema.domains)
    .values({
      domain: 'a.ads.com',
      firstSeen: 1000,
      lastSeen: 5000,
      hitCount: 9,
      state: 'pending_review',
      score: -0.7
    })
    .returning();
  const [d2] = await db
    .insert(schema.domains)
    .values({
      domain: 'b.cdn.com',
      firstSeen: 2000,
      lastSeen: 6000,
      hitCount: 2,
      state: 'observed'
    })
    .returning();
  await db.insert(schema.domains).values({
    domain: 'c.good.com',
    firstSeen: 3000,
    lastSeen: 7000,
    hitCount: 1,
    state: 'approved',
    decidedAt: 8000
  });
  await db.insert(schema.verdicts).values({
    domainId: d1.id,
    source: 'metadefender',
    verdict: 'block',
    confidence: 0.9,
    category: 'malware',
    detail: null,
    raw: {},
    assessedAt: 4000,
    costUsd: null
  });
  await db.insert(schema.verdicts).values({
    domainId: d1.id,
    source: 'ai',
    verdict: 'block',
    confidence: 0.7,
    category: null,
    detail: 'looks bad',
    raw: {},
    assessedAt: 4500,
    costUsd: 0.002
  });
  await db.insert(schema.auditLog).values({
    at: 4000,
    actor: 'system',
    domainId: d1.id,
    event: 'domain.transition',
    data: { to: 'pending_review' }
  });
  await db.insert(schema.auditLog).values({
    at: 9000,
    actor: 'user',
    domainId: null,
    event: 'decision.approve',
    data: {}
  });
  await db
    .insert(schema.blocklistFetchLog)
    .values({ at: 5000, ip: '10.0.0.2', userAgent: 'pihole', status: 200 });
  return { d1, d2 };
}

describe('repo read queries', () => {
  it('counts domains by state with zero-fill', async () => {
    await seed();
    const c = await repo.countDomainsByState(tdb.db, tdb.schema);
    expect(c.pending_review).toBe(1);
    expect(c.observed).toBe(1);
    expect(c.approved).toBe(1);
    expect(c.rejected).toBe(0);
  });

  it('counts published and recent windows', async () => {
    await seed();
    expect(await repo.countPublished(tdb.db, tdb.schema)).toBe(1);
    expect(
      await repo.countDomainsSince(tdb.db, tdb.schema, 'firstSeen', 2500)
    ).toBe(1);
    expect(await repo.countVerdictsSince(tdb.db, tdb.schema, 4200)).toBe(1);
    expect(await repo.sumVerdictCostSince(tdb.db, tdb.schema, 0)).toBeCloseTo(
      0.002
    );
    expect(await repo.sumVerdictCostSince(tdb.db, tdb.schema, 999999)).toBe(0);
  });

  it('computes per-source backlog', async () => {
    await seed();
    // d2 (observed) has no verdicts; d1 has metadefender+ai but is pending_review (not in backlog states)
    expect(
      await repo.countBacklogForSource(tdb.db, tdb.schema, 'metadefender')
    ).toBe(1);
    expect(
      await repo.countBacklogForSource(tdb.db, tdb.schema, 'curated_list')
    ).toBe(1);
  });

  it('searches and paginates domains', async () => {
    await seed();
    const hits = await repo.searchDomains(tdb.db, tdb.schema, {
      search: 'ADS',
      limit: 10,
      offset: 0
    });
    expect(hits.map((h) => h.domain)).toEqual(['a.ads.com']);
    expect(hits[0].verdictCount).toBe(2);
    expect(
      await repo.countDomainsMatching(tdb.db, tdb.schema, { state: 'observed' })
    ).toBe(1);
  });

  it('lists audit rows with domain name and filters', async () => {
    await seed();
    const all = await repo.listAuditRows(tdb.db, tdb.schema, {
      limit: 10,
      offset: 0
    });
    expect(all[0].event).toBe('decision.approve');
    expect(all[0].domain).toBeNull();
    expect(all[1].domain).toBe('a.ads.com');
    const byActor = await repo.listAuditRows(tdb.db, tdb.schema, {
      actor: 'user',
      limit: 10,
      offset: 0
    });
    expect(byActor).toHaveLength(1);
    expect(
      await repo.countAuditRows(tdb.db, tdb.schema, {
        event: 'domain.transition'
      })
    ).toBe(1);
  });

  it('reads and clears an allowlist row', async () => {
    const { db, schema } = tdb;
    await repo.addAllowlist(db, schema, 'keep.com', 'rejected by user', 1);
    expect((await repo.getAllowlistRow(db, schema, 'keep.com'))?.reason).toBe(
      'rejected by user'
    );
    await repo.removeAllowlist(db, schema, 'keep.com');
    expect(await repo.getAllowlistRow(db, schema, 'keep.com')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/server/db/repo-reads.test.ts`
Expected: FAIL — the new `repo.*` functions are undefined.

- [ ] **Step 3: Implement — append to `src/lib/server/db/repo.ts`**

First, ensure the `drizzle-orm` import line includes everything used below:

```ts
import {
  and,
  asc,
  desc,
  eq,
  gte,
  like,
  lt,
  notInArray,
  sql
} from 'drizzle-orm';
```

(Keep `inArray` if still referenced by existing code — check the current line and merge, don't drop names.)

Add these type imports near the top (merge with the existing `import type` from `./types`):

```ts
import { DOMAIN_STATES } from './types';
import type {
  AllowlistRow,
  AuditLogRow,
  BlocklistFetchLogRow,
  CuratedListRow,
  SourceRateStateRow
} from './types';
```

Then append:

```ts
const QUEUE_BACKLOG_STATES: DomainState[] = ['observed', 'assessing'];

export async function countDomainsByState(
  db: any,
  schema: any
): Promise<Record<DomainState, number>> {
  const rows = await db
    .select({ state: schema.domains.state, n: sql<number>`count(*)` })
    .from(schema.domains)
    .groupBy(schema.domains.state);
  const out = Object.fromEntries(DOMAIN_STATES.map((s) => [s, 0])) as Record<
    DomainState,
    number
  >;
  for (const r of rows) out[r.state as DomainState] = Number(r.n);
  return out;
}

export async function countDomainsSince(
  db: any,
  schema: any,
  field: 'firstSeen',
  sinceMs: number
): Promise<number> {
  const col = schema.domains[field];
  const [r] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.domains)
    .where(gte(col, sinceMs));
  return Number(r.n);
}

export async function countDomainsInStateSince(
  db: any,
  schema: any,
  state: DomainState,
  field: 'decidedAt' | 'lastSeen',
  sinceMs: number
): Promise<number> {
  const col = schema.domains[field];
  const [r] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.domains)
    .where(and(eq(schema.domains.state, state), gte(col, sinceMs)));
  return Number(r.n);
}

export async function countPublished(db: any, schema: any): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.domains)
    .where(eq(schema.domains.state, 'approved'));
  return Number(r.n);
}

export async function listRecentBlocklistFetches(
  db: any,
  schema: any,
  limit: number
): Promise<BlocklistFetchLogRow[]> {
  return db
    .select()
    .from(schema.blocklistFetchLog)
    .orderBy(
      desc(schema.blocklistFetchLog.at),
      desc(schema.blocklistFetchLog.id)
    )
    .limit(limit);
}

export async function getCuratedLists(
  db: any,
  schema: any
): Promise<CuratedListRow[]> {
  return db
    .select()
    .from(schema.curatedLists)
    .orderBy(asc(schema.curatedLists.name));
}

export async function getAllSourceRateState(
  db: any,
  schema: any
): Promise<SourceRateStateRow[]> {
  return db.select().from(schema.sourceRateState);
}

export async function countVerdictsSince(
  db: any,
  schema: any,
  sinceMs: number
): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.verdicts)
    .where(gte(schema.verdicts.assessedAt, sinceMs));
  return Number(r.n);
}

export async function sumVerdictCostSince(
  db: any,
  schema: any,
  sinceMs: number
): Promise<number> {
  const [r] = await db
    .select({ s: sql<number | null>`sum(${schema.verdicts.costUsd})` })
    .from(schema.verdicts)
    .where(gte(schema.verdicts.assessedAt, sinceMs));
  return r.s == null ? 0 : Number(r.s);
}

export async function countBacklogForSource(
  db: any,
  schema: any,
  source: SourceName
): Promise<number> {
  const done = db
    .select({ id: schema.verdicts.domainId })
    .from(schema.verdicts)
    .where(eq(schema.verdicts.source, source));
  const [r] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.domains)
    .where(
      and(
        inArray(schema.domains.state, QUEUE_BACKLOG_STATES),
        notInArray(schema.domains.id, done)
      )
    );
  return Number(r.n);
}

function domainWhere(
  schema: any,
  opts: { search?: string; state?: DomainState }
) {
  const clauses = [];
  if (opts.state) clauses.push(eq(schema.domains.state, opts.state));
  if (opts.search)
    clauses.push(
      sql`lower(${schema.domains.domain}) like ${'%' + opts.search.toLowerCase() + '%'}`
    );
  return clauses.length ? and(...clauses) : undefined;
}

export async function searchDomains(
  db: any,
  schema: any,
  opts: { search?: string; state?: DomainState; limit: number; offset: number }
): Promise<(DomainRow & { verdictCount: number })[]> {
  const rows = await db
    .select({
      d: schema.domains,
      verdictCount: sql<number>`(select count(*) from ${schema.verdicts} where ${schema.verdicts.domainId} = ${schema.domains.id})`
    })
    .from(schema.domains)
    .where(domainWhere(schema, opts))
    .orderBy(desc(schema.domains.lastSeen), asc(schema.domains.domain))
    .limit(opts.limit)
    .offset(opts.offset);
  return rows.map((r: any) => ({
    ...r.d,
    verdictCount: Number(r.verdictCount)
  }));
}

export async function countDomainsMatching(
  db: any,
  schema: any,
  opts: { search?: string; state?: DomainState }
): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.domains)
    .where(domainWhere(schema, opts));
  return Number(r.n);
}

function auditWhere(
  schema: any,
  opts: { event?: string; actor?: string; since?: number; until?: number }
) {
  const c = [];
  if (opts.event) c.push(eq(schema.auditLog.event, opts.event));
  if (opts.actor) c.push(eq(schema.auditLog.actor, opts.actor));
  if (opts.since != null) c.push(gte(schema.auditLog.at, opts.since));
  if (opts.until != null) c.push(lt(schema.auditLog.at, opts.until));
  return c.length ? and(...c) : undefined;
}

export async function listAuditRows(
  db: any,
  schema: any,
  opts: {
    event?: string;
    actor?: string;
    since?: number;
    until?: number;
    limit: number;
    offset: number;
  }
): Promise<(AuditLogRow & { domain: string | null })[]> {
  const rows = await db
    .select({ a: schema.auditLog, domain: schema.domains.domain })
    .from(schema.auditLog)
    .leftJoin(schema.domains, eq(schema.auditLog.domainId, schema.domains.id))
    .where(auditWhere(schema, opts))
    .orderBy(desc(schema.auditLog.at), desc(schema.auditLog.id))
    .limit(opts.limit)
    .offset(opts.offset);
  return rows.map((r: any) => ({ ...r.a, domain: r.domain ?? null }));
}

export async function countAuditRows(
  db: any,
  schema: any,
  opts: { event?: string; actor?: string; since?: number; until?: number }
): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.auditLog)
    .where(auditWhere(schema, opts));
  return Number(r.n);
}

export async function getAllowlistRow(
  db: any,
  schema: any,
  domain: string
): Promise<AllowlistRow | undefined> {
  const [r] = await db
    .select()
    .from(schema.allowlist)
    .where(eq(schema.allowlist.domain, domain))
    .limit(1);
  return r;
}

export async function removeAllowlist(
  db: any,
  schema: any,
  domain: string
): Promise<void> {
  await db.delete(schema.allowlist).where(eq(schema.allowlist.domain, domain));
}
```

> **Note:** `domainWhere(schema, opts)` and `auditWhere(schema, opts)` return `undefined` when no filter is set — Drizzle's `.where(undefined)` is a no-op, so an unfiltered list returns everything. That is intended.

- [ ] **Step 4: Verify `inArray` is imported**

`countBacklogForSource` uses `inArray`. Confirm the `drizzle-orm` import line in `repo.ts` includes `inArray` (the existing file already imports it for `listQueuedDomains`). If not, add it.

- [ ] **Step 5: Run the test**

Run: `pnpm exec vitest run tests/server/db/repo-reads.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Both engines**

Run: `pnpm test` then (if a local Postgres is available) `pnpm test:pg`
Expected: PASS on both. The `sum()` / `count(*)` fragments and `like` are portable.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/db/repo.ts tests/server/db/repo-reads.test.ts
git commit -m "feat(sub2): read queries for dashboard/queue/domains/audit"
```

---

## Task 7: `dashboard.ts` read model

- [x] **TASK COMPLETE** — commits f3c0ea5..51635ad, review clean

**Files:**

- Create: `src/lib/server/pipeline/dashboard.ts`
- Test: `tests/server/pipeline/dashboard.test.ts`

**Interfaces:**

- Consumes: `repo.*` from Task 6; `now` from `../time`.
- Produces:
  - `interface DashboardView` — exactly the shape in spec §6, plus `sources: SourceQuotaSummary[]` where `SourceQuotaSummary = { source: SourceName; remainingDay: number | null; remainingMonth: number | null; pausedUntil: number | null }`.
  - `getDashboard(db, schema, nowMs?: number): Promise<DashboardView>`.
  - `WINDOW_MS = 86_400_000` (exported).

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/pipeline/dashboard.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '../../helpers/test-db';
import { getDashboard } from '../../../src/lib/server/pipeline/dashboard';

let tdb: TestDb;
const NOW = 1_000_000_000;
beforeEach(async () => (tdb = await makeTestDb()));
afterEach(() => tdb.close());

describe('getDashboard', () => {
  it('summarises pipeline state', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.domains).values([
      {
        domain: 'q1',
        firstSeen: NOW - 1000,
        lastSeen: NOW,
        hitCount: 5,
        state: 'pending_review',
        score: -0.6
      },
      {
        domain: 'q2',
        firstSeen: NOW - 2000,
        lastSeen: NOW,
        hitCount: 1,
        state: 'pending_review',
        score: -0.4
      },
      {
        domain: 'obs',
        firstSeen: NOW - 1000,
        lastSeen: NOW,
        hitCount: 1,
        state: 'observed'
      },
      {
        domain: 'old',
        firstSeen: NOW - 5 * 86_400_000,
        lastSeen: NOW,
        hitCount: 1,
        state: 'observed'
      },
      {
        domain: 'pub',
        firstSeen: NOW - 3000,
        lastSeen: NOW,
        hitCount: 1,
        state: 'approved',
        decidedAt: NOW - 100
      },
      {
        domain: 'cleared',
        firstSeen: NOW - 3000,
        lastSeen: NOW - 200,
        hitCount: 1,
        state: 'auto_cleared'
      }
    ]);
    const [d] = await db
      .select()
      .from(schema.domains)
      .where(schema.domains.domain ? undefined : undefined)
      .limit(1);
    await db.insert(schema.verdicts).values({
      domainId: d.id,
      source: 'ai',
      verdict: 'block',
      confidence: 0.8,
      category: null,
      detail: null,
      raw: {},
      assessedAt: NOW - 500,
      costUsd: 0.01
    });
    await db.insert(schema.blocklistFetchLog).values({
      at: NOW - 60_000,
      ip: '10.0.0.9',
      userAgent: 'AdGuardHome',
      status: 200
    });
    await db.insert(schema.curatedLists).values({
      name: 'oisd',
      url: 'https://x',
      lastFetched: NOW - 3600_000,
      entryCount: 100000,
      lastError: null
    });
    await db.insert(schema.sourceRateState).values({
      source: 'metadefender',
      tokens: 10,
      lastRefill: NOW,
      dayCount: 40,
      dayStart: NOW,
      monthCount: 40,
      monthStart: NOW,
      lastCallAt: NOW - 1000,
      pausedUntil: null
    });

    const v = await getDashboard(db, schema, NOW);
    expect(v.counts.pending_review).toBe(2);
    expect(v.counts.observed).toBe(2);
    expect(v.publishedCount).toBe(1);
    expect(v.observed24h).toBe(3); // q1? no — firstSeen within 24h: q1,q2,obs,pub,cleared minus 'old'; observed24h counts ALL domains first-seen in window
    expect(v.autoCleared24h).toBe(1);
    expect(v.verdictsToday).toBe(1);
    expect(v.aiCostTodayUsd).toBeCloseTo(0.01);
    expect(v.lastPull?.status).toBe(200);
    expect(v.recentPulls).toHaveLength(1);
    expect(v.curatedLists[0].name).toBe('oisd');
    expect(v.sources.find((s) => s.source === 'metadefender')).toBeTruthy();
  });

  it('returns null lastPull when nothing has fetched', async () => {
    const v = await getDashboard(tdb.db, tdb.schema, NOW);
    expect(v.lastPull).toBeNull();
    expect(v.recentPulls).toEqual([]);
    expect(v.aiCostTodayUsd).toBe(0);
  });
});
```

> Fix the `observed24h` expectation to match your final definition: it counts **every** domain with `firstSeen >= now - WINDOW_MS`, regardless of current state. In the seed that is `q1, q2, obs, pub, cleared` = 5. Set `expect(v.observed24h).toBe(5)`. Also replace the awkward `.where(... ? undefined : undefined)` with a real fetch: `const [d] = await db.select().from(schema.domains).limit(1);`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/server/pipeline/dashboard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/server/pipeline/dashboard.ts
import * as repo from '../db/repo';
import { SOURCE_NAMES } from '../db/types';
import type { DomainState, SourceName } from '../db/types';
import { now } from '../time';

export const WINDOW_MS = 86_400_000;

export interface SourceQuotaSummary {
  source: SourceName;
  remainingDay: number | null;
  remainingMonth: number | null;
  pausedUntil: number | null;
}

export interface DashboardView {
  counts: Record<DomainState, number>;
  observed24h: number;
  autoCleared24h: number;
  publishedCount: number;
  verdictsToday: number;
  aiCostTodayUsd: number;
  lastPull: { at: number; ip: string; status: number } | null;
  recentPulls: { at: number; status: number }[];
  curatedLists: {
    name: string;
    lastFetched: number | null;
    entryCount: number;
    lastError: string | null;
  }[];
  sources: SourceQuotaSummary[];
}

export async function getDashboard(
  db: any,
  schema: any,
  nowMs: number = now()
): Promise<DashboardView> {
  const since = nowMs - WINDOW_MS;
  const [
    counts,
    observed24h,
    autoCleared24h,
    publishedCount,
    verdictsToday,
    aiCostTodayUsd,
    fetches,
    curated,
    rateRows
  ] = await Promise.all([
    repo.countDomainsByState(db, schema),
    repo.countDomainsSince(db, schema, 'firstSeen', since),
    repo.countDomainsInStateSince(
      db,
      schema,
      'auto_cleared',
      'lastSeen',
      since
    ),
    repo.countPublished(db, schema),
    repo.countVerdictsSince(db, schema, since),
    repo.sumVerdictCostSince(db, schema, since),
    repo.listRecentBlocklistFetches(db, schema, 10),
    repo.getCuratedLists(db, schema),
    repo.getAllSourceRateState(db, schema)
  ]);

  const byName = new Map(rateRows.map((r: any) => [r.source, r]));
  const sources: SourceQuotaSummary[] = SOURCE_NAMES.filter(
    (s) => s !== 'curated_list'
  ).map((source) => {
    const r: any = byName.get(source);
    return {
      source,
      remainingDay: r ? Math.max(0, quotaDay(source) - r.dayCount) : null,
      remainingMonth: r ? Math.max(0, quotaMonth(source) - r.monthCount) : null,
      pausedUntil: r?.pausedUntil ?? null
    };
  });

  return {
    counts,
    observed24h,
    autoCleared24h,
    publishedCount,
    verdictsToday,
    aiCostTodayUsd,
    lastPull: fetches[0]
      ? { at: fetches[0].at, ip: fetches[0].ip, status: fetches[0].status }
      : null,
    recentPulls: fetches.map((f: any) => ({ at: f.at, status: f.status })),
    curatedLists: curated.map((c: any) => ({
      name: c.name,
      lastFetched: c.lastFetched,
      entryCount: c.entryCount,
      lastError: c.lastError
    })),
    sources
  };
}

// Free-tier ceilings, mirrored from master-requirements §9. Settings (#4) will make
// these editable; until then they are display-only reference numbers.
// ponytail: hard-coded ceilings, move to config when Settings lands.
function quotaDay(s: SourceName): number {
  return s === 'metadefender' ? 4000 : s === 'virustotal' ? 500 : 100000;
}
function quotaMonth(s: SourceName): number {
  return s === 'virustotal' ? 15500 : quotaDay(s) * 31;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/server/pipeline/dashboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/pipeline/dashboard.ts tests/server/pipeline/dashboard.test.ts
git commit -m "feat(sub2): dashboard read model"
```

---

## Task 8: `queue.ts` read model

- [x] **TASK COMPLETE** — commits 51635ad..66632ba, review clean (1 fix round: totalBacklog := distinct observed/assessing count — ruling in ledger)

**Files:**

- Create: `src/lib/server/pipeline/queue.ts`
- Test: `tests/server/pipeline/queue.test.ts`

**Interfaces:**

- Consumes: `repo.countBacklogForSource`, `repo.getAllSourceRateState`, `repo.getIngestState`; `getInFocus` from `../events`; `SOURCE_NAMES` from `../db/types`; `now`.
- Produces:
  - `interface QueueView` — spec §6 shape.
  - `getQueue(db, schema, nowMs?: number): Promise<QueueView>`.
  - `amortizedIntervalMs(source: SourceName): number` (exported, pure) — `max(DAY/quotaDay, MONTH/quotaMonth)`; `curated_list` → `0`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/pipeline/queue.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '../../helpers/test-db';
import {
  getQueue,
  amortizedIntervalMs
} from '../../../src/lib/server/pipeline/queue';
import { publish, _resetForTest } from '../../../src/lib/server/events';

let tdb: TestDb;
const NOW = 2_000_000_000;
beforeEach(async () => (tdb = await makeTestDb()));
afterEach(() => {
  _resetForTest();
  tdb.close();
});

describe('getQueue', () => {
  it('reports per-source backlog, ETA and the in-focus domain', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.domains).values([
      {
        domain: 'a',
        firstSeen: 1,
        lastSeen: 1,
        hitCount: 3,
        state: 'observed'
      },
      {
        domain: 'b',
        firstSeen: 2,
        lastSeen: 2,
        hitCount: 1,
        state: 'assessing'
      }
    ]);
    await db.insert(schema.sourceRateState).values({
      source: 'metadefender',
      tokens: 5,
      lastRefill: NOW,
      dayCount: 0,
      dayStart: NOW,
      monthCount: 0,
      monthStart: NOW,
      lastCallAt: NOW - 60_000,
      pausedUntil: null
    });
    publish({ type: 'assess.start', source: 'metadefender', domain: 'a' });

    const v = await getQueue(db, schema, NOW);
    const md = v.sources.find((s) => s.source === 'metadefender')!;
    expect(md.backlog).toBe(2);
    expect(md.inFocus).toBe('a');
    expect(md.etaMs).toBe(2 * amortizedIntervalMs('metadefender'));
    expect(md.nextCallAt).toBe(
      NOW - 60_000 + amortizedIntervalMs('metadefender')
    );

    const curated = v.sources.find((s) => s.source === 'curated_list')!;
    expect(curated.inline).toBe(true);
    expect(curated.etaMs).toBeNull();

    expect(v.totalBacklog).toBe(2);
    expect(v.ingestion.firstRunDone).toBe(false);
  });

  it('flags a paused source and drained backlog', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.sourceRateState).values({
      source: 'ai',
      tokens: 0,
      lastRefill: NOW,
      dayCount: 0,
      dayStart: NOW,
      monthCount: 0,
      monthStart: NOW,
      lastCallAt: null,
      pausedUntil: NOW + 3600_000
    });
    const v = await getQueue(db, schema, NOW);
    const ai = v.sources.find((s) => s.source === 'ai')!;
    expect(ai.backlog).toBe(0);
    expect(ai.etaMs).toBeNull();
    expect(ai.pausedUntil).toBe(NOW + 3600_000);
    expect(ai.nextCallAt).toBe(NOW); // no lastCallAt → now
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/server/pipeline/queue.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/server/pipeline/queue.ts
import * as repo from '../db/repo';
import { SOURCE_NAMES } from '../db/types';
import type { SourceName } from '../db/types';
import { getInFocus } from '../events';
import { now } from '../time';

const DAY = 86_400_000;
const MONTH = DAY * 31;

// ponytail: reference free-tier ceilings, same numbers as dashboard.ts; Settings (#4)
// makes them editable and this module reads them from config instead.
function quotaDay(s: SourceName): number {
  return s === 'metadefender' ? 4000 : s === 'virustotal' ? 500 : 100_000;
}
function quotaMonth(s: SourceName): number {
  return s === 'virustotal' ? 15_500 : quotaDay(s) * 31;
}

export function amortizedIntervalMs(source: SourceName): number {
  if (source === 'curated_list') return 0;
  return Math.max(DAY / quotaDay(source), MONTH / quotaMonth(source));
}

export interface QueueSourceView {
  source: SourceName;
  inline: boolean;
  backlog: number;
  amortizedIntervalMs: number | null;
  nextCallAt: number | null;
  remainingDay: number | null;
  remainingMonth: number | null;
  pausedUntil: number | null;
  lastError: string | null;
  etaMs: number | null;
  inFocus: string | null;
}

export interface QueueView {
  sources: QueueSourceView[];
  ingestion: {
    lastIngestAt: number | null;
    cursor: string | null;
    firstRunDone: boolean;
    nextRunAt: number | null;
  };
  totalBacklog: number;
}

export async function getQueue(
  db: any,
  schema: any,
  nowMs: number = now()
): Promise<QueueView> {
  const [rateRows, ingest] = await Promise.all([
    repo.getAllSourceRateState(db, schema),
    repo.getIngestState(db, schema)
  ]);
  const rateByName = new Map(rateRows.map((r: any) => [r.source, r]));
  const focus = getInFocus();

  const sources: QueueSourceView[] = [];
  let totalBacklog = 0;

  for (const source of SOURCE_NAMES) {
    const inline = source === 'curated_list';
    const backlog = await repo.countBacklogForSource(db, schema, source);
    if (!inline) totalBacklog += backlog;
    const r: any = rateByName.get(source);
    const interval = inline ? 0 : amortizedIntervalMs(source);
    const etaMs = inline || backlog === 0 ? null : backlog * interval;
    sources.push({
      source,
      inline,
      backlog,
      amortizedIntervalMs: inline ? null : interval,
      nextCallAt: inline
        ? null
        : r?.lastCallAt
          ? r.lastCallAt + interval
          : nowMs,
      remainingDay: r ? Math.max(0, quotaDay(source) - r.dayCount) : null,
      remainingMonth: r ? Math.max(0, quotaMonth(source) - r.monthCount) : null,
      pausedUntil: r?.pausedUntil ?? null,
      lastError: null,
      etaMs,
      inFocus: focus[source] ?? null
    });
  }

  const intervalMin = Number(process.env.VB_INGEST_INTERVAL_MIN ?? 15);
  return {
    sources,
    ingestion: {
      lastIngestAt: ingest.lastIngestAt ?? null,
      cursor: ingest.cursor ?? null,
      firstRunDone: !!ingest.firstRunDone,
      nextRunAt: ingest.lastIngestAt
        ? ingest.lastIngestAt + intervalMin * 60_000
        : null
    },
    totalBacklog
  };
}
```

> `lastError` is always `null` for now — `source_rate_state` has no error column and the drainer records source errors as `assess.error` audit rows, not on the rate row. Keeping the field means the screen and the `QueueSourceView` type do not change when #4 adds a real error surface. Do not try to populate it from the audit log here.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/server/pipeline/queue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/pipeline/queue.ts tests/server/pipeline/queue.test.ts
git commit -m "feat(sub2): queue read model"
```

---

## Task 9: `domains.ts` read model

- [x] **TASK COMPLETE** — commits 66632ba..68a1e22, review clean

**Files:**

- Create: `src/lib/server/pipeline/domains.ts`
- Test: `tests/server/pipeline/domains.test.ts`

**Interfaces:**

- Consumes: `repo.searchDomains`, `repo.countDomainsMatching`.
- Produces:
  - `interface DomainListItem` — spec §6 shape (`domain, state, score, hitCount, firstSeen, lastSeen, decidedAt, verdictCount`).
  - `interface DomainListResult { items: DomainListItem[]; total: number; page: number; pageCount: number; pageSize: number }`.
  - `PAGE_SIZE = 50` (exported).
  - `listDomains(db, schema, opts: { search?: string; state?: DomainState; page?: number }): Promise<DomainListResult>` — `page` is 1-based, clamped to `>= 1`; `offset = (page - 1) * PAGE_SIZE`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/pipeline/domains.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '../../helpers/test-db';
import {
  listDomains,
  PAGE_SIZE
} from '../../../src/lib/server/pipeline/domains';

let tdb: TestDb;
beforeEach(async () => (tdb = await makeTestDb()));
afterEach(() => tdb.close());

describe('listDomains', () => {
  it('paginates and reports page math', async () => {
    const { db, schema } = tdb;
    const rows = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => ({
      domain: `d${String(i).padStart(3, '0')}.com`,
      firstSeen: 1000 + i,
      lastSeen: 2000 + i,
      hitCount: i,
      state: 'observed' as const
    }));
    await db.insert(schema.domains).values(rows);

    const p1 = await listDomains(db, schema, {});
    expect(p1.items).toHaveLength(PAGE_SIZE);
    expect(p1.total).toBe(PAGE_SIZE + 5);
    expect(p1.pageCount).toBe(2);
    expect(p1.page).toBe(1);

    const p2 = await listDomains(db, schema, { page: 2 });
    expect(p2.items).toHaveLength(5);
    expect(p2.page).toBe(2);
  });

  it('filters by search and state', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.domains).values([
      {
        domain: 'tracker.ads.net',
        firstSeen: 1,
        lastSeen: 9,
        hitCount: 1,
        state: 'pending_review',
        score: -0.5
      },
      {
        domain: 'safe.example',
        firstSeen: 2,
        lastSeen: 8,
        hitCount: 1,
        state: 'observed'
      }
    ]);
    const s = await listDomains(db, schema, { search: 'ADS' });
    expect(s.items.map((i) => i.domain)).toEqual(['tracker.ads.net']);
    const st = await listDomains(db, schema, { state: 'observed' });
    expect(st.items.map((i) => i.domain)).toEqual(['safe.example']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/server/pipeline/domains.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/server/pipeline/domains.ts
import * as repo from '../db/repo';
import type { DomainState } from '../db/types';

export const PAGE_SIZE = 50;

export interface DomainListItem {
  domain: string;
  state: DomainState;
  score: number | null;
  hitCount: number;
  firstSeen: number;
  lastSeen: number;
  decidedAt: number | null;
  verdictCount: number;
}

export interface DomainListResult {
  items: DomainListItem[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

export async function listDomains(
  db: any,
  schema: any,
  opts: { search?: string; state?: DomainState; page?: number }
): Promise<DomainListResult> {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const filter = {
    search: opts.search?.trim() || undefined,
    state: opts.state
  };
  const [rows, total] = await Promise.all([
    repo.searchDomains(db, schema, {
      ...filter,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE
    }),
    repo.countDomainsMatching(db, schema, filter)
  ]);
  return {
    items: rows.map((r) => ({
      domain: r.domain,
      state: r.state as DomainState,
      score: r.score,
      hitCount: r.hitCount,
      firstSeen: r.firstSeen,
      lastSeen: r.lastSeen,
      decidedAt: r.decidedAt,
      verdictCount: r.verdictCount
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    pageSize: PAGE_SIZE
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/server/pipeline/domains.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/pipeline/domains.ts tests/server/pipeline/domains.test.ts
git commit -m "feat(sub2): domains read model"
```

---

## Task 10: `audit.ts` read model

- [x] **TASK COMPLETE** — commits 68a1e22..36e4afb, review clean

**Files:**

- Create: `src/lib/server/pipeline/audit.ts`
- Test: `tests/server/pipeline/audit.test.ts`

**Interfaces:**

- Consumes: `repo.listAuditRows`, `repo.countAuditRows`.
- Produces:
  - `interface AuditEntry { id: number; at: number; actor: string; event: string; domain: string | null; data: unknown }`.
  - `interface AuditListResult { items: AuditEntry[]; total: number; page: number; pageCount: number; pageSize: number }`.
  - `AUDIT_PAGE_SIZE = 50` (exported).
  - `listAudit(db, schema, opts: { event?: string; actor?: string; since?: number; until?: number; page?: number }): Promise<AuditListResult>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/pipeline/audit.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '../../helpers/test-db';
import { listAudit } from '../../../src/lib/server/pipeline/audit';

let tdb: TestDb;
beforeEach(async () => (tdb = await makeTestDb()));
afterEach(() => tdb.close());

describe('listAudit', () => {
  it('returns newest-first with the domain name joined and filters by event', async () => {
    const { db, schema } = tdb;
    const [d] = await db
      .insert(schema.domains)
      .values({
        domain: 'x.ads.io',
        firstSeen: 1,
        lastSeen: 1,
        hitCount: 1,
        state: 'approved'
      })
      .returning();
    await db.insert(schema.auditLog).values([
      {
        at: 100,
        actor: 'system',
        domainId: d.id,
        event: 'domain.transition',
        data: { to: 'pending_review' }
      },
      {
        at: 200,
        actor: 'user',
        domainId: d.id,
        event: 'decision.approve',
        data: { note: 'bad' }
      },
      {
        at: 150,
        actor: 'metadefender',
        domainId: null,
        event: 'assess.error',
        data: { msg: 'timeout' }
      }
    ]);

    const all = await listAudit(db, schema, {});
    expect(all.items.map((e) => e.at)).toEqual([200, 150, 100]);
    expect(all.items[0].domain).toBe('x.ads.io');
    expect(all.items[1].domain).toBeNull();
    expect(all.total).toBe(3);

    const decisions = await listAudit(db, schema, {
      event: 'decision.approve'
    });
    expect(decisions.items).toHaveLength(1);
    expect(decisions.items[0].data).toEqual({ note: 'bad' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/server/pipeline/audit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/server/pipeline/audit.ts
import * as repo from '../db/repo';

export const AUDIT_PAGE_SIZE = 50;

export interface AuditEntry {
  id: number;
  at: number;
  actor: string;
  event: string;
  domain: string | null;
  data: unknown;
}

export interface AuditListResult {
  items: AuditEntry[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

export async function listAudit(
  db: any,
  schema: any,
  opts: {
    event?: string;
    actor?: string;
    since?: number;
    until?: number;
    page?: number;
  }
): Promise<AuditListResult> {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const filter = {
    event: opts.event || undefined,
    actor: opts.actor || undefined,
    since: opts.since,
    until: opts.until
  };
  const [rows, total] = await Promise.all([
    repo.listAuditRows(db, schema, {
      ...filter,
      limit: AUDIT_PAGE_SIZE,
      offset: (page - 1) * AUDIT_PAGE_SIZE
    }),
    repo.countAuditRows(db, schema, filter)
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      at: r.at,
      actor: r.actor,
      event: r.event,
      domain: r.domain,
      data: r.data
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
    pageSize: AUDIT_PAGE_SIZE
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/server/pipeline/audit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/pipeline/audit.ts tests/server/pipeline/audit.test.ts
git commit -m "feat(sub2): audit read model"
```

---

## Task 11: Extend `getReviewDetail`

- [x] **TASK COMPLETE** — commits 36e4afb..07d2f96, review clean

**Files:**

- Modify: `src/lib/server/pipeline/review.ts`
- Test: `tests/server/pipeline/review.test.ts` (add a case)

**Interfaces:**

- Consumes: `repo.getAllowlistRow`.
- Produces: `ReviewDetail` gains two fields:
  - `allowlist: { reason: string; addedAt: number } | null`
  - `rawBySource: Record<string, unknown>` — `{ [source]: verdictRow.raw }` for the raw-JSON disclosure.
    `verdictsFull` already carries `detail`; no change there.

- [ ] **Step 1: Write the failing test — add to `tests/server/pipeline/review.test.ts`**

```ts
it('getReviewDetail includes allowlist row and raw-by-source', async () => {
  const { db, schema } = tdb; // use the file's existing TestDb handle
  const [d] = await db
    .insert(schema.domains)
    .values({
      domain: 'gone.example',
      firstSeen: 1,
      lastSeen: 2,
      hitCount: 1,
      state: 'rejected',
      decidedAt: 3
    })
    .returning();
  await db.insert(schema.verdicts).values({
    domainId: d.id,
    source: 'ai',
    verdict: 'allow',
    confidence: 0.4,
    category: null,
    detail: 'benign',
    raw: { model: 'local', tokens: 12 },
    assessedAt: 2
  });
  await db
    .insert(schema.allowlist)
    .values({ domain: 'gone.example', reason: 'rejected by user', addedAt: 3 });

  const detail = await getReviewDetail(db, schema, 'gone.example');
  expect(detail?.allowlist).toEqual({ reason: 'rejected by user', addedAt: 3 });
  expect(detail?.rawBySource.ai).toEqual({ model: 'local', tokens: 12 });
});
```

(Match the surrounding test file's setup style — it already builds a `TestDb` in `beforeEach`. Import `getReviewDetail` if not already imported.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/server/pipeline/review.test.ts`
Expected: FAIL — `allowlist` / `rawBySource` are `undefined`.

- [ ] **Step 3: Implement the extension**

In `src/lib/server/pipeline/review.ts`:

- add `import` for the repo function if needed (the file already does `import * as repo from '../db/repo';`).
- extend the `ReviewDetail` interface:

```ts
export interface ReviewDetail extends ReviewListItem {
  firstSeen: number;
  lastSeen: number;
  state: DomainState;
  verdictsFull: VerdictRow[];
  audit: { at: number; actor: string; event: string; data: unknown }[];
  allowlist: { reason: string; addedAt: number } | null;
  rawBySource: Record<string, unknown>;
}
```

- in `getReviewDetail`, after `const vs = await repo.listVerdictsForDomain(db, schema, d.id);` add:

```ts
const allow = await repo.getAllowlistRow(db, schema, domain);
```

- in the returned object add:

```ts
    allowlist: allow ? { reason: allow.reason, addedAt: allow.addedAt } : null,
    rawBySource: Object.fromEntries(vs.map((v) => [v.source, v.raw]))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/server/pipeline/review.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + coverage**

Run: `pnpm test:cov`
Expected: PASS, gate ≥ 90 % (all read models now have tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/pipeline/review.ts tests/server/pipeline/review.test.ts
git commit -m "feat(sub2): getReviewDetail returns allowlist + raw-by-source"
```

---

## Task 12: Token layer

- [x] **TASK COMPLETE** — commits 3c19170..4ddbb1c, review clean

**Files:**

- Create: `src/lib/design/tokens.css`

**Interfaces:**

- Consumes: nothing.
- Produces: `tokens.css` — CSS custom properties on `:root` (light) with a `@media (prefers-color-scheme: dark)` override. No JS: the OS setting is the theme. A manual toggle, if ever wanted, is sub-project #4 (settings) — do not build one here. Token names below are the contract for every component.

- [ ] **Step 1: Write `tokens.css`**

```css
/* src/lib/design/tokens.css — "The Disposition Log" token layer.
   Every component reads these names; no component hard-codes a colour.
   Dark is the OS setting via @media — there is no JS theme switch. */
:root {
  --vb-ground: #f2eee3;
  --vb-ground-raised: #fbf9f3;
  --vb-ground-sunk: #e9e3d3;
  --vb-ink: #1e2a32;
  --vb-ink-soft: #566169;
  --vb-ink-faint: #8b9198;
  --vb-rule: #d8d0c0;
  --vb-rule-strong: #b9ae98;
  --vb-accent: #b4472e;
  --vb-accent-ink: #ffffff;

  --vb-st-observed: #8a7e68;
  --vb-st-assessing: #b6801f;
  --vb-st-pending_review: #2e63a8;
  --vb-st-auto_cleared: #9a9488;
  --vb-st-approved: #2f7d4f;
  --vb-st-rejected: #7c7c7c;

  --vb-s1: 4px;
  --vb-s2: 8px;
  --vb-s3: 12px;
  --vb-s4: 16px;
  --vb-s5: 24px;
  --vb-s6: 40px;

  --vb-fs-micro: 11px;
  --vb-fs-small: 12.5px;
  --vb-fs-body: 14px;
  --vb-fs-h3: 16px;
  --vb-fs-h2: 20px;
  --vb-fs-h1: 26px;

  --vb-font-mono:
    ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono',
    monospace;
  --vb-font-sans:
    system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --vb-font-head: 'Arial Narrow', 'Roboto Condensed', var(--vb-font-sans);
  --vb-head-stretch: 85%;

  --vb-radius: 2px;
  --vb-line: 1px solid var(--vb-rule);
  --vb-motion: 140ms ease-out;
  --vb-shadow-sheet: -8px 0 32px rgba(20, 24, 27, 0.18);
}

@media (prefers-color-scheme: dark) {
  :root {
    --vb-ground: #14181b;
    --vb-ground-raised: #1b2024;
    --vb-ground-sunk: #101416;
    --vb-ink: #e7e0d2;
    --vb-ink-soft: #a0a6a8;
    --vb-ink-faint: #6d7477;
    --vb-rule: #2c3236;
    --vb-rule-strong: #3c444a;
    --vb-accent: #d6674b;
    --vb-accent-ink: #14181b;
    --vb-st-observed: #a99a7e;
    --vb-st-assessing: #d19a3a;
    --vb-st-pending_review: #5b91d6;
    --vb-st-auto_cleared: #7f8a8f;
    --vb-st-approved: #4fa571;
    --vb-st-rejected: #9aa0a2;
    --vb-shadow-sheet: -8px 0 32px rgba(0, 0, 0, 0.45);
  }
}

* {
  box-sizing: border-box;
}
html {
  color-scheme: light dark;
}
body {
  margin: 0;
  background: var(--vb-ground);
  color: var(--vb-ink);
  font: var(--vb-fs-body) / 1.5 var(--vb-font-sans);
}
@media (prefers-reduced-motion: reduce) {
  * {
    transition: none !important;
    animation: none !important;
  }
}
```

- [ ] **Step 2: Verify it imports**

`tokens.css` is imported by `+layout.svelte` in Task 17. For now just confirm it is valid CSS: `pnpm exec prettier --check src/lib/design/tokens.css` (or eyeball it). No test — CSS custom properties have nothing to unit-test.

- [ ] **Step 3: Commit**

```bash
git add src/lib/design/tokens.css
git commit -m "feat(sub2): disposition-log token layer (OS dark mode, no JS switch)"
```

---

## Task 13: Primitive components

- [x] **TASK COMPLETE** — commits 4ddbb1c..e985c46, review clean

**Files:**

- Create: `src/lib/components/Stamp.svelte`
- Create: `src/lib/components/StatusEdge.svelte`
- Create: `src/lib/components/ScoreBracket.svelte`
- Create: `src/lib/components/RelativeTime.svelte`
- Create: `src/lib/components/EmptyState.svelte`
- Create: `src/lib/components/SseStatus.svelte`
- Create: `src/lib/components/Masthead.svelte`

**Interfaces:**

- Consumes: `src/lib/format.ts`.
- Produces (props are the contract for later tasks):
  - `Stamp`: `{ text: string; tone?: 'accent' | 'muted' | 'ok' }` — default `accent`.
  - `StatusEdge`: `{ state: DomainState; label?: string }` — renders a 3px left bar in `var(--vb-st-<state>)` plus an sr-only text label (`label` overrides `stateLabel(state)`).
  - `ScoreBracket`: `{ score: number | null; verdicts: { source: string; verdict: string; confidence: number }[] }` — chips per verdict, a bracket/leader line to the summed score + its `scoreLabel` text.
  - `RelativeTime`: `{ at: number | null }` — `<time datetime>` with `relativeTime`, computed once at render. No timer: every screen that shows one already reloads on SSE or the 20 s poll, which re-renders it.
  - `EmptyState`: `{ title: string; hint?: string }` + a `children` snippet slot for an action.
  - `SseStatus`: `{ state: 'connecting' | 'live' | 'down' }`.
  - `Masthead`: `{ title: string; counts: { label: string; value: string | number }[] }`.

- [ ] **Step 1: Write `Stamp.svelte`**

```svelte
<script lang="ts">
  let { text, tone = 'accent' }: { text: string; tone?: 'accent' | 'muted' | 'ok' } = $props();
</script>

<span class="stamp {tone}" aria-label="disposition: {text}">{text}</span>

<style>
  .stamp {
    display: inline-block;
    font: 700 var(--vb-fs-micro) / 1 var(--vb-font-head);
    font-stretch: var(--vb-head-stretch);
    letter-spacing: 0.08em;
    padding: 3px 6px 2px;
    border: 1.5px solid currentColor;
    border-radius: var(--vb-radius);
    transform: rotate(-2deg);
    text-transform: uppercase;
    opacity: 0.92;
  }
  .accent { color: var(--vb-accent); }
  .muted { color: var(--vb-ink-faint); }
  .ok { color: var(--vb-st-approved); }
</style>
```

- [ ] **Step 2: Write `StatusEdge.svelte`**

```svelte
<script lang="ts">
  import type { DomainState } from '$lib/server/db/types';
  import { stateLabel } from '$lib/format';
  let { state, label }: { state: DomainState; label?: string } = $props();
</script>

<span class="edge" style="--edge: var(--vb-st-{state})" aria-hidden="true"></span>
<span class="sr-only">{label ?? stateLabel(state)}</span>

<style>
  .edge {
    display: inline-block;
    width: 3px;
    align-self: stretch;
    min-height: 1.2em;
    background: var(--edge);
    border-radius: 2px;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
</style>
```

- [ ] **Step 3: Write `ScoreBracket.svelte`**

```svelte
<script lang="ts">
  import { scoreLabel, verdictLabel } from '$lib/format';
  let {
    score,
    verdicts
  }: {
    score: number | null;
    verdicts: { source: string; verdict: string; confidence: number }[];
  } = $props();
  const label = $derived(scoreLabel(score));
</script>

<div class="bracket">
  <ul class="inputs">
    {#each verdicts as v (v.source)}
      <li class="chip" data-tone={v.verdict}>
        <span class="src">{v.source}</span>
        <span class="val">{verdictLabel(v.verdict as any)} · {v.confidence.toFixed(2)}</span>
      </li>
    {/each}
  </ul>
  <div class="lead" aria-hidden="true"></div>
  <div class="sum" data-tone={label.tone}>
    <span class="num">{score === null ? '—' : score.toFixed(2)}</span>
    <span class="txt">{label.text}</span>
  </div>
</div>

<style>
  .bracket { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: var(--vb-s3); }
  .inputs { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--vb-s2); }
  .chip { font: var(--vb-fs-micro) / 1.3 var(--vb-font-mono); border: var(--vb-line); border-radius: var(--vb-radius); padding: 2px 6px; }
  .chip .src { color: var(--vb-ink-soft); margin-right: 4px; }
  .chip[data-tone='block'] { border-color: var(--vb-st-approved); }
  .chip[data-tone='allow'] { border-color: var(--vb-st-pending_review); }
  .lead { width: 24px; height: 1px; background: var(--vb-rule-strong); }
  .sum { text-align: right; font-family: var(--vb-font-mono); }
  .sum .num { font-size: var(--vb-fs-h3); font-weight: 700; display: block; }
  .sum .txt { font-size: var(--vb-fs-micro); color: var(--vb-ink-soft); text-transform: uppercase; letter-spacing: 0.06em; }
  .sum[data-tone='block'] .num { color: var(--vb-accent); }
  @media (max-width: 640px) {
    .bracket { grid-template-columns: 1fr; }
    .lead { display: none; }
    .sum { text-align: left; }
  }
</style>
```

- [ ] **Step 4: Write `RelativeTime.svelte`**

```svelte
<script lang="ts">
  import { relativeTime } from '$lib/format';
  let { at }: { at: number | null } = $props();
</script>

{#if at}
  <time datetime={new Date(at).toISOString()}>{relativeTime(at)}</time>
{:else}
  <time>never</time>
{/if}
```

- [ ] **Step 5: Write `EmptyState.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  let {
    title,
    hint,
    children
  }: { title: string; hint?: string; children?: Snippet } = $props();
</script>

<div class="empty">
  <p class="title">{title}</p>
  {#if hint}<p class="hint">{hint}</p>{/if}
  {#if children}<div class="action">{@render children()}</div>{/if}
</div>

<style>
  .empty { text-align: center; padding: var(--vb-s6) var(--vb-s4); color: var(--vb-ink-soft); }
  .title { font: 700 var(--vb-fs-h3) / 1.2 var(--vb-font-head); font-stretch: var(--vb-head-stretch); letter-spacing: 0.04em; text-transform: uppercase; color: var(--vb-ink); margin: 0 0 var(--vb-s2); }
  .hint { margin: 0; font-size: var(--vb-fs-small); }
  .action { margin-top: var(--vb-s4); }
</style>
```

- [ ] **Step 6: Write `SseStatus.svelte`**

```svelte
<script lang="ts">
  let { state }: { state: 'connecting' | 'live' | 'down' } = $props();
  const label = { connecting: 'connecting', live: 'live', down: 'reconnecting' }[state];
</script>

<span class="sse" data-state={state} title="live updates: {label}">
  <span class="dot" aria-hidden="true"></span>{label}
</span>

<style>
  .sse { display: inline-flex; align-items: center; gap: 6px; font: var(--vb-fs-micro) / 1 var(--vb-font-mono); text-transform: uppercase; letter-spacing: 0.06em; color: var(--vb-ink-soft); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--vb-ink-faint); }
  .sse[data-state='live'] .dot { background: var(--vb-st-approved); }
  .sse[data-state='down'] .dot { background: var(--vb-accent); }
  .sse[data-state='connecting'] .dot { background: var(--vb-st-assessing); }
</style>
```

- [ ] **Step 7: Write `Masthead.svelte`**

```svelte
<script lang="ts">
  let {
    title,
    counts
  }: { title: string; counts: { label: string; value: string | number }[] } = $props();
</script>

<header class="mast">
  <h1>{title}</h1>
  <dl class="counts">
    {#each counts as c (c.label)}
      <div><dt>{c.label}</dt><dd>{c.value}</dd></div>
    {/each}
  </dl>
</header>

<style>
  .mast { border-bottom: 2px solid var(--vb-rule-strong); padding-bottom: var(--vb-s3); margin-bottom: var(--vb-s5); }
  h1 { font: 700 var(--vb-fs-h1) / 1.1 var(--vb-font-head); font-stretch: var(--vb-head-stretch); letter-spacing: 0.06em; text-transform: uppercase; margin: 0 0 var(--vb-s3); }
  .counts { display: flex; flex-wrap: wrap; gap: var(--vb-s5); margin: 0; }
  .counts dt { font: var(--vb-fs-micro) / 1 var(--vb-font-mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--vb-ink-soft); margin-bottom: 4px; }
  .counts dd { font: 700 var(--vb-fs-h2) / 1 var(--vb-font-mono); margin: 0; }
</style>
```

- [ ] **Step 8: Add `.sr-only` once globally + verify**

`StatusEdge` ships its own `.sr-only`. Leave it; it is scoped per component. Run:

```bash
pnpm check
```

Expected: PASS — all seven components typecheck. (No unit tests here; Playwright covers them in Task 24.)

- [ ] **Step 9: Commit**

```bash
git add src/lib/components/Stamp.svelte src/lib/components/StatusEdge.svelte src/lib/components/ScoreBracket.svelte src/lib/components/RelativeTime.svelte src/lib/components/EmptyState.svelte src/lib/components/SseStatus.svelte src/lib/components/Masthead.svelte
git commit -m "feat(sub2): primitive components for the disposition-log kit"
```

---

## Task 14: Table, pagination, select

- [x] **TASK COMPLETE** — commits e985c46..e3b74bf, review clean

**Files:**

- Create: `src/lib/components/LogTable.svelte`
- Create: `src/lib/components/Pagination.svelte`
- Create: `src/lib/components/Select.svelte`

> **Scope notes:** (1) the spec named a Melt `Combobox` for filters — the `/domains` and `/audit` filters are small fixed option sets, so this uses a styled native `<select>` (zero a11y risk, no builder). (2) No toast system. The review decision's feedback is the entry disappearing from the list on `invalidate`; errors show inline in the decision `Dialog` (Task 18). A toast layer is easy to add in #4 if a screen ever needs one.

**Interfaces:**

- Consumes: `$app/stores` (`page`) for `Pagination`.
- Produces:
  - `LogTable`: `{ columns: string[]; children: Snippet }` — renders `<table>` with the fixed column-head grammar; caller supplies `<tr>`s via the snippet.
  - `Pagination`: `{ page: number; pageCount: number; param?: string }` — default `param = 'page'`; renders prev / "N of M" / next as `<a>` links that keep every other current query param.
  - `Select`: `{ value: string; options: { value: string; label: string }[]; name: string; label: string; onchange?: (v: string) => void }`.

- [ ] **Step 1: Write `LogTable.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { columns, children }: { columns: string[]; children: Snippet } = $props();
</script>

<div class="scroll">
  <table>
    <thead>
      <tr>
        {#each columns as c (c)}<th scope="col">{c}</th>{/each}
      </tr>
    </thead>
    <tbody>{@render children()}</tbody>
  </table>
</div>

<style>
  .scroll { overflow-x: auto; border: var(--vb-line); border-radius: var(--vb-radius); background: var(--vb-ground-raised); }
  table { width: 100%; border-collapse: collapse; font-size: var(--vb-fs-small); }
  th {
    text-align: left;
    font: 700 var(--vb-fs-micro) / 1 var(--vb-font-head);
    font-stretch: var(--vb-head-stretch);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--vb-ink-soft);
    padding: var(--vb-s2) var(--vb-s3);
    border-bottom: 1px solid var(--vb-rule-strong);
    white-space: nowrap;
  }
  :global(tbody td) { padding: var(--vb-s2) var(--vb-s3); border-bottom: var(--vb-line); vertical-align: top; }
  :global(tbody tr:last-child td) { border-bottom: 0; }
</style>
```

- [ ] **Step 2: Write `Pagination.svelte`**

```svelte
<script lang="ts">
  import { page } from '$app/stores';
  let {
    page: current,
    pageCount,
    param = 'page'
  }: { page: number; pageCount: number; param?: string } = $props();

  function href(n: number): string {
    const q = new URLSearchParams($page.url.searchParams);
    q.set(param, String(n));
    return `?${q.toString()}`;
  }
</script>

{#if pageCount > 1}
  <nav class="pg" aria-label="pagination">
    {#if current > 1}
      <a href={href(current - 1)} rel="prev" data-sveltekit-noscroll>‹ prev</a>
    {:else}
      <span class="disabled">‹ prev</span>
    {/if}
    <span class="count">{current} of {pageCount}</span>
    {#if current < pageCount}
      <a href={href(current + 1)} rel="next" data-sveltekit-noscroll>next ›</a>
    {:else}
      <span class="disabled">next ›</span>
    {/if}
  </nav>
{/if}

<style>
  .pg { display: flex; align-items: center; gap: var(--vb-s4); justify-content: flex-end; margin-top: var(--vb-s4); font: var(--vb-fs-small) / 1 var(--vb-font-mono); }
  .pg a { color: var(--vb-accent); text-decoration: none; }
  .pg a:hover { text-decoration: underline; }
  .disabled { color: var(--vb-ink-faint); }
  .count { color: var(--vb-ink-soft); }
</style>
```

- [ ] **Step 3: Write `Select.svelte`**

```svelte
<script lang="ts">
  let {
    value = $bindable(''),
    options,
    name,
    label,
    onchange
  }: {
    value?: string;
    options: { value: string; label: string }[];
    name: string;
    label: string;
    onchange?: (v: string) => void;
  } = $props();
</script>

<label class="sel">
  <span>{label}</span>
  <select
    {name}
    bind:value
    onchange={(e) => onchange?.((e.currentTarget as HTMLSelectElement).value)}
  >
    {#each options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
  </select>
</label>

<style>
  .sel { display: inline-flex; flex-direction: column; gap: 4px; }
  .sel span { font: var(--vb-fs-micro) / 1 var(--vb-font-mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--vb-ink-soft); }
  select {
    font: var(--vb-fs-small) / 1 var(--vb-font-mono);
    color: var(--vb-ink);
    background: var(--vb-ground-raised);
    border: 1px solid var(--vb-rule-strong);
    border-radius: var(--vb-radius);
    padding: 6px 8px;
  }
</style>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/LogTable.svelte src/lib/components/Pagination.svelte src/lib/components/Select.svelte
git commit -m "feat(sub2): table, pagination, select"
```

---

## Task 15: Melt Dialog + Sheet

- [x] **TASK COMPLETE** — commits e3b74bf..eba3a7f, review clean (1 fix round: `<aside>`→`<div role="dialog">` for pristine check)

**Files:**

- Create: `src/lib/components/Dialog.svelte`
- Create: `src/lib/components/Sheet.svelte`

**Interfaces:**

- Consumes: `@melt-ui/svelte` (`createDialog`, `melt`).
- Produces:
  - `Dialog`: `{ open?: boolean (bindable); title: string; children: Snippet }` — centered modal. Closing (overlay click, `Esc`, close button) sets `open = false`.
  - `Sheet`: `{ open?: boolean (bindable); title: string; onclose?: () => void; children: Snippet }` — right-anchored full-height panel; same close behaviour; also calls `onclose` when it closes (the detail route uses this to `history.back()`).

- [ ] **Step 1: Write `Dialog.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { createDialog, melt } from '@melt-ui/svelte';

  let {
    open = $bindable(false),
    title,
    children
  }: { open?: boolean; title: string; children: Snippet } = $props();

  const {
    elements: { overlay, content, title: titleEl, close, portalled },
    states: { open: isOpen }
  } = createDialog({
    forceVisible: true,
    onOpenChange: ({ next }) => {
      open = next;
      return next;
    }
  });

  $effect(() => {
    isOpen.set(open);
  });
</script>

{#if $isOpen}
  <div use:melt={$portalled}>
    <div use:melt={$overlay} class="ov"></div>
    <div use:melt={$content} class="panel" role="dialog">
      <h2 use:melt={$titleEl}>{title}</h2>
      <div class="body">{@render children()}</div>
      <button use:melt={$close} class="x" aria-label="Close">✕</button>
    </div>
  </div>
{/if}

<style>
  .ov { position: fixed; inset: 0; background: rgba(16, 20, 22, 0.55); z-index: 40; }
  .panel {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(560px, calc(100vw - var(--vb-s5)));
    max-height: calc(100vh - var(--vb-s6));
    overflow: auto;
    background: var(--vb-ground-raised);
    border: 1px solid var(--vb-rule-strong);
    border-radius: var(--vb-radius);
    padding: var(--vb-s5);
    z-index: 41;
  }
  h2 { font: 700 var(--vb-fs-h3) / 1.2 var(--vb-font-head); font-stretch: var(--vb-head-stretch); text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 var(--vb-s4); }
  .x { position: absolute; top: var(--vb-s3); right: var(--vb-s3); background: none; border: 0; color: var(--vb-ink-soft); font-size: var(--vb-fs-h3); cursor: pointer; }
</style>
```

- [ ] **Step 2: Write `Sheet.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { createDialog, melt } from '@melt-ui/svelte';

  let {
    open = $bindable(false),
    title,
    onclose,
    children
  }: { open?: boolean; title: string; onclose?: () => void; children: Snippet } = $props();

  const {
    elements: { overlay, content, title: titleEl, close, portalled },
    states: { open: isOpen }
  } = createDialog({
    forceVisible: true,
    onOpenChange: ({ next }) => {
      open = next;
      if (!next) onclose?.();
      return next;
    }
  });

  $effect(() => {
    isOpen.set(open);
  });
</script>

{#if $isOpen}
  <div use:melt={$portalled}>
    <div use:melt={$overlay} class="ov"></div>
    <aside use:melt={$content} class="sheet" role="dialog">
      <header>
        <h2 use:melt={$titleEl}>{title}</h2>
        <button use:melt={$close} class="x" aria-label="Close">✕</button>
      </header>
      <div class="body">{@render children()}</div>
    </aside>
  </div>
{/if}

<style>
  .ov { position: fixed; inset: 0; background: rgba(16, 20, 22, 0.5); z-index: 40; }
  .sheet {
    position: fixed;
    top: 0;
    right: 0;
    height: 100vh;
    width: min(620px, 92vw);
    overflow-y: auto;
    background: var(--vb-ground-raised);
    border-left: 1px solid var(--vb-rule-strong);
    box-shadow: var(--vb-shadow-sheet);
    z-index: 41;
    padding: var(--vb-s5);
  }
  header { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 2px solid var(--vb-rule-strong); padding-bottom: var(--vb-s3); margin-bottom: var(--vb-s4); }
  h2 { font: 700 var(--vb-fs-h3) / 1.2 var(--vb-font-head); font-stretch: var(--vb-head-stretch); text-transform: uppercase; letter-spacing: 0.05em; margin: 0; word-break: break-all; }
  .x { background: none; border: 0; color: var(--vb-ink-soft); font-size: var(--vb-fs-h3); cursor: pointer; }
</style>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm check`
Expected: PASS. If `@melt-ui/svelte` types complain about `onOpenChange`'s return, the correct signature is `({ curr, next }) => boolean`; return `next`.

- [ ] **Step 4: Smoke-run the dev server**

Run: `pnpm dev` (then `Ctrl-C`). Expected: starts with no compile error. (Full interaction is exercised in Task 24.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/Dialog.svelte src/lib/components/Sheet.svelte
git commit -m "feat(sub2): Melt dialog + side sheet wrappers"
```

---

## Task 16: Client helpers — SSE stream + auto-refresh

- [x] **TASK COMPLETE** — commits eba3a7f..b230f8f, review clean

**Files:**

- Create: `src/lib/client/sse.ts`
- Create: `src/lib/client/auto-refresh.ts`

**Interfaces:**

- Consumes: `$app/navigation` (`invalidate`); `VbEvent` type from `$lib/server/events` (type-only import — safe, it is `import type`).
- Produces:
  - `sse.ts`: `createEventStream(): { status: Readable<SseState>; last: Readable<VbEvent | null>; close: () => void }` where `SseState = 'connecting' | 'live' | 'down'`. On the transition down→live it calls `invalidate('vb:data')` so a screen reconciles anything missed while disconnected. Returns inert no-op stores when `EventSource` is undefined (SSR).
  - `auto-refresh.ts`: `startAutoRefresh(ms = 20_000): () => void` — interval that calls `invalidate('vb:data')` while `document.visibilityState === 'visible'`; returns a cleanup function. Intended use: `$effect(() => startAutoRefresh())`.

- [ ] **Step 1: Write `sse.ts`**

```ts
// src/lib/client/sse.ts
import { readable, type Readable } from 'svelte/store';
import { invalidate } from '$app/navigation';
import type { VbEvent } from '$lib/server/events';

export type SseState = 'connecting' | 'live' | 'down';

export interface EventStream {
  status: Readable<SseState>;
  last: Readable<VbEvent | null>;
  close: () => void;
}

export function createEventStream(): EventStream {
  if (typeof EventSource === 'undefined') {
    return {
      status: readable<SseState>('connecting'),
      last: readable<VbEvent | null>(null),
      close: () => {}
    };
  }

  let es: EventSource | null = null;
  let wasDown = false;

  const status = readable<SseState>('connecting', (set) => {
    es = new EventSource('/events');
    es.onopen = () => {
      set('live');
      if (wasDown) {
        wasDown = false;
        void invalidate('vb:data');
      }
    };
    es.onerror = () => {
      wasDown = true;
      set('down'); // the browser reconnects on its own
    };
    return () => es?.close();
  });

  const last = readable<VbEvent | null>(null, (set) => {
    const handler = (e: MessageEvent) => {
      try {
        set(JSON.parse(e.data) as VbEvent);
      } catch {
        /* heartbeat / comment line */
      }
    };
    // es is created by the status store's subscriber; guard for order
    const attach = () => es && es.addEventListener('message', handler);
    const id = setInterval(() => {
      if (es) {
        clearInterval(id);
        attach();
      }
    }, 20);
    return () => {
      clearInterval(id);
      es?.removeEventListener('message', handler);
    };
  });

  return { status, last, close: () => es?.close() };
}
```

> Both stores must be subscribed for the stream to run (Svelte `readable` start fn only fires on first subscriber). The layout (Task 17) subscribes both via `$status` / `$last` in markup, so this is satisfied. If you ever use `createEventStream` without rendering both, subscribe manually.

- [ ] **Step 2: Write `auto-refresh.ts`**

```ts
// src/lib/client/auto-refresh.ts
import { invalidate } from '$app/navigation';

export function startAutoRefresh(ms = 20_000): () => void {
  if (typeof document === 'undefined') return () => {};
  const id = setInterval(() => {
    if (document.visibilityState === 'visible') void invalidate('vb:data');
  }, ms);
  return () => clearInterval(id);
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/client/sse.ts src/lib/client/auto-refresh.ts
git commit -m "feat(sub2): client SSE stream + auto-refresh helpers"
```

---

## Task 17: App shell (`+layout`)

- [x] **TASK COMPLETE** — commits b230f8f..1073802, review clean

**Files:**

- Create: `src/routes/+layout.server.ts`
- Create: `src/routes/+layout.svelte`
- Test: `tests/server/routes/layout-load.test.ts`

**Interfaces:**

- Consumes: `repo.countDomainsByState`, `repo.countPublished`; `db`, `schema` from `$lib/server/db/index`; `createEventStream` from `$lib/client/sse`; `format.ts`.
- Produces:
  - `+layout.server.ts` `load` → `{ badge: { inQueue: number; published: number } }`, declares `depends('vb:data')`.
  - `+layout.svelte` puts the SSE stream in context under the key `'vb:sse'` (value: `EventStream`), renders nav + theme toggle + `SseStatus` + `Toaster` + `{@render children()}`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/routes/layout-load.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestDb, type TestDb } from '../../helpers/test-db';

let tdb: TestDb;
beforeEach(async () => {
  tdb = await makeTestDb();
  vi.doMock('$lib/server/db/index', () => ({ db: tdb.db, schema: tdb.schema }));
});
afterEach(() => {
  vi.doUnmock('$lib/server/db/index');
  vi.resetModules();
  tdb.close();
});

describe('+layout.server load', () => {
  it('returns badge counts', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.domains).values([
      {
        domain: 'a',
        firstSeen: 1,
        lastSeen: 1,
        hitCount: 1,
        state: 'pending_review'
      },
      {
        domain: 'b',
        firstSeen: 1,
        lastSeen: 1,
        hitCount: 1,
        state: 'pending_review'
      },
      { domain: 'c', firstSeen: 1, lastSeen: 1, hitCount: 1, state: 'approved' }
    ]);
    const { load } = await import('../../../src/routes/+layout.server');
    const depends = vi.fn();
    const res = await (load as any)({ depends });
    expect(res).toEqual({ badge: { inQueue: 2, published: 1 } });
    expect(depends).toHaveBeenCalledWith('vb:data');
  });
});
```

> **Loader test pattern (used by every route task below).** SvelteKit route modules import `$lib/server/db/index`, which opens the real DB. Tests `vi.doMock` that module to the `TestDb` **before** dynamically importing the route module, and `vi.resetModules()` in `afterEach`. Always `import` the route module _after_ `vi.doMock`. The `$lib` alias already resolves in `vitest.config.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/server/routes/layout-load.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `+layout.server.ts`**

```ts
import { db, schema } from '$lib/server/db/index';
import { countDomainsByState, countPublished } from '$lib/server/db/repo';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ depends }) => {
  depends('vb:data');
  const [counts, published] = await Promise.all([
    countDomainsByState(db, schema),
    countPublished(db, schema)
  ]);
  return { badge: { inQueue: counts.pending_review, published } };
};
```

- [ ] **Step 4: Write `+layout.svelte`**

```svelte
<script lang="ts">
  import '$lib/design/tokens.css';
  import { onMount, setContext } from 'svelte';
  import { page } from '$app/stores';
  import { createEventStream } from '$lib/client/sse';
  import SseStatus from '$lib/components/SseStatus.svelte';
  import { formatCount } from '$lib/format';

  let { children, data } = $props();

  const sse = createEventStream();
  setContext('vb:sse', sse);
  const { status } = sse;

  onMount(() => () => sse.close());

  const nav = [
    { href: '/', label: 'Log' },
    { href: '/queue', label: 'Queue' },
    { href: '/review', label: 'Review' },
    { href: '/domains', label: 'Domains' },
    { href: '/audit', label: 'Audit' }
  ];
</script>

<div class="shell">
  <nav class="bar">
    <span class="brand">VEERABAHU</span>
    <ul>
      {#each nav as n (n.href)}
        <li>
          <a href={n.href} aria-current={$page.url.pathname === n.href ? 'page' : undefined}>
            {n.label}
            {#if n.href === '/review' && data.badge.inQueue > 0}
              <span class="badge">{formatCount(data.badge.inQueue)}</span>
            {/if}
          </a>
        </li>
      {/each}
    </ul>
    <SseStatus state={$status} />
  </nav>
  <main>{@render children()}</main>
</div>

<style>
  .shell { min-height: 100vh; }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--vb-s5);
    padding: var(--vb-s3) var(--vb-s5);
    border-bottom: 2px solid var(--vb-rule-strong);
    background: var(--vb-ground-raised);
    position: sticky;
    top: 0;
    z-index: 20;
  }
  .brand { font: 700 var(--vb-fs-h3) / 1 var(--vb-font-head); font-stretch: var(--vb-head-stretch); letter-spacing: 0.14em; }
  .bar ul { display: flex; gap: var(--vb-s4); list-style: none; margin: 0; padding: 0; flex: 1; }
  .bar a { color: var(--vb-ink-soft); text-decoration: none; font: var(--vb-fs-small) / 1 var(--vb-font-mono); text-transform: uppercase; letter-spacing: 0.06em; display: inline-flex; align-items: center; gap: 6px; padding: 6px 2px; }
  .bar a[aria-current='page'] { color: var(--vb-ink); border-bottom: 2px solid var(--vb-accent); }
  .badge { background: var(--vb-accent); color: var(--vb-accent-ink); border-radius: 999px; font-size: 10px; padding: 1px 6px; }
  main { max-width: 1080px; margin: 0 auto; padding: var(--vb-s6) var(--vb-s5); }
  @media (max-width: 720px) {
    .bar { flex-wrap: wrap; gap: var(--vb-s3); }
    main { padding: var(--vb-s5) var(--vb-s4); }
  }
</style>
```

- [ ] **Step 5: Run the test + typecheck + dev smoke**

Run: `pnpm exec vitest run tests/server/routes/layout-load.test.ts && pnpm check`
Expected: PASS. Then `pnpm dev`, open `http://localhost:5173`, confirm the nav bar renders over the existing stub page, dark mode follows the OS setting, no console errors. `Ctrl-C`.

- [ ] **Step 6: Commit**

```bash
git add src/routes/+layout.server.ts src/routes/+layout.svelte tests/server/routes/layout-load.test.ts
git commit -m "feat(sub2): app shell — nav + global SSE status"
```

---

## Task 18: `ReviewEntry` component + rebuilt `/review`

- [x] **TASK COMPLETE** — commits 1073802..6e8f1bb, review clean

**Files:**

- Create: `src/lib/components/ReviewEntry.svelte`
- Modify: `src/routes/review/+page.server.ts`
- Modify: `src/routes/review/+page.svelte`
- Delete: `src/routes/api/review/+server.ts`
- Modify/Check: `tests/server/routes/review-page-load.test.ts` (update for the new return shape)
- Modify/Check: `tests/server/routes/review-api.test.ts` (remove the GET-list case; keep the `[domain]` POST cases)

**Interfaces:**

- Consumes: `ReviewListItem` from `$lib/server/pipeline/review`; `ScoreBracket`, `StatusEdge`, `Dialog`, `Stamp` components; `pushToast`; `relativeTime`.
- Produces:
  - `ReviewEntry`: `{ item: ReviewListItem; lastPullAt: number | null; ondecided?: () => void }`. Renders the domain (mono), `StatusEdge state="pending_review"`, `ScoreBracket`, and two buttons **Block it** / **Keep it**. Each opens a `Dialog` showing the read-before-commit proof line + an optional note `<textarea>`; confirm POSTs `{ decision, note }` to `/api/review/<domain>` and, on `res.ok`, calls `pushToast` + `ondecided`.
  - `/review/+page.server.ts` `load` → `{ items: ReviewListItem[]; lastPullAt: number | null }`, `depends('vb:data')`.

- [ ] **Step 1: Write `ReviewEntry.svelte`**

```svelte
<script lang="ts">
  import type { ReviewListItem } from '$lib/server/pipeline/review';
  import { invalidate } from '$app/navigation';
  import ScoreBracket from './ScoreBracket.svelte';
  import StatusEdge from './StatusEdge.svelte';
  import Dialog from './Dialog.svelte';
  import { relativeTime } from '$lib/format';

  let {
    item,
    lastPullAt,
    ondecided
  }: {
    item: ReviewListItem;
    lastPullAt: number | null;
    ondecided?: () => void;
  } = $props();

  let dialogOpen = $state(false);
  let pending = $state<'approve' | 'reject' | null>(null);
  let note = $state('');
  let busy = $state(false);
  let err = $state('');

  function ask(decision: 'approve' | 'reject') {
    pending = decision;
    note = '';
    err = '';
    dialogOpen = true;
  }

  const proof = $derived(
    pending === 'approve'
      ? `Adds ${item.domain} to /blocklist.txt. Gatekeeper last pulled the list ${relativeTime(lastPullAt)}.`
      : `Removes ${item.domain} from review and adds it to the allowlist. It will not be proposed again.`
  );

  async function confirm() {
    if (!pending) return;
    busy = true;
    err = '';
    try {
      const res = await fetch(`/api/review/${encodeURIComponent(item.domain)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: pending, note: note.trim() || null })
      });
      if (res.ok) {
        dialogOpen = false;
        await invalidate('vb:data'); // the entry drops out of the list — that is the confirmation
        ondecided?.();
      } else {
        const body = await res.json().catch(() => ({}));
        err = body.message ?? `Failed (${res.status})`;
      }
    } catch {
      err = 'Network error — try again.';
    } finally {
      busy = false;
    }
  }
</script>

<article class="entry">
  <StatusEdge state="pending_review" />
  <div class="main">
    <div class="head">
      <span class="domain">{item.domain}</span>
      <span class="meta">{item.hitCount} hits</span>
    </div>
    <ScoreBracket score={item.score} verdicts={item.verdicts} />
    <div class="actions">
      <button class="block" onclick={() => ask('approve')}>Block it</button>
      <button class="keep" onclick={() => ask('reject')}>Keep it</button>
    </div>
  </div>
</article>

<Dialog bind:open={dialogOpen} title={pending === 'approve' ? 'Stamp: BLOCKED' : 'Stamp: KEPT'}>
  <p class="proof">{proof}</p>
  <label class="note">
    <span>Note (optional)</span>
    <textarea bind:value={note} rows="3" placeholder="Why?"></textarea>
  </label>
  {#if err}<p class="err" role="alert">{err}</p>{/if}
  <div class="confirm">
    <button class="go" disabled={busy} onclick={confirm}>
      {busy ? 'Working…' : pending === 'approve' ? 'Confirm block' : 'Confirm keep'}
    </button>
    <button class="cancel" disabled={busy} onclick={() => (dialogOpen = false)}>Cancel</button>
  </div>
</Dialog>

<style>
  .entry { display: flex; gap: var(--vb-s3); padding: var(--vb-s4) 0; border-bottom: var(--vb-line); }
  .main { flex: 1; display: flex; flex-direction: column; gap: var(--vb-s3); }
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--vb-s3); }
  .domain { font: var(--vb-fs-h3) / 1.2 var(--vb-font-mono); word-break: break-all; }
  .meta { font: var(--vb-fs-micro) / 1 var(--vb-font-mono); color: var(--vb-ink-soft); white-space: nowrap; }
  .actions { display: flex; gap: var(--vb-s3); }
  .actions button { font: 700 var(--vb-fs-small) / 1 var(--vb-font-head); font-stretch: var(--vb-head-stretch); text-transform: uppercase; letter-spacing: 0.06em; padding: 8px 14px; border-radius: var(--vb-radius); cursor: pointer; border: 1.5px solid currentColor; }
  .block { color: var(--vb-accent); background: none; }
  .keep { color: var(--vb-ink-soft); background: none; }
  .proof { font-size: var(--vb-fs-small); color: var(--vb-ink-soft); border-left: 3px solid var(--vb-rule-strong); padding-left: var(--vb-s3); }
  .note { display: flex; flex-direction: column; gap: 4px; margin: var(--vb-s4) 0; }
  .note span { font: var(--vb-fs-micro) / 1 var(--vb-font-mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--vb-ink-soft); }
  textarea { font: var(--vb-fs-small) / 1.4 var(--vb-font-mono); background: var(--vb-ground); color: var(--vb-ink); border: 1px solid var(--vb-rule-strong); border-radius: var(--vb-radius); padding: 8px; resize: vertical; }
  .confirm { display: flex; gap: var(--vb-s3); }
  .go { background: var(--vb-accent); color: var(--vb-accent-ink); border: 0; padding: 8px 16px; border-radius: var(--vb-radius); font-weight: 700; cursor: pointer; }
  .cancel { background: none; border: 1px solid var(--vb-rule-strong); color: var(--vb-ink); padding: 8px 16px; border-radius: var(--vb-radius); cursor: pointer; }
  .err { color: var(--vb-accent); font-size: var(--vb-fs-small); margin: 0 0 var(--vb-s3); }
</style>
```

- [ ] **Step 2: Rewrite `/review/+page.server.ts`**

```ts
import { db, schema } from '$lib/server/db/index';
import { listReview } from '$lib/server/pipeline/review';
import { listRecentBlocklistFetches } from '$lib/server/db/repo';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ depends }) => {
  depends('vb:data');
  const [items, fetches] = await Promise.all([
    listReview(db, schema, 100, 0),
    listRecentBlocklistFetches(db, schema, 1)
  ]);
  return { items, lastPullAt: fetches[0]?.at ?? null };
};
```

- [ ] **Step 3: Rewrite `/review/+page.svelte`**

```svelte
<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import { invalidate } from '$app/navigation';
  import type { EventStream } from '$lib/client/sse';
  import Masthead from '$lib/components/Masthead.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ReviewEntry from '$lib/components/ReviewEntry.svelte';

  let { data } = $props();

  const sse = getContext<EventStream>('vb:sse');
  const { last } = sse;

  onMount(() => {
    const unsub = last.subscribe((evt) => {
      if (!evt) return;
      if (evt.type === 'verdict' || evt.type === 'domain.state' || evt.type === 'decision') {
        void invalidate('vb:data');
      }
    });
    return unsub;
  });
</script>

<Masthead
  title="Incoming — awaiting decision"
  counts={[{ label: 'In queue', value: data.items.length }]}
/>

{#if data.items.length === 0}
  <EmptyState title="No entries awaiting a decision" hint="Assessed domains that need a human call appear here." />
{:else}
  {#each data.items as item (item.domain)}
    <ReviewEntry {item} lastPullAt={data.lastPullAt} />
  {/each}
{/if}
```

- [ ] **Step 4: Delete the dead GET endpoint**

```bash
git rm src/routes/api/review/+server.ts
```

Then open `tests/server/routes/review-api.test.ts`. If it has a case hitting `GET /api/review` (the list), delete that case. Keep every case for `POST /api/review/[domain]`. If the whole file was only the GET list, delete the file too (`git rm`), because the `[domain]` POST has its own coverage in `tests/server/pipeline/review.test.ts` — but verify that first; do not lose the 404/409 route-level assertions.

- [ ] **Step 5: Update `tests/server/routes/review-page-load.test.ts`**

The load now returns `{ items, lastPullAt }` and takes `{ depends }`. Update the call to `(load as any)({ depends: vi.fn() })` and assert `res.lastPullAt` is `null` (no fetch rows) and `res.items` is an array. Keep the DB-mock pattern from Task 17 Step 1.

- [ ] **Step 6: Run the affected tests + typecheck**

Run: `pnpm exec vitest run tests/server/routes/ && pnpm check`
Expected: PASS.

- [ ] **Step 7: Dev smoke**

`pnpm dev` → open `/review`. With an empty DB you see the empty state. Insert a `pending_review` row by hand (`sqlite3 data/veerabahu.db` or a quick script) and confirm an entry renders with working Block/Keep dialogs. `Ctrl-C`.

- [ ] **Step 8: Full suite + coverage**

Run: `pnpm test:cov`
Expected: PASS, gate ≥ 90 % (`+layout.server.ts` and `review/+page.server.ts` are `.ts` and now tested; `.svelte` excluded).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(sub2): rebuilt /review with ReviewEntry + SSE refresh; drop GET /api/review"
```

---

## Task 19: `/` dashboard

- [x] **TASK COMPLETE** — commits 71543fc..62e251b, review clean

**Files:**

- Modify: `src/routes/+page.svelte` (replace stub)
- Create: `src/routes/+page.server.ts`
- Modify: `src/lib/server/pipeline/dashboard.ts` (add `recentAudit` to `DashboardView`)
- Modify: `tests/server/pipeline/dashboard.test.ts` (assert `recentAudit`)
- Test: `tests/server/routes/dashboard-load.test.ts`

**Interfaces:**

- Consumes: `getDashboard`; `listReview` (top 5); `AuditEntry` shape; components `Masthead`, `ReviewEntry`, `EmptyState`, `Stamp`, `RelativeTime`; `startAutoRefresh`; `format.ts`.
- Produces:
  - `DashboardView` gains `recentAudit: { at: number; actor: string; event: string; domain: string | null }[]` (last 8).
  - `/+page.server.ts` `load` → `{ view: DashboardView; queueTop: ReviewListItem[]; lastPullAt: number | null }`, `depends('vb:data')`.

- [ ] **Step 1: Extend `dashboard.ts`**

Add to `DashboardView`:

```ts
recentAudit: {
  at: number;
  actor: string;
  event: string;
  domain: string | null;
}
[];
```

In `getDashboard`, add to the `Promise.all` list:

```ts
repo.listAuditRows(db, schema, { limit: 8, offset: 0 });
```

capture it as `recentAudit` and map:

```ts
recentAudit: recentAudit.map((r: any) => ({
  at: r.at,
  actor: r.actor,
  event: r.event,
  domain: r.domain
}));
```

Update `tests/server/pipeline/dashboard.test.ts`: after seeding an `auditLog` row, assert `v.recentAudit[0].event` is that row's event.

- [ ] **Step 2: Write the failing route test**

```ts
// tests/server/routes/dashboard-load.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestDb, type TestDb } from '../../helpers/test-db';

let tdb: TestDb;
beforeEach(async () => {
  tdb = await makeTestDb();
  vi.doMock('$lib/server/db/index', () => ({ db: tdb.db, schema: tdb.schema }));
});
afterEach(() => {
  vi.doUnmock('$lib/server/db/index');
  vi.resetModules();
  tdb.close();
});

describe('/ dashboard load', () => {
  it('returns the view, queue preview and last pull', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.domains).values([
      {
        domain: 'q1',
        firstSeen: 1,
        lastSeen: 2,
        hitCount: 9,
        state: 'pending_review',
        score: -0.7
      },
      {
        domain: 'q2',
        firstSeen: 1,
        lastSeen: 2,
        hitCount: 3,
        state: 'pending_review',
        score: -0.6
      }
    ]);
    const { load } = await import('../../../src/routes/+page.server');
    const res = await (load as any)({ depends: vi.fn() });
    expect(res.view.counts.pending_review).toBe(2);
    expect(res.queueTop.map((d: any) => d.domain)).toEqual(['q1', 'q2']);
    expect(res.lastPullAt).toBeNull();
  });
});
```

- [ ] **Step 3: Write `+page.server.ts`**

```ts
import { db, schema } from '$lib/server/db/index';
import { getDashboard } from '$lib/server/pipeline/dashboard';
import { listReview } from '$lib/server/pipeline/review';
import { listRecentBlocklistFetches } from '$lib/server/db/repo';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ depends }) => {
  depends('vb:data');
  const [view, queueTop, fetches] = await Promise.all([
    getDashboard(db, schema),
    listReview(db, schema, 5, 0),
    listRecentBlocklistFetches(db, schema, 1)
  ]);
  return { view, queueTop, lastPullAt: fetches[0]?.at ?? null };
};
```

- [ ] **Step 4: Write `+page.svelte`**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { startAutoRefresh } from '$lib/client/auto-refresh';
  import Masthead from '$lib/components/Masthead.svelte';
  import ReviewEntry from '$lib/components/ReviewEntry.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import RelativeTime from '$lib/components/RelativeTime.svelte';
  import { formatCount, formatUsd } from '$lib/format';

  let { data } = $props();
  const v = $derived(data.view);
  onMount(() => startAutoRefresh());
</script>

<Masthead
  title="Veerabahu · Level 2 Disposition Log"
  counts={[
    { label: 'In queue', value: formatCount(v.counts.pending_review) },
    { label: 'Published', value: formatCount(v.publishedCount) },
    { label: 'Auto-cleared 24h', value: formatCount(v.autoCleared24h) },
    { label: 'Observed 24h', value: formatCount(v.observed24h) }
  ]}
/>

<div class="grid">
  <section class="col-main">
    <h2>Open entries</h2>
    {#if data.queueTop.length === 0}
      <EmptyState title="Nothing awaiting a decision" hint="The log is clear." />
    {:else}
      {#each data.queueTop as item (item.domain)}
        <ReviewEntry {item} lastPullAt={data.lastPullAt} />
      {/each}
      <a class="more" href="/review">Open the full review queue →</a>
    {/if}

    <h2>Recent log lines</h2>
    <ul class="audit">
      {#each v.recentAudit as a (a.at + a.event + (a.domain ?? ''))}
        <li>
          <RelativeTime at={a.at} />
          <span class="ev">{a.event}</span>
          <span class="who">{a.actor}</span>
          {#if a.domain}<span class="dom">{a.domain}</span>{/if}
        </li>
      {/each}
    </ul>
  </section>

  <aside class="col-side">
    <h2>Consumption record</h2>
    {#if v.lastPull}
      <p class="pull">
        Last pull <RelativeTime at={v.lastPull.at} /> · {v.lastPull.ip} · {v.lastPull.status}
      </p>
    {:else}
      <p class="pull warn">Gatekeeper has never pulled the blocklist.</p>
    {/if}
    <p class="cost">AI spend today: {formatUsd(v.aiCostTodayUsd)} · {formatCount(v.verdictsToday)} verdicts</p>

    <h2>Sources</h2>
    <ul class="sources">
      {#each v.sources as s (s.source)}
        <li>
          <span class="sname">{s.source}</span>
          <span class="squota">
            {s.remainingDay === null ? 'no key' : `${formatCount(s.remainingDay)} left today`}
          </span>
        </li>
      {/each}
    </ul>
    <a class="more" href="/queue">Pipeline & queue status →</a>

    <h2>Curated lists</h2>
    <ul class="curated">
      {#each v.curatedLists as c (c.name)}
        <li>
          <span>{c.name}</span>
          <span class="cmeta">
            {#if c.lastError}<span class="warn">error</span>
            {:else}<RelativeTime at={c.lastFetched} /> · {formatCount(c.entryCount)}{/if}
          </span>
        </li>
      {/each}
    </ul>
  </aside>
</div>

<style>
  .grid { display: grid; grid-template-columns: 1fr 320px; gap: var(--vb-s6); }
  h2 { font: 700 var(--vb-fs-micro) / 1 var(--vb-font-head); font-stretch: var(--vb-head-stretch); text-transform: uppercase; letter-spacing: 0.1em; color: var(--vb-ink-soft); border-bottom: 1px solid var(--vb-rule); padding-bottom: var(--vb-s2); margin: var(--vb-s5) 0 var(--vb-s3); }
  .col-main h2:first-child, .col-side h2:first-child { margin-top: 0; }
  .more { display: inline-block; margin-top: var(--vb-s3); font: var(--vb-fs-small) / 1 var(--vb-font-mono); color: var(--vb-accent); text-decoration: none; }
  .audit { list-style: none; margin: 0; padding: 0; font: var(--vb-fs-small) / 1.6 var(--vb-font-mono); }
  .audit li { display: flex; gap: var(--vb-s3); border-bottom: var(--vb-line); padding: 4px 0; }
  .audit .ev { color: var(--vb-ink); }
  .audit .who { color: var(--vb-ink-soft); }
  .audit .dom { color: var(--vb-accent); word-break: break-all; }
  .pull, .cost { font: var(--vb-fs-small) / 1.5 var(--vb-font-mono); color: var(--vb-ink-soft); }
  .warn { color: var(--vb-accent); }
  .sources, .curated { list-style: none; margin: 0; padding: 0; font: var(--vb-fs-small) / 1.6 var(--vb-font-mono); }
  .sources li, .curated li { display: flex; justify-content: space-between; gap: var(--vb-s3); border-bottom: var(--vb-line); padding: 4px 0; }
  .squota, .cmeta { color: var(--vb-ink-soft); }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
</style>
```

- [ ] **Step 5: Run tests + typecheck + dev smoke**

Run: `pnpm exec vitest run tests/server/routes/dashboard-load.test.ts tests/server/pipeline/dashboard.test.ts && pnpm check`
Expected: PASS. Then `pnpm dev`, open `/`, confirm the masthead + two columns render (mostly zeros on an empty DB). `Ctrl-C`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(sub2): dashboard screen"
```

---

## Task 20: `/queue` screen

- [x] **TASK COMPLETE** — commits e57fec4..2754979, review clean

**Files:**

- Create: `src/routes/queue/+page.server.ts`
- Create: `src/routes/queue/+page.svelte`
- Test: `tests/server/routes/queue-load.test.ts`

**Interfaces:**

- Consumes: `getQueue` (Task 8); components `Masthead`, `EmptyState`, `Stamp`, `RelativeTime`; `getContext('vb:sse')`; `format.ts` (`formatDuration`, `formatCount`, `relativeTime`).
- Produces: `/queue/+page.server.ts` `load` → `{ view: QueueView }`, `depends('vb:data')`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/routes/queue-load.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestDb, type TestDb } from '../../helpers/test-db';

let tdb: TestDb;
beforeEach(async () => {
  tdb = await makeTestDb();
  vi.doMock('$lib/server/db/index', () => ({ db: tdb.db, schema: tdb.schema }));
});
afterEach(() => {
  vi.doUnmock('$lib/server/db/index');
  vi.resetModules();
  tdb.close();
});

describe('/queue load', () => {
  it('returns a QueueView', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.domains).values({
      domain: 'a',
      firstSeen: 1,
      lastSeen: 1,
      hitCount: 1,
      state: 'observed'
    });
    const { load } = await import('../../../src/routes/queue/+page.server');
    const res = await (load as any)({ depends: vi.fn() });
    expect(res.view.totalBacklog).toBe(1);
    expect(res.view.sources.some((s: any) => s.source === 'metadefender')).toBe(
      true
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/server/routes/queue-load.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `+page.server.ts`**

```ts
import { db, schema } from '$lib/server/db/index';
import { getQueue } from '$lib/server/pipeline/queue';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ depends }) => {
  depends('vb:data');
  return { view: await getQueue(db, schema) };
};
```

- [ ] **Step 4: Write `+page.svelte`**

```svelte
<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import { invalidate } from '$app/navigation';
  import type { EventStream } from '$lib/client/sse';
  import Masthead from '$lib/components/Masthead.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Stamp from '$lib/components/Stamp.svelte';
  import RelativeTime from '$lib/components/RelativeTime.svelte';
  import { formatDuration, formatCount } from '$lib/format';

  let { data } = $props();
  const v = $derived(data.view);

  const { last } = getContext<EventStream>('vb:sse');
  onMount(() =>
    last.subscribe((evt) => {
      if (evt && (evt.type === 'assess.start' || evt.type === 'assess.done' || evt.type === 'verdict')) {
        void invalidate('vb:data');
      }
    })
  );
</script>

<Masthead
  title="Pipeline — pending assessment"
  counts={[{ label: 'Total backlog', value: formatCount(v.totalBacklog) }]}
/>

{#if v.totalBacklog === 0}
  <EmptyState title="All domains assessed — nothing queued" hint="Every observed domain has a verdict from every enabled source." />
{/if}

<section class="sources">
  {#each v.sources as s (s.source)}
    <article class="src">
      <header>
        <span class="name">{s.source}</span>
        {#if s.inline}
          <Stamp text="INLINE" tone="muted" />
        {:else if s.pausedUntil}
          <Stamp text="PAUSED" tone="accent" />
        {:else if s.backlog === 0}
          <Stamp text="DRAINED" tone="ok" />
        {/if}
      </header>
      {#if !s.inline}
        <dl>
          <div><dt>Backlog</dt><dd>{formatCount(s.backlog)}</dd></div>
          <div><dt>ETA</dt><dd>{formatDuration(s.etaMs)}</dd></div>
          <div><dt>In focus</dt><dd class="focus">{s.inFocus ?? '—'}</dd></div>
          <div><dt>Next call</dt><dd><RelativeTime at={s.nextCallAt} /></dd></div>
          <div><dt>Left today</dt><dd>{s.remainingDay === null ? 'no key' : formatCount(s.remainingDay)}</dd></div>
          {#if s.pausedUntil}<div><dt>Paused until</dt><dd><RelativeTime at={s.pausedUntil} /></dd></div>{/if}
        </dl>
      {:else}
        <p class="inline-note">Checked at ingest time against the local set. No backlog, no pacing.</p>
      {/if}
    </article>
  {/each}
</section>

<section class="ingest">
  <h2>Ingestion loop</h2>
  <dl>
    <div><dt>Last run</dt><dd><RelativeTime at={v.ingestion.lastIngestAt} /></dd></div>
    <div><dt>Next run</dt><dd><RelativeTime at={v.ingestion.nextRunAt} /></dd></div>
    <div><dt>First run done</dt><dd>{v.ingestion.firstRunDone ? 'yes' : 'no'}</dd></div>
    <div><dt>Cursor</dt><dd class="cursor">{v.ingestion.cursor ?? '—'}</dd></div>
  </dl>
</section>

<style>
  .sources { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--vb-s4); margin-bottom: var(--vb-s6); }
  .src { border: var(--vb-line); border-radius: var(--vb-radius); background: var(--vb-ground-raised); padding: var(--vb-s4); }
  .src header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--vb-s3); }
  .src .name { font: 700 var(--vb-fs-body) / 1 var(--vb-font-mono); }
  dl { display: grid; grid-template-columns: 1fr 1fr; gap: var(--vb-s2) var(--vb-s3); margin: 0; }
  dt { font: var(--vb-fs-micro) / 1 var(--vb-font-mono); text-transform: uppercase; letter-spacing: 0.06em; color: var(--vb-ink-soft); }
  dd { font: var(--vb-fs-small) / 1.3 var(--vb-font-mono); margin: 2px 0 0; }
  .focus, .cursor { word-break: break-all; color: var(--vb-accent); }
  .inline-note { font-size: var(--vb-fs-small); color: var(--vb-ink-soft); margin: 0; }
  .ingest h2 { font: 700 var(--vb-fs-micro) / 1 var(--vb-font-head); font-stretch: var(--vb-head-stretch); text-transform: uppercase; letter-spacing: 0.1em; color: var(--vb-ink-soft); border-bottom: 1px solid var(--vb-rule); padding-bottom: var(--vb-s2); }
  .ingest dl { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
</style>
```

- [ ] **Step 5: Run test + typecheck + dev smoke**

Run: `pnpm exec vitest run tests/server/routes/queue-load.test.ts && pnpm check`
Expected: PASS. `pnpm dev` → `/queue` shows four source cards + ingestion panel. `Ctrl-C`.

- [ ] **Step 6: Commit**

```bash
git add src/routes/queue tests/server/routes/queue-load.test.ts
git commit -m "feat(sub2): /queue pipeline status screen"
```

---

## Task 21: `/domains` browser

- [x] **TASK COMPLETE** — commits 8722713..890019e, review clean

**Files:**

- Create: `src/routes/domains/+page.server.ts`
- Create: `src/routes/domains/+page.svelte`
- Test: `tests/server/routes/domains-load.test.ts`

**Interfaces:**

- Consumes: `listDomains` (Task 9); `DOMAIN_STATES` from `$lib/server/db/types`; components `Masthead`, `LogTable`, `Pagination`, `Select`, `StatusEdge`, `EmptyState`, `RelativeTime`; `format.ts`; `$app/navigation` (`goto`).
- Produces: `/domains/+page.server.ts` `load({ url, depends })` → `{ result: DomainListResult; search: string; state: string }`, reads `?search=&state=&page=`, `depends('vb:data')`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/routes/domains-load.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestDb, type TestDb } from '../../helpers/test-db';

let tdb: TestDb;
beforeEach(async () => {
  tdb = await makeTestDb();
  vi.doMock('$lib/server/db/index', () => ({ db: tdb.db, schema: tdb.schema }));
});
afterEach(() => {
  vi.doUnmock('$lib/server/db/index');
  vi.resetModules();
  tdb.close();
});

const url = (qs: string) => new URL(`http://x/domains${qs}`);

describe('/domains load', () => {
  it('reads filters from the query string', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.domains).values([
      {
        domain: 'ads.one.com',
        firstSeen: 1,
        lastSeen: 5,
        hitCount: 1,
        state: 'observed'
      },
      {
        domain: 'ads.two.com',
        firstSeen: 2,
        lastSeen: 6,
        hitCount: 1,
        state: 'pending_review',
        score: -0.3
      },
      {
        domain: 'clean.com',
        firstSeen: 3,
        lastSeen: 7,
        hitCount: 1,
        state: 'observed'
      }
    ]);
    const { load } = await import('../../../src/routes/domains/+page.server');
    const res = await (load as any)({
      url: url('?search=ads&state=observed'),
      depends: vi.fn()
    });
    expect(res.search).toBe('ads');
    expect(res.state).toBe('observed');
    expect(res.result.items.map((i: any) => i.domain)).toEqual(['ads.one.com']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/server/routes/domains-load.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `+page.server.ts`**

```ts
import { db, schema } from '$lib/server/db/index';
import { listDomains } from '$lib/server/pipeline/domains';
import { DOMAIN_STATES } from '$lib/server/db/types';
import type { DomainState } from '$lib/server/db/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, depends }) => {
  depends('vb:data');
  const search = url.searchParams.get('search')?.trim() ?? '';
  const stateParam = url.searchParams.get('state') ?? '';
  const state = (DOMAIN_STATES as string[]).includes(stateParam)
    ? (stateParam as DomainState)
    : undefined;
  const page = Number(url.searchParams.get('page') ?? '1') || 1;
  const result = await listDomains(db, schema, {
    search: search || undefined,
    state,
    page
  });
  return { result, search, state: stateParam };
};
```

- [ ] **Step 4: Write `+page.svelte`**

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page as pageStore } from '$app/stores';
  import { onMount } from 'svelte';
  import { startAutoRefresh } from '$lib/client/auto-refresh';
  import { DOMAIN_STATES } from '$lib/server/db/types';
  import Masthead from '$lib/components/Masthead.svelte';
  import LogTable from '$lib/components/LogTable.svelte';
  import Pagination from '$lib/components/Pagination.svelte';
  import Select from '$lib/components/Select.svelte';
  import StatusEdge from '$lib/components/StatusEdge.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import RelativeTime from '$lib/components/RelativeTime.svelte';
  import { stateLabel, formatCount } from '$lib/format';

  let { data } = $props();
  let search = $state(data.search);

  onMount(() => startAutoRefresh());

  function apply(next: Partial<{ search: string; state: string; page: string }>) {
    const q = new URLSearchParams($pageStore.url.searchParams);
    for (const [k, val] of Object.entries(next)) {
      if (val) q.set(k, val);
      else q.delete(k);
    }
    q.delete('page'); // any filter change resets to page 1
    void goto(`/domains?${q.toString()}`, { keepFocus: true, noScroll: true });
  }

  const stateOptions = [
    { value: '', label: 'Any state' },
    ...DOMAIN_STATES.map((s) => ({ value: s, label: stateLabel(s) }))
  ];
</script>

<Masthead
  title="Domain log — index"
  counts={[{ label: 'Matches', value: formatCount(data.result.total) }]}
/>

<form
  class="filters"
  onsubmit={(e) => {
    e.preventDefault();
    apply({ search, state: data.state });
  }}
>
  <label class="search">
    <span>Search</span>
    <input type="search" bind:value={search} placeholder="domain contains…" />
  </label>
  <Select
    name="state"
    label="State"
    value={data.state}
    options={stateOptions}
    onchange={(v) => apply({ search, state: v })}
  />
  <button type="submit">Filter</button>
</form>

{#if data.result.items.length === 0}
  <EmptyState title="No domains match" hint="Clear the filters to see the whole log.">
    <a href="/domains">Clear filters</a>
  </EmptyState>
{:else}
  <LogTable columns={['Domain', 'State', 'Score', 'Hits', 'Last seen', 'Verdicts']}>
    {#each data.result.items as d (d.domain)}
      <tr>
        <td class="dom">
          <span class="edgewrap"><StatusEdge state={d.state} /></span>
          <a href={`/domains/${encodeURIComponent(d.domain)}`} data-sveltekit-noscroll>{d.domain}</a>
        </td>
        <td>{stateLabel(d.state)}</td>
        <td class="mono">{d.score === null ? '—' : d.score.toFixed(2)}</td>
        <td class="mono">{formatCount(d.hitCount)}</td>
        <td><RelativeTime at={d.lastSeen} /></td>
        <td class="mono">{d.verdictCount}</td>
      </tr>
    {/each}
  </LogTable>
  <Pagination page={data.result.page} pageCount={data.result.pageCount} />
{/if}

<style>
  .filters { display: flex; gap: var(--vb-s4); align-items: flex-end; margin-bottom: var(--vb-s4); flex-wrap: wrap; }
  .search { display: flex; flex-direction: column; gap: 4px; }
  .search span { font: var(--vb-fs-micro) / 1 var(--vb-font-mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--vb-ink-soft); }
  input[type='search'] { font: var(--vb-fs-small) / 1 var(--vb-font-mono); background: var(--vb-ground-raised); color: var(--vb-ink); border: 1px solid var(--vb-rule-strong); border-radius: var(--vb-radius); padding: 6px 8px; min-width: 220px; }
  .filters button { font: 700 var(--vb-fs-small) / 1 var(--vb-font-head); font-stretch: var(--vb-head-stretch); text-transform: uppercase; letter-spacing: 0.06em; padding: 8px 14px; border: 1px solid var(--vb-rule-strong); border-radius: var(--vb-radius); background: var(--vb-ground-raised); color: var(--vb-ink); cursor: pointer; }
  .dom { display: flex; align-items: stretch; gap: var(--vb-s2); }
  .dom a { color: var(--vb-ink); text-decoration: none; word-break: break-all; }
  .dom a:hover { color: var(--vb-accent); text-decoration: underline; }
  .edgewrap { display: inline-flex; }
  .mono { font-family: var(--vb-font-mono); }
</style>
```

- [ ] **Step 5: Run test + typecheck + dev smoke**

Run: `pnpm exec vitest run tests/server/routes/domains-load.test.ts && pnpm check`
Expected: PASS. `pnpm dev` → `/domains`; with a few seeded rows, the table, search, state filter and pagination work and clicking a domain navigates to `/domains/<name>` (a 404 until Task 22). `Ctrl-C`.

- [ ] **Step 6: Commit**

```bash
git add src/routes/domains tests/server/routes/domains-load.test.ts
git commit -m "feat(sub2): /domains browser with filters + pagination"
```

---

## Task 22: `/domains/[domain]` detail — page + side sheet

- [x] **TASK COMPLETE** — commits a4fc4f6..6d0f56a, review clean

**Files:**

- Create: `src/lib/components/DomainRecord.svelte`
- Create: `src/routes/domains/[domain]/+page.server.ts`
- Create: `src/routes/domains/[domain]/+page.svelte`
- Modify: `src/routes/domains/+page.svelte` (intercept link clicks → sheet)
- Test: `tests/server/routes/domain-detail-load.test.ts`

**Interfaces:**

- Consumes: `getReviewDetail` (extended in Task 11); `repo.addAllowlist` / `repo.removeAllowlist` / `repo.getAllowlistRow`; `appendAudit`; `now`; components `StatusEdge`, `Stamp`, `RelativeTime`, `Sheet`; `format.ts`.
- Produces:
  - `DomainRecord`: `{ detail: ReviewDetail }` — renders the whole record: header (domain, `StatusEdge`, `stateLabel`), the score derivation (`ScoreBracket`), verdict list with per-source `detail` + a `<details>` raw-JSON block from `rawBySource`, the per-domain audit lines, and an allowlist `<form method="POST" action="?/toggleAllowlist" use:enhance>` toggle.
  - `[domain]/+page.server.ts`: `load({ params, depends })` → `{ detail: ReviewDetail }` (404 via `error(404, …)` when `getReviewDetail` returns `null`); `actions.toggleAllowlist`.
  - `/domains/+page.svelte` gains a click interceptor: plain left-click on a domain link → `pushState` + `preloadData`, render `DomainRecord` inside a `Sheet`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/routes/domain-detail-load.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestDb, type TestDb } from '../../helpers/test-db';

let tdb: TestDb;
beforeEach(async () => {
  tdb = await makeTestDb();
  vi.doMock('$lib/server/db/index', () => ({ db: tdb.db, schema: tdb.schema }));
});
afterEach(() => {
  vi.doUnmock('$lib/server/db/index');
  vi.resetModules();
  tdb.close();
});

describe('/domains/[domain]', () => {
  it('loads a detail and 404s for the unknown', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.domains).values({
      domain: 'seen.com',
      firstSeen: 1,
      lastSeen: 2,
      hitCount: 4,
      state: 'observed'
    });
    const mod =
      await import('../../../src/routes/domains/[domain]/+page.server');
    const ok = await (mod.load as any)({
      params: { domain: 'seen.com' },
      depends: vi.fn()
    });
    expect(ok.detail.domain).toBe('seen.com');
    await expect(
      (mod.load as any)({ params: { domain: 'nope.com' }, depends: vi.fn() })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('toggleAllowlist adds then removes', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.domains).values({
      domain: 'x.com',
      firstSeen: 1,
      lastSeen: 2,
      hitCount: 1,
      state: 'observed'
    });
    const mod =
      await import('../../../src/routes/domains/[domain]/+page.server');
    const call = () =>
      (mod.actions.toggleAllowlist as any)({ params: { domain: 'x.com' } });
    await call();
    const { getAllowlistRow } = await import('../../../src/lib/server/db/repo');
    expect(await getAllowlistRow(db, schema, 'x.com')).toBeTruthy();
    await call();
    expect(await getAllowlistRow(db, schema, 'x.com')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/server/routes/domain-detail-load.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `[domain]/+page.server.ts`**

```ts
import { error } from '@sveltejs/kit';
import { db, schema } from '$lib/server/db/index';
import { getReviewDetail } from '$lib/server/pipeline/review';
import {
  addAllowlist,
  getAllowlistRow,
  removeAllowlist
} from '$lib/server/db/repo';
import { appendAudit } from '$lib/server/audit/log';
import { now } from '$lib/server/time';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, depends }) => {
  depends('vb:data');
  const detail = await getReviewDetail(db, schema, params.domain);
  if (!detail) error(404, `No record for ${params.domain}`);
  return { detail };
};

export const actions: Actions = {
  toggleAllowlist: async ({ params }) => {
    const domain = params.domain!;
    const existing = await getAllowlistRow(db, schema, domain);
    if (existing) {
      await removeAllowlist(db, schema, domain);
      await appendAudit(db, schema, {
        actor: 'user',
        event: 'allowlist.remove',
        domainId: null,
        data: { domain }
      });
    } else {
      await addAllowlist(db, schema, domain, 'added from domain record', now());
      await appendAudit(db, schema, {
        actor: 'user',
        event: 'allowlist.add',
        domainId: null,
        data: { domain }
      });
    }
    return { allowlisted: !existing };
  }
};
```

> `appendAudit`'s signature is `{ actor, event, domainId, data }` (see `src/lib/server/audit/log.ts`). `domainId` is `null` here because the allowlist is keyed by domain string, not id — matching how `decide` writes its allowlist rows. If `appendAudit` requires a number, pass the domain's id: fetch it with `repo.getDomainByName` first. Check the signature and adapt.

- [ ] **Step 4: Write `DomainRecord.svelte`**

```svelte
<script lang="ts">
  import type { ReviewDetail } from '$lib/server/pipeline/review';
  import { enhance } from '$app/forms';
  import StatusEdge from './StatusEdge.svelte';
  import ScoreBracket from './ScoreBracket.svelte';
  import RelativeTime from './RelativeTime.svelte';
  import { stateLabel, verdictLabel, formatCount } from '$lib/format';

  let { detail }: { detail: ReviewDetail } = $props();
</script>

<div class="record">
  <div class="top">
    <span class="edgewrap"><StatusEdge state={detail.state} /></span>
    <div>
      <p class="domain">{detail.domain}</p>
      <p class="sub">
        {stateLabel(detail.state)} · {formatCount(detail.hitCount)} hits ·
        first seen <RelativeTime at={detail.firstSeen} />
      </p>
    </div>
  </div>

  <h3>Score derivation</h3>
  <ScoreBracket score={detail.score} verdicts={detail.verdicts} />

  <h3>Verdicts</h3>
  <ul class="verdicts">
    {#each detail.verdictsFull as v (v.source)}
      <li>
        <div class="vhead">
          <span class="vsrc">{v.source}</span>
          <span class="vval">{verdictLabel(v.verdict)} · {v.confidence.toFixed(2)}</span>
          {#if v.category}<span class="vcat">{v.category}</span>{/if}
          <RelativeTime at={v.assessedAt} />
        </div>
        {#if v.detail}<p class="vdetail">{v.detail}</p>{/if}
        <details>
          <summary>raw</summary>
          <pre>{JSON.stringify(detail.rawBySource[v.source] ?? {}, null, 2)}</pre>
        </details>
      </li>
    {/each}
    {#if detail.verdictsFull.length === 0}<li class="none">No verdicts yet.</li>{/if}
  </ul>

  <h3>Log lines</h3>
  <ul class="audit">
    {#each detail.audit as a (a.at + a.event)}
      <li><RelativeTime at={a.at} /> <span>{a.event}</span> <span class="who">{a.actor}</span></li>
    {/each}
    {#if detail.audit.length === 0}<li class="none">No recorded transitions.</li>{/if}
  </ul>

  <h3>Allowlist</h3>
  <form method="POST" action="/domains/{encodeURIComponent(detail.domain)}?/toggleAllowlist" use:enhance>
    <p class="albody">
      {#if detail.allowlist}
        On the allowlist — {detail.allowlist.reason} (<RelativeTime at={detail.allowlist.addedAt} />).
      {:else}
        Not on the allowlist.
      {/if}
    </p>
    <button type="submit">
      {detail.allowlist ? 'Remove from allowlist' : 'Add to allowlist'}
    </button>
  </form>
</div>

<style>
  .record { font-size: var(--vb-fs-small); }
  .top { display: flex; gap: var(--vb-s3); align-items: stretch; margin-bottom: var(--vb-s4); }
  .domain { font: var(--vb-fs-h3) / 1.2 var(--vb-font-mono); margin: 0; word-break: break-all; }
  .sub { margin: 4px 0 0; color: var(--vb-ink-soft); font-family: var(--vb-font-mono); font-size: var(--vb-fs-micro); }
  h3 { font: 700 var(--vb-fs-micro) / 1 var(--vb-font-head); font-stretch: var(--vb-head-stretch); text-transform: uppercase; letter-spacing: 0.1em; color: var(--vb-ink-soft); border-bottom: 1px solid var(--vb-rule); padding-bottom: var(--vb-s2); margin: var(--vb-s5) 0 var(--vb-s3); }
  .verdicts, .audit { list-style: none; margin: 0; padding: 0; font-family: var(--vb-font-mono); }
  .verdicts li { border-bottom: var(--vb-line); padding: var(--vb-s3) 0; }
  .vhead { display: flex; flex-wrap: wrap; gap: var(--vb-s3); align-items: baseline; }
  .vsrc { font-weight: 700; }
  .vcat { color: var(--vb-accent); }
  .vdetail { margin: var(--vb-s2) 0 0; color: var(--vb-ink-soft); font-family: var(--vb-font-sans); }
  details pre { font-size: var(--vb-fs-micro); background: var(--vb-ground-sunk); padding: var(--vb-s3); overflow-x: auto; border-radius: var(--vb-radius); }
  .audit li { display: flex; gap: var(--vb-s3); padding: 3px 0; border-bottom: var(--vb-line); font-size: var(--vb-fs-micro); }
  .audit .who { color: var(--vb-ink-soft); }
  .none { color: var(--vb-ink-faint); padding: var(--vb-s2) 0; }
  form button { font: 700 var(--vb-fs-small) / 1 var(--vb-font-head); font-stretch: var(--vb-head-stretch); text-transform: uppercase; letter-spacing: 0.06em; padding: 8px 14px; border: 1.5px solid var(--vb-accent); color: var(--vb-accent); background: none; border-radius: var(--vb-radius); cursor: pointer; }
  .albody { color: var(--vb-ink-soft); font-family: var(--vb-font-mono); font-size: var(--vb-fs-micro); }
</style>
```

- [ ] **Step 5: Write `[domain]/+page.svelte` (full-page render)**

```svelte
<script lang="ts">
  import DomainRecord from '$lib/components/DomainRecord.svelte';
  let { data } = $props();
</script>

<a class="back" href="/domains">← Domain log</a>
<DomainRecord detail={data.detail} />

<style>
  .back { display: inline-block; margin-bottom: var(--vb-s4); font: var(--vb-fs-small) / 1 var(--vb-font-mono); color: var(--vb-accent); text-decoration: none; }
</style>
```

- [ ] **Step 6: Add the sheet interceptor to `/domains/+page.svelte`**

In the `<script>` add:

```ts
import { preloadData, pushState, goto } from '$app/navigation';
import Sheet from '$lib/components/Sheet.svelte';
import DomainRecord from '$lib/components/DomainRecord.svelte';

let sheetOpen = $state(false);
let sheetDetail = $state<
  import('$lib/server/pipeline/review').ReviewDetail | null
>(null);

async function openSheet(e: MouseEvent, domain: string) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // let the browser handle it
  e.preventDefault();
  const href = `/domains/${encodeURIComponent(domain)}`;
  const result = await preloadData(href);
  if (result.type === 'loaded' && result.status === 200) {
    sheetDetail = (result.data as any).detail;
    sheetOpen = true;
    pushState(href, { sheet: true });
  } else {
    void goto(href);
  }
}

// close the sheet when the user navigates back (pushState entry popped)
import { page as pageStore2 } from '$app/stores';
$effect(() => {
  if (!$pageStore2.state || !($pageStore2.state as any).sheet)
    sheetOpen = false;
});
```

Change the domain link in the table to:

```svelte
<a
  href={`/domains/${encodeURIComponent(d.domain)}`}
  onclick={(e) => openSheet(e, d.domain)}
  data-sveltekit-noscroll
>{d.domain}</a>
```

At the end of the markup add:

```svelte
{#if sheetOpen && sheetDetail}
  <Sheet bind:open={sheetOpen} title={sheetDetail.domain} onclose={() => history.back()}>
    <DomainRecord detail={sheetDetail} />
  </Sheet>
{/if}
```

> Also add `import type { PageState } from './$types'` is **not** needed; the `{ sheet: true }` state is untyped app state. If `pushState`'s type complains, declare it in `src/app.d.ts`:
>
> ```ts
> declare global {
>   namespace App {
>     interface PageState {
>       sheet?: boolean;
>     }
>   }
> }
> ```
>
> Add that now (replace the empty `namespace App {}`).

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm exec vitest run tests/server/routes/domain-detail-load.test.ts && pnpm check`
Expected: PASS.

- [ ] **Step 8: Dev smoke — both renders**

`pnpm dev`. Seed 2–3 domains with a verdict each.

- Open `/domains/<name>` directly → full-page record with a "← Domain log" link.
- From `/domains`, click a domain → the record opens in a right-hand sheet, the list stays behind it, `Esc` closes it and the URL returns to `/domains`.
- The allowlist button toggles and the text updates.
  `Ctrl-C`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(sub2): domain detail as page + URL-addressable side sheet"
```

---

## Task 23: `/audit` master log

**Files:**

- Create: `src/routes/audit/+page.server.ts`
- Create: `src/routes/audit/+page.svelte`
- Test: `tests/server/routes/audit-load.test.ts`

**Interfaces:**

- Consumes: `listAudit` (Task 10); components `Masthead`, `LogTable`, `Pagination`, `Select`, `EmptyState`, `RelativeTime`; `$app/navigation` (`goto`); `format.ts`.
- Produces: `/audit/+page.server.ts` `load({ url, depends })` → `{ result: AuditListResult; event: string; actor: string }`, reads `?event=&actor=&page=`, `depends('vb:data')`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/routes/audit-load.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestDb, type TestDb } from '../../helpers/test-db';

let tdb: TestDb;
beforeEach(async () => {
  tdb = await makeTestDb();
  vi.doMock('$lib/server/db/index', () => ({ db: tdb.db, schema: tdb.schema }));
});
afterEach(() => {
  vi.doUnmock('$lib/server/db/index');
  vi.resetModules();
  tdb.close();
});

describe('/audit load', () => {
  it('filters by event', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.auditLog).values([
      {
        at: 10,
        actor: 'user',
        domainId: null,
        event: 'decision.approve',
        data: {}
      },
      {
        at: 20,
        actor: 'system',
        domainId: null,
        event: 'domain.transition',
        data: {}
      }
    ]);
    const { load } = await import('../../../src/routes/audit/+page.server');
    const res = await (load as any)({
      url: new URL('http://x/audit?event=decision.approve'),
      depends: vi.fn()
    });
    expect(res.event).toBe('decision.approve');
    expect(res.result.items).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/server/routes/audit-load.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `+page.server.ts`**

```ts
import { db, schema } from '$lib/server/db/index';
import { listAudit } from '$lib/server/pipeline/audit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, depends }) => {
  depends('vb:data');
  const event = url.searchParams.get('event') ?? '';
  const actor = url.searchParams.get('actor') ?? '';
  const page = Number(url.searchParams.get('page') ?? '1') || 1;
  const result = await listAudit(db, schema, {
    event: event || undefined,
    actor: actor || undefined,
    page
  });
  return { result, event, actor };
};
```

- [ ] **Step 4: Write `+page.svelte`**

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page as pageStore } from '$app/stores';
  import { onMount } from 'svelte';
  import { startAutoRefresh } from '$lib/client/auto-refresh';
  import Masthead from '$lib/components/Masthead.svelte';
  import LogTable from '$lib/components/LogTable.svelte';
  import Pagination from '$lib/components/Pagination.svelte';
  import Select from '$lib/components/Select.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import RelativeTime from '$lib/components/RelativeTime.svelte';
  import { formatCount } from '$lib/format';

  let { data } = $props();
  onMount(() => startAutoRefresh());

  const EVENTS = [
    { value: '', label: 'All events' },
    { value: 'domain.transition', label: 'Domain transition' },
    { value: 'decision.approve', label: 'Decision — block' },
    { value: 'decision.reject', label: 'Decision — keep' },
    { value: 'assess.error', label: 'Assess error' },
    { value: 'allowlist.add', label: 'Allowlist add' },
    { value: 'allowlist.remove', label: 'Allowlist remove' }
  ];
  const ACTORS = [
    { value: '', label: 'Any actor' },
    { value: 'user', label: 'user' },
    { value: 'system', label: 'system' },
    { value: 'metadefender', label: 'metadefender' },
    { value: 'ai', label: 'ai' },
    { value: 'virustotal', label: 'virustotal' },
    { value: 'curated_list', label: 'curated_list' }
  ];

  function apply(next: Record<string, string>) {
    const q = new URLSearchParams($pageStore.url.searchParams);
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    q.delete('page');
    void goto(`/audit?${q.toString()}`, { keepFocus: true, noScroll: true });
  }
</script>

<Masthead
  title="Accession register — audit log"
  counts={[{ label: 'Entries', value: formatCount(data.result.total) }]}
/>

<div class="filters">
  <Select name="event" label="Event" value={data.event} options={EVENTS} onchange={(v) => apply({ event: v, actor: data.actor })} />
  <Select name="actor" label="Actor" value={data.actor} options={ACTORS} onchange={(v) => apply({ event: data.event, actor: v })} />
</div>

{#if data.result.items.length === 0}
  <EmptyState title="No events in this range">
    <a href="/audit">Clear filters</a>
  </EmptyState>
{:else}
  <LogTable columns={['Time', 'Event', 'Actor', 'Domain', 'Detail']}>
    {#each data.result.items as e (e.id)}
      <tr>
        <td><RelativeTime at={e.at} /></td>
        <td class="mono">{e.event}</td>
        <td class="mono">{e.actor}</td>
        <td class="mono dom">{e.domain ?? '—'}</td>
        <td><pre class="data">{JSON.stringify(e.data)}</pre></td>
      </tr>
    {/each}
  </LogTable>
  <Pagination page={data.result.page} pageCount={data.result.pageCount} />
{/if}

<style>
  .filters { display: flex; gap: var(--vb-s4); margin-bottom: var(--vb-s4); flex-wrap: wrap; }
  .mono { font-family: var(--vb-font-mono); }
  .dom { color: var(--vb-accent); word-break: break-all; }
  .data { margin: 0; font-size: var(--vb-fs-micro); color: var(--vb-ink-soft); white-space: pre-wrap; word-break: break-all; max-width: 320px; }
</style>
```

- [ ] **Step 5: Run test + typecheck + dev smoke**

Run: `pnpm exec vitest run tests/server/routes/audit-load.test.ts && pnpm check`
Expected: PASS. `pnpm dev` → `/audit`; with a few audit rows, the table + both filters + pagination work. `Ctrl-C`.

- [ ] **Step 6: Full suite + coverage**

Run: `pnpm test:cov`
Expected: PASS, gate ≥ 90 %. Every `src/routes/**/*.ts` load and action now has a test; every `src/lib/server/pipeline/*` and the new `repo` functions are covered.

- [ ] **Step 7: Commit**

```bash
git add src/routes/audit tests/server/routes/audit-load.test.ts
git commit -m "feat(sub2): /audit master log with filters"
```

---

## Task 24: Playwright end-to-end flows

Two specs — the review→audit journey (the only mutation path) and the domains→side-sheet
flow (the only tricky client-side routing). Audit/queue filters are already covered by the
loader unit tests (Tasks 10, 8); re-testing them through a browser buys nothing.

**Files:**

- Create: `playwright.config.ts`
- Create: `tests/e2e/seed.ts`
- Create: `tests/e2e/global-setup.ts`
- Create: `tests/e2e/review.spec.ts`
- Create: `tests/e2e/domains.spec.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `.gitignore` (add `data/e2e.db*`, `test-results/`, `playwright-report/`)

Vitest matches `tests/**/*.test.ts`; these are `*.spec.ts`, so no `vitest.config.ts` change.

**Interfaces:**

- Consumes: the built app (`node build`), a seeded SQLite file.
- Produces: `pnpm test:e2e` runs 2 specs headless against a preview server on port 4173.

- [ ] **Step 1: Write `tests/e2e/seed.ts`**

```ts
// tests/e2e/seed.ts — build a deterministic SQLite DB for the E2E preview server.
import { rmSync, mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../src/lib/server/db/schema.sqlite';

export const E2E_DB_PATH = 'data/e2e.db';

export async function seedE2eDb(): Promise<void> {
  for (const suffix of ['', '-wal', '-shm'])
    rmSync(`${E2E_DB_PATH}${suffix}`, { force: true });
  mkdirSync('data', { recursive: true });

  const sqlite = new Database(E2E_DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: './drizzle/sqlite' });

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
```

- [ ] **Step 2: Write `tests/e2e/global-setup.ts`**

```ts
import { seedE2eDb } from './seed';

export default async function globalSetup() {
  await seedE2eDb();
}
```

- [ ] **Step 3: Write `playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  globalSetup: './tests/e2e/global-setup.ts',
  use: { baseURL: 'http://localhost:4173', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node build',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: '4173',
      VB_DATABASE_URL: 'file:./data/e2e.db',
      VB_DISABLE_SCHEDULERS: 'true'
    }
  }
});
```

> The `webServer` runs `node build`, so a fresh `pnpm build` must have happened first. `test:e2e` in `package.json` is just `playwright test`; run `pnpm build && pnpm test:e2e` locally, and make CI do the same (Step 9).

- [ ] **Step 4: Write `tests/e2e/review.spec.ts`**

```ts
import { expect, test } from '@playwright/test';

test('block a domain from the review queue and see it in the audit log', async ({
  page
}) => {
  await page.goto('/review');
  const entry = page.locator('article', { hasText: 'tracker.ads.example' });
  await expect(entry).toBeVisible();

  await entry.getByRole('button', { name: 'Block it' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('/blocklist.txt');
  await dialog.getByRole('button', { name: 'Confirm block' }).click();

  // feedback is the entry dropping out of the list
  await expect(
    page.locator('article', { hasText: 'tracker.ads.example' })
  ).toHaveCount(0);

  await page.goto('/audit?event=decision.approve');
  await expect(
    page.locator('td', { hasText: 'decision.approve' }).first()
  ).toBeVisible();
});
```

- [ ] **Step 5: Write `tests/e2e/domains.spec.ts`**

```ts
import { expect, test } from '@playwright/test';

test('search domains and open a record in the side sheet', async ({ page }) => {
  await page.goto('/domains');
  await page.getByPlaceholder('domain contains…').fill('tracker');
  await page.getByRole('button', { name: 'Filter' }).click();
  await expect(page).toHaveURL(/search=tracker/);

  const row = page.locator('tbody tr', { hasText: 'tracker.ads.example' });
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: 'tracker.ads.example' }).click();

  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText('Score derivation');
  await expect(sheet).toContainText('metadefender');
  await expect(page).toHaveURL(/\/domains\/tracker\.ads\.example/);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/domains(\?|$)/);
});
```

- [ ] **Step 6: Wire CI**

In `.github/workflows/ci.yml`, add a job alongside the existing one (mirror its `actions/checkout`, pnpm + Node 24 setup steps), then:

```yaml
e2e:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 24
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: pnpm exec playwright install --with-deps chromium
    - run: pnpm build
    - run: pnpm test:e2e
```

Match the exact `pnpm`/`setup-node` action versions the existing job uses (the repo's last CI commit pinned them). Add `data/e2e.db*`, `test-results/`, `playwright-report/` to `.gitignore`.

- [ ] **Step 7: Run locally**

Run: `pnpm build && pnpm test:e2e`
Expected: 2 specs pass. If the server does not come up, check that `node build` respects `PORT=4173` (adapter-node does) and that `data/e2e.db` was seeded by `globalSetup`.

- [ ] **Step 8: Commit**

```bash
git add playwright.config.ts tests/e2e .github/workflows/ci.yml .gitignore package.json
git commit -m "test(sub2): Playwright E2E for the review and domains flows"
```

---

## Task 25: Design README + final verification + handoff

**Files:**

- Create: `src/lib/design/README.md`
- Modify: `CLAUDE.md` (fill in the real build/lint/test commands + architecture, per its own instruction)

**Interfaces:** none — documentation + verification only.

- [ ] **Step 1: Write `src/lib/design/README.md`**

Document, in prose + a table:

- The token names from `tokens.css` grouped as ground / ink / rule / accent / status (`--vb-st-<domainstate>`) / spacing (`--vb-s1`…`--vb-s6`) / type (`--vb-fs-*`, `--vb-font-*`, `--vb-head-stretch`) / misc (`--vb-radius`, `--vb-line`, `--vb-motion`, `--vb-shadow-sheet`).
- Each component in `src/lib/components/` with its prop signature (copy the `$props()` types).
- The two conventions: `depends('vb:data')` in every load + `invalidate('vb:data')` to refresh; SSE via `getContext('vb:sse')` returning `EventStream`.
- The note that Melt UI is used only for `Dialog`/`Sheet`, filters use the native `Select`, and there are no web fonts (system stacks; a real condensed face is a deliberate later change).

- [ ] **Step 2: Update `CLAUDE.md`**

Replace the "pre-code / planning stage" paragraph with the real state: SvelteKit app, `pnpm` scripts (`dev`, `build`, `test`, `test:pg`, `test:cov`, `test:e2e`, `check`, `lint`, `format`, `db:generate`, `db:migrate`), the `src/lib/server/**` pipeline + `src/routes` UI split, Drizzle dual-dialect, the `vb:data` / SSE conventions, and a pointer to `docs/specs/` + `docs/plans/`. Keep the "Non-Negotiable instructions" section verbatim.

- [ ] **Step 3: Full verification — run every gate**

```bash
pnpm lint
pnpm check
pnpm test:cov
pnpm build
pnpm test:e2e
```

Expected: all green. Coverage ≥ 90 % lines/functions/statements, ≥ 80 % branches. If a `src/routes/**/*.ts` file is dragging coverage, add the missing loader test — do not lower the threshold.

- [ ] **Step 4: Postgres pass**

If a local Postgres is reachable: `pnpm test:pg`. Expected: green (same as CI's Postgres matrix leg).

- [ ] **Step 5: Commit**

```bash
git add src/lib/design/README.md CLAUDE.md
git commit -m "docs(sub2): design-system README + refreshed CLAUDE.md"
```

- [ ] **Step 6: Impeccable finish review (UX/UI owner)**

Sub-project #2's visual direction was set through the `impeccable` skill and Impeccable holds final say on UX/UI. Before this branch merges, invoke:

```
/impeccable polish src/routes
```

Impeccable runs its own screenshot/critique/finish-review cycle against the `docs/specs/2026-09-05-dashboard-audit-ui-design.md` §3 direction contract, then writes `DESIGN.md`. Apply what it returns as a final commit (`design(sub2): Impeccable finish pass`). Do **not** merge before `DESIGN.md` exists — per the spec's FINISH line, "unreviewed and undocumented is unfinished".

- [ ] **Step 7: Wrap the branch**

Use the `superpowers:finishing-a-development-branch` skill to decide integration (PR vs. direct merge). The PR description should link the spec and this plan and list the six screens.

---

## Self-Review

**Spec coverage** — every spec section maps to a task:

| Spec section                                                 | Task(s)                                                                                                                                            |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| §2 goals — visual world + DESIGN.md                          | 12–17 (world), 25 step 6 (DESIGN.md via Impeccable)                                                                                                |
| §2 goals — component kit + tokens                            | 12, 13, 14, 15, 25                                                                                                                                 |
| §2 goals — six routes                                        | 17 (shell), 18 (review), 19 (dashboard), 20 (queue), 21 (domains), 22 (detail), 23 (audit)                                                         |
| §2 goals — SSE + background revalidation, no reload          | 3, 4, 16, 17; per-screen wiring in 18, 20; `autoRefresh` in 19, 21, 23                                                                             |
| §2 goals — reads via `+page.server.ts`, only new HTTP is SSE | all route tasks; 18 step 4 deletes `GET /api/review`                                                                                               |
| §2 goals — pure read models                                  | 7, 8, 9, 10                                                                                                                                        |
| §2 goals — ≥ 90 % on `.ts`, `.svelte` excluded               | 1 step 3; enforced at 11, 18, 23, 25                                                                                                               |
| §2 goals — CI both engines                                   | 6 step 6, 25 step 4; §CI Playwright job 24 step 9                                                                                                  |
| §2 non-goals                                                 | respected — no auth, no cost charts, no settings, no Valkey, no replay buffer, no gatekeeper writes                                                |
| §3 visual direction                                          | 12 (tokens), 13–15 (components), 17–23 (screens); audited in 25 step 6                                                                             |
| §4 screens table                                             | 17–23                                                                                                                                              |
| §4.1 side-sheet dual render                                  | 22 (steps 4–6, `preloadData` + `pushState`)                                                                                                        |
| §4.2 queue contents                                          | 8 (read model), 20 (screen)                                                                                                                        |
| §5.1 component map                                           | 3, 4, 7–10, 12–17                                                                                                                                  |
| §5.2 pipeline event publishers                               | 5                                                                                                                                                  |
| §5.3 data-loading rules                                      | 16, plus `depends`/`invalidate` in every route task; `getReviewDetail` extension in 11                                                             |
| §5.4 component kit scope                                     | 14 (Select instead of Combobox — noted), 15 (Melt Dialog/Sheet)                                                                                    |
| §6 data shapes                                               | 7 (`DashboardView`), 8 (`QueueView`), 9 (`DomainListItem`), 10 (`AuditEntry`), 11 (`ReviewDetail` fields)                                          |
| §7 states & edge cases                                       | `EmptyState` usage in 18–23; `EXCEPTION`/paused stamps in 20; "never pulled" in 19                                                                 |
| §8 testing                                                   | unit in 2–11, 17–23; 2 Playwright flows in 24                                                                                                      |
| §9 build order                                               | task order 1→25 follows it                                                                                                                         |
| §10 open decisions                                           | 22 resolves `pushState` vs. context (uses `pushState` + app state); no web fonts in 12; dark mode is `@media` only, a manual toggle deferred to #4 |
| §11 traceability                                             | dashboard/queue → goal 2; audit + per-domain log → goal 3; coverage/CI → goals 7/8                                                                 |

**Ponytail (ultra) cuts applied after the first draft** — spec §3's "first-class dark theme" and §8's E2E list still hold; these trim implementation, not scope:

- **No JS theme layer.** `@media (prefers-color-scheme: dark)` in `tokens.css` is the whole thing. Cut: `theme.ts`, `tests/lib/theme.test.ts`, the `app.html` no-flash script, the toggle button, `theme.spec.ts`. A manual override is sub-project #4's (settings) job.
- **No toast system.** The review entry vanishing from the list on `invalidate` is the success signal; errors render inline in the decision `Dialog`. Cut: `toast.ts`, `Toaster.svelte`.
- **`RelativeTime` has no per-instance timer** — rendered once; the SSE/20 s reload refreshes it. (A 50-row audit page was going to spin up 50 `setInterval`s.)
- **Playwright: 2 specs, not 5.** Kept: review→audit (the one mutation) and domains→side-sheet (the one non-trivial client route). Dropped audit-filter/queue/theme specs — their logic is in loader unit tests.

**Placeholder scan:** no `TBD`/`TODO`/"handle edge cases"/"similar to Task N". One spot defers to the reader with a _named, bounded_ choice and full context: Task 22 step 3's `appendAudit` `domainId` note (confirm the signature in `audit/log.ts`). That is a real detail of existing code, not missing content.

**Type consistency check:**

- `invalidate('vb:data')` / `depends('vb:data')` — same literal everywhere (16–23).
- `EventStream` — defined in 16 (`sse.ts`), consumed via `getContext<EventStream>('vb:sse')` in 17, 18, 20.
- `VbEvent` union — defined in 3, imported type-only in 16; event `type` strings (`assess.start`, `assess.done`, `verdict`, `domain.state`, `decision`) match between 3, 5, and the screen handlers in 18/20.
- `ReviewListItem` — existing type from `pipeline/review.ts`, consumed by `ReviewEntry` (18) and dashboard (19).
- `ReviewDetail` — extended in 11 with `allowlist` + `rawBySource`; consumed by `DomainRecord` (22).
- `DomainListResult` / `AuditListResult` — defined in 9 / 10, consumed in 21 / 23.
- `startAutoRefresh` (16) — called in 19, 21, 23. `createEventStream` (16) — called in 17.
- Repo functions named in Task 6 Interfaces match their call sites: `countDomainsByState` (7, 17), `listRecentBlocklistFetches` (7, 18, 19), `searchDomains`/`countDomainsMatching` (9), `listAuditRows`/`countAuditRows` (10, 19), `countBacklogForSource`/`getAllSourceRateState`/`getIngestState` (8), `getAllowlistRow`/`addAllowlist`/`removeAllowlist` (11, 22).
- `stateStampText`/`stateLabel`/`scoreLabel`/`relativeTime`/`formatDuration`/`formatCount`/`formatUsd`/`verdictLabel` — all defined in Task 2, used with matching arity in 13, 18–23.

No mismatches found.

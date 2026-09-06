# Veerabahu design system

The visual layer for the dashboard/audit UI (sub-project #2). This is the reference
for sub-projects #3–#5: reuse these tokens and components, follow these conventions.

`DESIGN.md` at the repo root (written by Impeccable at sub-project #2 finish) is the
authority on the visual _direction_ — voice, hierarchy, the "Disposition Log" concept.
This file is the mechanical reference: what the tokens are and what props each
component takes.

---

## 1. Tokens — `src/lib/design/tokens.css`

Every component reads these custom properties; nothing hard-codes a colour. Dark mode
is `@media (prefers-color-scheme: dark)` only — the file redefines the colour tokens
under that media query and nothing else. **There is no JS theme layer.** A manual
light/dark toggle is sub-project #4's job (settings).

Import once, in `src/routes/+layout.svelte`: `import '$lib/design/tokens.css';`
(also sets `box-sizing`, base `body` type/colour, and a `prefers-reduced-motion` reset).

### Ground (surfaces)

| Token                | Light     | Dark      |
| -------------------- | --------- | --------- |
| `--vb-ground`        | `#f2eee3` | `#14181b` |
| `--vb-ground-raised` | `#fbf9f3` | `#1b2024` |
| `--vb-ground-sunk`   | `#e9e3d3` | `#101416` |

### Ink (text)

| Token            | Light     | Dark      |
| ---------------- | --------- | --------- |
| `--vb-ink`       | `#1e2a32` | `#e7e0d2` |
| `--vb-ink-soft`  | `#566169` | `#a0a6a8` |
| `--vb-ink-faint` | `#8b9198` | `#6d7477` |

### Rule (borders)

| Token              | Light     | Dark      |
| ------------------ | --------- | --------- |
| `--vb-rule`        | `#d8d0c0` | `#2c3236` |
| `--vb-rule-strong` | `#b9ae98` | `#3c444a` |

### Accent

| Token             | Light     | Dark      |
| ----------------- | --------- | --------- |
| `--vb-accent`     | `#b4472e` | `#d6674b` |
| `--vb-accent-ink` | `#ffffff` | `#14181b` |

### Status — `--vb-st-<domainstate>`

One colour per `DomainState`. `StatusEdge` / `Stamp` build their colour from
`var(--vb-st-{state})`, so the state string must match a token name exactly.

| Token                    | State            | Light     | Dark      |
| ------------------------ | ---------------- | --------- | --------- |
| `--vb-st-observed`       | `observed`       | `#8a7e68` | `#a99a7e` |
| `--vb-st-assessing`      | `assessing`      | `#b6801f` | `#d19a3a` |
| `--vb-st-pending_review` | `pending_review` | `#2e63a8` | `#5b91d6` |
| `--vb-st-auto_cleared`   | `auto_cleared`   | `#9a9488` | `#7f8a8f` |
| `--vb-st-approved`       | `approved`       | `#2f7d4f` | `#4fa571` |
| `--vb-st-rejected`       | `rejected`       | `#7c7c7c` | `#9aa0a2` |

### Spacing — `--vb-s1` … `--vb-s6`

| Token     | Value  |
| --------- | ------ |
| `--vb-s1` | `4px`  |
| `--vb-s2` | `8px`  |
| `--vb-s3` | `12px` |
| `--vb-s4` | `16px` |
| `--vb-s5` | `24px` |
| `--vb-s6` | `40px` |

### Type

| Token               | Value                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `--vb-fs-micro`     | `11px`                                                                                   |
| `--vb-fs-small`     | `12.5px`                                                                                 |
| `--vb-fs-body`      | `14px`                                                                                   |
| `--vb-fs-h3`        | `16px`                                                                                   |
| `--vb-fs-h2`        | `20px`                                                                                   |
| `--vb-fs-h1`        | `26px`                                                                                   |
| `--vb-font-mono`    | `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace` |
| `--vb-font-sans`    | `system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`             |
| `--vb-font-head`    | `'Arial Narrow', 'Roboto Condensed', var(--vb-font-sans)`                                |
| `--vb-head-stretch` | `85%` — paired with `--vb-font-head` as `font-stretch` for the condensed headline look   |

**No web fonts.** Headings lean on the system condensed stack (`Arial Narrow` /
`Roboto Condensed`) plus `font-stretch`. Shipping a real condensed display face is a
deliberate later change and must be recorded in `DESIGN.md` when it happens.

### Misc

| Token               | Value                                                              |
| ------------------- | ------------------------------------------------------------------ |
| `--vb-radius`       | `2px`                                                              |
| `--vb-line`         | `1px solid var(--vb-rule)`                                         |
| `--vb-motion`       | `140ms ease-out`                                                   |
| `--vb-shadow-sheet` | `-8px 0 32px rgba(20, 24, 27, 0.18)` (dark: `rgba(0, 0, 0, 0.45)`) |

---

## 2. Components — `src/lib/components/`

Prop signatures are copied verbatim from each file's `$props()`. `Snippet` is
`import type { Snippet } from 'svelte'`.

| Component             | `$props()` signature                                                                                                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dialog.svelte`       | `{ open?: boolean; title: string; children: Snippet }` — `open` is `$bindable(false)`. Melt UI `createDialog`.                                                                                                                                  |
| `DomainRecord.svelte` | `{ detail: ReviewDetail }` (`ReviewDetail` from `$lib/server/pipeline/review`). Renders the full domain dossier: status edge, score derivation, verdicts, allowlist, raw-by-source, and the approve/reject form (`enhance`).                    |
| `EmptyState.svelte`   | `{ title: string; hint?: string; children?: Snippet }` — `children` is the optional action slot.                                                                                                                                                |
| `LogTable.svelte`     | `{ columns: string[]; children: Snippet }` — `children` is the `<tbody>` content. Horizontal scroll wrapper built in.                                                                                                                           |
| `Masthead.svelte`     | `{ title: string; counts: { label: string; value: string \| number }[] }` — page title + stat row.                                                                                                                                              |
| `Pagination.svelte`   | `{ page: number; pageCount: number; param?: string }` (`param` default `'page'`). Renders nothing when `pageCount <= 1`; links are `?<param>=n` with `data-sveltekit-noscroll`.                                                                 |
| `RelativeTime.svelte` | `{ at: number \| null }` — epoch ms; renders `<time>` via `relativeTime()`, or `never` when null. Rendered once, no per-instance timer (the SSE / 20 s reload refreshes it).                                                                    |
| `ReviewEntry.svelte`  | `{ item: ReviewListItem; lastPullAt: number \| null; ondecided?: () => void }` (`ReviewListItem` from `$lib/server/pipeline/review`). One review row + the decision `Dialog`; calls `invalidate('vb:data')` and `ondecided()` after a decision. |
| `ScoreBracket.svelte` | `{ score: number \| null; verdicts: { source: string; verdict: string; confidence: number }[] }` — visual "inputs → summary" bracket.                                                                                                           |
| `Select.svelte`       | `{ value?: string; options: { value: string; label: string }[]; name: string; label: string; onchange?: (v: string) => void }` — `value` is `$bindable('')`. Native `<select>`; this is the filter control across screens.                      |
| `Sheet.svelte`        | `{ open?: boolean; title: string; onclose?: () => void; children: Snippet }` — `open` is `$bindable(false)`. Melt UI `createDialog` styled as a right-hand side-sheet; `onclose` fires on close (used to pop `pushState`).                      |
| `SseStatus.svelte`    | `{ state: 'connecting' \| 'live' \| 'down' }` — the live-updates dot/label in the nav bar. Feed it `$status` from the `EventStream`.                                                                                                            |
| `Stamp.svelte`        | `{ text: string; tone?: 'accent' \| 'muted' \| 'ok' }` (`tone` default `'accent'`) — rotated rubber-stamp label.                                                                                                                                |
| `StatusEdge.svelte`   | `{ state: DomainState; label?: string }` (`DomainState` from `$lib/server/db/types`) — 3px coloured spine, `var(--vb-st-{state})`, with an SR-only label.                                                                                       |

### Client helpers

**`src/lib/client/sse.ts`**

- `type SseState = 'connecting' | 'live' | 'down'`
- `interface EventStream { status: Readable<SseState>; last: Readable<VbEvent | null>; close: () => void }`
- `createEventStream(): EventStream` — opens one `EventSource('/events')`, exposes
  connection status and the last parsed `VbEvent`. Called once in `+layout.svelte`
  and put on context as `vb:sse`. On reconnect it fires `invalidate('vb:data')`.
  SSR-safe (returns inert stores when `EventSource` is undefined).

**`src/lib/client/auto-refresh.ts`**

- `startAutoRefresh(ms = 20_000): () => void` — `setInterval` that calls
  `invalidate('vb:data')` while the tab is visible. Call in `onMount` on the
  poll screens (dashboard, domains, audit); return value is the cleanup.
  SSR-safe (no-op when `document` is undefined).

---

## 3. Conventions

- **Data loading.** Every `+page.server.ts` / `+layout.server.ts` load calls
  `depends('vb:data')`. Anything that should trigger a refresh calls
  `invalidate('vb:data')` — no manual `fetch`, no full reload. The only new HTTP
  endpoint the UI adds is `GET /events` (SSE).
- **SSE.** `+layout.svelte` does `createEventStream()` + `setContext('vb:sse', …)`.
  Screens that react to live events do
  `const sse = getContext<EventStream>('vb:sse')` and subscribe to `sse.last`
  (e.g. review, queue). `SseStatus` renders `$status` in the nav.
- **Auto-refresh.** Poll screens (dashboard, domains, audit) call
  `startAutoRefresh()` in `onMount` and clean up on unmount. Event-driven screens
  rely on SSE instead.
- **Melt UI is used ONLY for `Dialog` and `Sheet`** (both wrap `createDialog`).
  Every filter is the native `Select` (plain `<select>`), not Melt's Combobox.
- **No web fonts** — system stacks only (see tokens §Type). A real condensed
  display face is a deliberate future change, to be recorded in `DESIGN.md`.
- **Enum value constants** (`DOMAIN_STATES`, `SOURCE_NAMES`, `VERDICT_VALUES` and
  their types) live in `src/lib/domain-constants.ts`, which is client-safe (no
  `$lib/server` or drizzle imports). Browser code imports enums from there, **not**
  from `$lib/server/db/types` (that module is server-only; components may still
  `import type` from it, which erases at build).

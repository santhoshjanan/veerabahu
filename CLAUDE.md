# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Veerabahu is now a running SvelteKit 2 + Svelte 5 (Runes) + TypeScript app.

**pnpm only.** Scripts (`package.json`):

- `pnpm dev` — Vite dev server
- `pnpm build` — production build (`adapter-node`; schedulers disabled during build)
- `pnpm test` — Vitest (Node env, `tests/**/*.test.ts`); `pnpm test:pg` runs the same
  suite against a local Postgres on `:5432`; `pnpm test:cov` adds v8 coverage and enforces
  the gate (≥ 90 % lines/functions/statements, ≥ 80 % branches on `src/lib/**` +
  `src/routes/**/*.ts`; `.svelte` and `src/lib/client/**` are excluded as browser-only)
- `pnpm test:e2e` — Playwright end-to-end specs
- `pnpm check` — `svelte-kit sync` + `svelte-check` (must be 0 errors / 0 warnings)
- `pnpm lint` — `prettier --check .`; `pnpm format` — `prettier --write .`
- `pnpm db:generate` — Drizzle migration codegen; `pnpm db:migrate` — apply migrations

**Architecture.**

- `src/lib/server/**` — the enrichment pipeline (sub-project #1): DNS-query ingestion,
  domain reputation sources, scoring, review queue, blocklist derivation, audit log.
  Server-only; never imported by browser code.
- `src/routes/**` — the dashboard/audit UI (sub-project #2): six screens (log, queue,
  review, domains, domain detail, audit) reading through `+page.server.ts` loads. Design
  system in `src/lib/design/` — see `src/lib/design/README.md`.
- **Drizzle, dual-dialect.** SQLite by default (`file:./data/veerabahu.db`), Postgres when
  `VB_DATABASE_URL` starts with `postgres` (`schema.sqlite.ts` / `schema.pg.ts`). CI runs
  the full test matrix on both engines.
- **Data-loading convention.** Every server load calls `depends('vb:data')`; any refresh
  is `invalidate('vb:data')` — no manual `fetch`, no full reload. The one new HTTP endpoint
  the UI adds is `GET /events`, an in-process SSE stream (`src/lib/server/events.ts`
  publish/subscribe → `src/routes/events/+server.ts` → `src/lib/client/sse.ts` on the
  client, put on Svelte context as `vb:sse`).

**Docs.** Specs live in `docs/specs/`, implementation plans in `docs/plans/`
(plus `docs/master-requirements.md`). `DESIGN.md` at the repo root — written by Impeccable
at the sub-project #2 finish pass — is the authority on the visual system.

## Non-Negotiable instructions to coding agents

### Token frugality

If a task can be done with a smaller model, spawn a subagent with a smaller model to execute it. E.g: Haiku instead of Sonnet or Opus (Anthropic), Luna instead of Sol (OpenAI) and so on. Use tokens efficiently.

### UX Decisions

All UX decisions must be taken by Impeccable (Plugin).

## Project concept

Veerabahu is a sidecar for Pi-hole / AdGuard Home. Pi-hole/AdGuard already block DNS
requests against a static preset blocklist (Level 1), but ad/tracker domains not on that list
still get through. This project's job (Level 2) is to sit alongside the gatekeeper, pull the
list of DNS queries/allowed domains from it via API, assess domain reputation (e.g. VirusTotal,
AI-based analysis) autonomously or semi-autonomously with a human in the loop, and feed a
derived blocklist back to the gatekeeper — a positive feedback loop that keeps strengthening
the blocklist over time.

Intended stack (not yet implemented):

- SvelteKit 2 + Svelte 5 (Runes) + TypeScript
- Melt UI for components
- PostgreSQL or SQLite
- Valkey for caching/queueing
- LangChain (or similar) for the AI domain-reputation assessment

Other stated goals: a rich dashboard, audit trails, observability for AI calls/cost, a detailed
settings section, an onboarding wizard, >90% test coverage, CI, and consent-based anonymized
usage collection — all privacy/security-first.

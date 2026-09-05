# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repository is at the pre-code / planning stage — there is no application code, build tooling,
or test suite yet. The only substantive file is `idea.md` (see below), which is intentionally
gitignored (not meant to be committed). There are no commands to build, lint, or test because
nothing has been scaffolded yet.

When code is added, update this file with real build/lint/test commands and the actual
architecture — do not guess at them in the meantime.

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

# Whole-branch fix report

Date: 2026-09-06
Worktree: `.worktrees/settings-onboarding`
Base: `51eb7d2` (`docs: release compose container before recovery`)
Status: implementation complete; PostgreSQL and browser execution remain host blockers.

Read the complete Settings & Onboarding design spec and implementation plan before changing code. Applied the single comprehensive review fix pass without subagents or new dependencies. Ponytail kept the repairs in the existing store, runtime, validation, hooks, and test fixtures.

## Findings repaired

| Finding | Repair | Regression evidence |
| --- | --- | --- |
| Critical: setup anonymously usable after password creation | Hook checks the actual `local_admin` record. Only initial access creation remains anonymous; setup loads and actions independently require the admin session after creation. The new session is attached to request locals so ordinary form submissions can render the next step. | Auth-hook and setup-action tests; real HTTP onboarding creates access, rejects anonymous reads and all five actions, completes authenticated setup, and keeps `/blocklist.txt` public. |
| 1. Runtime races create duplicate/orphan workers | Queue start/restart/stop transitions. Restart waits for stop; stop also waits for pending startup. Ingestion and drainer stop their timers and await in-flight work before replacement. | Concurrent starts/restarts never exceed one live handle; pending startup is stopped; real ingestion and drainer shutdown wait for active work. |
| 2. Concurrent section saves lose categories | Serialize both store entrypoints before read/merge/write. Source/quota actions construct dependent patches from the latest settings within that serialization, including setup back-navigation saves. Existing transactions retain atomic config/credential/audit writes. | Concurrent store entrypoints preserve weights and system changes; concurrent Settings source/pricing changes preserve both; HTTP setup concurrently saves sources and prices before successful activation. |
| 3. AI cost ceiling silently ineffective without prices | Enabled AI with a positive daily ceiling requires both input and output prices. Validation errors identify price fields. Existing persisted cost governor remains in use. | Store rejects the unpriced configuration and accepts explicit prices; existing AI costing and governor ceiling tests pass. |
| 4. Defaults activate no actual reputation source | Require at least one curated-list URL when curated lists are enabled by the source step. An operator can instead disable curated lists and configure another source. Remove the inaccurate built-in-lists summary. | Default incomplete configuration cannot complete the source step without URLs; HTTP wizard rejects empty URLs and proceeds after an explicit URL. |
| 5. Browser fixtures lack auth/isolation and reuse stale URLs | Shared per-test fixtures reset the existing preview database, seed configured or fresh onboarding state, create a live gatekeeper stub, persist its current URL, and log in configured pages. All older browser tests use these fixtures. | Playwright discovers seven tests. Both HTTP tests pass against the built server, including sequential fresh/configured seeds and the current stub URL. Browser tests reach the host launch blocker. |
| 6. Damaged unrelated credentials block saves and shutdown | Existing unchanged credential failures do not reject unrelated section saves. New enablement/endpoints and activation retain strict credential validation. Runtime excludes optional sources with unreadable credentials while retaining usable sources. Shutdown avoids credential reads once inactive. | Tamper a configured source; save weights and stop successfully; activation still fails. Runtime retains curated lists when an optional source cannot decrypt. |
| 7. Editable blocklist path does not match routing | Remove the System path input, fix legacy environment configuration to `/blocklist.txt`, and normalize previously persisted paths to the public endpoint on read. | Legacy/custom settings resolve to `/blocklist.txt`; real Settings HTML links to the endpoint and exposes no path input; public endpoint route test passes. |
| 8. Compose upgrades no longer pass legacy environment | Add `docker-compose.legacy.yml` with an explicit `.env` import and document exact first-upgrade and normal-restart commands. Preserve one-time DB precedence. | Compose merges/validates the override with environment resolution disabled; store import tests preserve legacy URLs, fixed endpoint, and later DB changes. |
| 9. AdGuard pages indefinitely before `since` | Only emit another cursor if a full page still extends past the lower boundary. Stop at or before `since`, including wholly old pages. | Exact-boundary and entirely-old full-page tests return no next cursor. |
| 10. Initialization waits for the first request | Export SvelteKit's server `init` hook, skip build-time execution, and reuse the same initialization promise from requests. Invalid master keys fail startup before a listener is available. | Startup hook tests cover validation and once-only synchronization. Starting the production build with an empty key exits 1 with the explicit `VB_MASTER_KEY` error before serving requests. |

## Verification

- `pnpm check`: pass, 0 errors and 0 warnings.
- `pnpm test:cov`: all 246 tests in 53 files pass. Statements/lines: 92.32%; branches: 84.33%; functions: 95.31%. Coverage gate passes.
- `pnpm build`: pass. Existing mixed static/dynamic import and empty-chunk notices remain nonfatal.
- `git diff --check`: pass.
- Prettier check on every changed supported source/test/document/config file: pass.
- `pnpm lint`: two pre-existing formatting warnings only: `docs/specs/2026-09-05-settings-onboarding-design.md` and `task-9-report.md`. Neither was changed in this fix pass.
- `pnpm playwright test`: 2 HTTP tests pass; all 5 browser tests fail before execution with `browserType.launch: spawn Unknown system error -88` for the installed Chromium binary.
- `pnpm test:pg`: unavailable database; the run failed with connection errors (112 DB-dependent tests failed, 133 independent tests passed at that run). A direct diagnostic confirmed `ECONNREFUSED` for both `::1:5432` and `127.0.0.1:5432`. One additional SQLite worker-shutdown regression was added afterward, bringing the final suite to 246 tests.
- `docker compose -f docker-compose.yml -f docker-compose.legacy.yml config --no-env-resolution --no-interpolate`: pass with a synthetic master-key placeholder. No real `.env` contents were read or printed.
- Production startup with `VB_MASTER_KEY=` and a dedicated test SQLite path: exits 1 with `VB_MASTER_KEY must be strict Base64 for exactly 32 bytes` before serving requests.

## Remaining concerns

- PostgreSQL parity and browser interaction still need their existing CI environments; local failures are not recorded as passes. HTTP integration validates actual startup, request authentication, normal form submissions, concurrent setup saves, activation, public blocklist access, fixture isolation, and authenticated Settings.
- The settings lock and runtime ownership are process-local. The existing single-app-process deployment remains the supported scope; README and a `ponytail:` comment explicitly call for DB row locking before adding app workers.
- This change preserves the existing between-call AI spend governor. Broader provider billing/observability remains outside this Settings & Onboarding subproject.

No dependency, gatekeeper write, remote recovery, theme, telemetry, or multi-user functionality was added.

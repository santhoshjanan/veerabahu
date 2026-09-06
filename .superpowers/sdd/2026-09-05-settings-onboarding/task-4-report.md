# Task 4 Report: Configuration-driven runtime

## Delivered

- Added a singleton runtime manager with activation-gated `startIfActive()`, fail-closed `restart()`, and idempotent `stop()` lifecycle operations.
- Runtime startup reads stored settings, decrypts only the gatekeeper and enabled reputation-source credentials, converts them to the existing runtime configuration, and starts the scheduler only after onboarding is complete and activated.
- Moved scheduler singleton ownership out of bootstrap so runtime restarts replace the active ingestion and drainer loops without a queue or reconfiguration framework.
- Added stored source endpoints, quota policies, and scoring weights to runtime configuration while retaining the legacy environment defaults.
- Added minute/day/month pacing, monthly hard ceilings, and per-source daily cost ceilings using existing persisted counters and verdict-cost aggregation.
- Applied configured weights in the real domain-evaluation path, not only in the standalone score helper.

## TDD evidence

- The first focused run failed because the runtime module was absent, monthly and cost limits were ignored, and scoring ignored caller-supplied weights.
- Registry and endpoint tests then failed because sources still used built-in policies and URLs.
- The drainer cost test failed until daily spend was enforced, and its source-isolation case failed until aggregation filtered by source.
- A mutation check removing runtime weights from `evaluateDomain` made the integration test return the imported default score (`-0.25`) instead of the configured score (`0.5`); restoring the runtime weights returned it to green.

## Verification

- `pnpm vitest run tests/server/settings/runtime.test.ts tests/server/governor tests/server/scoring/score.test.ts` — 4 files and 32 tests passed.
- `pnpm vitest run` — 45 files and 175 tests passed.
- `pnpm check` — 0 errors and 0 warnings.
- `pnpm build` — production build passed.
- Task files were formatted with Prettier; `git diff --check` was clean.

## Deliberate boundaries

- No queue, generic reconfiguration layer, dependency, or settings cache was added.
- `startBackground` retains its legacy environment fallback for existing direct callers, but stored settings are the only input used by the new runtime manager.
- AdGuard runtime adapter creation and connection testing remain Task 5; an activated AdGuard configuration still cannot start the Pi-hole-only bootstrap path.
- Hook/session initialization remains Task 6, which will replace the current direct bootstrap call with `runtime.startIfActive()`.
- Repository-wide `pnpm lint` remains red on the pre-existing `docs/specs/2026-09-05-settings-onboarding-design.md`; no Task 4 file is implicated.

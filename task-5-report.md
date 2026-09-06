# Task 5 report

Implemented the read-only AdGuard Home gatekeeper adapter and explicit connection-test result mapping.

## Changes

- Added `makeAdguardAdapter` for `/control/querylog` reads, Basic authentication, timestamp normalization, timestamp cursors, gap detection, and `NotFiltered*`/`Filtered*` disposition mapping.
- Added `testGatekeeper` with `connected`, `auth_rejected`, `unreachable`, and `invalid_response` outcomes for Pi-hole and AdGuard. Credentials are not included in results or logs, and no scheduler is started.
- Added the shared connection-result type and selected the configured gatekeeper adapter at runtime startup.
- Added adapter and connection-test coverage.

## Verification

- `pnpm vitest run tests/server/adapters tests/server/settings`: 7 files, 31 tests passed.
- `pnpm vitest run`: 48 files, 186 tests passed.
- `pnpm check`: passed with 0 errors and 0 warnings.
- `git diff --check`: passed.
- `pnpm build`: passed.

## Concern

- `pnpm exec prettier --check .` reports an existing unrelated formatting issue in `docs/specs/2026-09-05-settings-onboarding-design.md`.
- AdGuard credentials now support the stored username plus password; query windows are bounded and pagination preserves the API's timestamp cursor/ties.
- Bootstrap adapter selection also honors AdGuard when called directly with `startBackground({ cfg })`.

# Task 9 report

## Changes

- Added `README.md` with Docker setup, strict `VB_MASTER_KEY` generation and
  handling guidance, first-run onboarding, local reset-and-onboard recovery,
  and read-only gatekeeper/adlist refresh instructions.
- Reduced `.env.example` to the master key plus database and process bootstrap
  values; removed legacy gatekeeper and reputation-source credentials.
- Updated `docker-compose.yml` to pass only the master key and database
  bootstrap into the service while retaining the data volume and commented
  Valkey service.
- Added deployment expectations to `tests/server/docker.test.ts` and a local
  recovery smoke expectation to `tests/server/smoke.test.ts`.

## Verification

| Command | Result |
| --- | --- |
| `pnpm vitest run tests/server/docker.test.ts tests/server/smoke.test.ts` (red) | Expected failure before docs changes: 3 failed, 3 passed |
| `pnpm vitest run tests/server/docker.test.ts tests/server/smoke.test.ts` (green) | PASS: 7 tests |
| `pnpm check` | PASS: 0 errors, 0 warnings |
| `pnpm test:cov` | PASS: 53 files, 229 tests |
| `pnpm build` | PASS |
| `pnpm lint` | BLOCKED by pre-existing formatting issue in `docs/specs/2026-09-05-settings-onboarding-design.md` |
| `pnpm test:pg` | BLOCKED: local PostgreSQL unavailable (`ECONNREFUSED`), causing 28 files / 106 tests to fail during setup |
| `pnpm playwright test` | BLOCKED: installed Chromium failed to launch (`spawn Unknown system error -88`) |
| `git diff --check` | PASS |

No real secrets were inspected or printed.

## Concerns

- Compose uses a named data volume, so recovery requires backing up/replacing
  the database through deployment tooling; the README explicitly warns not to
  delete the only copy.
- Full PostgreSQL and browser matrices should run in CI or an environment with
  those services and a working Playwright browser.

## Recovery documentation follow-up

The recovery section now identifies the Compose data volume by its Compose
label, requires a non-empty volume name, archives the volume to a local tarball,
removes only that validated volume, and recreates it with `docker compose up`.
Focused tests assert each backup and replacement safeguard.

The procedure also now fails fast and removes the stopped service container
before removing the named volume, ensuring Docker has released the volume.

# Task 6 report

Implemented password-only local-admin authentication, server-backed sessions, request guards, and the login route.

## Changes

- Added opaque 12-hour sessions. Browsers receive the token in an `HttpOnly`, `SameSite=Strict`, path-wide cookie with `Secure` enabled for HTTPS; the database stores only its SHA-256 hash.
- Added password verification and password changes using the existing scrypt primitives. A successful password change invalidates every active session atomically; a failed current-password check changes nothing.
- Replaced eager environment-based scheduler startup with one-time hook initialization: migrations run, legacy settings import is attempted, and the settings runtime starts only through `runtime.startIfActive()`.
- Added request guards that send incomplete instances to `/setup` and anonymous configured instances to `/login`. Setup, login, SvelteKit assets, and `/blocklist.txt` remain public; API endpoints and operational pages are protected.
- Added typed `event.locals.adminSession`. The root layout exposes only an authenticated boolean and suppresses operational counts for anonymous public pages.
- Added an accessible password-only login form with a non-secret validation error.

## TDD and verification

- Red phase: `pnpm vitest run tests/server/auth.test.ts tests/server/routes/auth-guard.test.ts` failed because the auth and login modules were absent and the old hook had no route guard.
- Green focused suite: 4 files, 15 tests passed, including the existing public blocklist route.
- Full suite: `pnpm vitest run` passed 50 files and 199 tests.
- `pnpm check` passed with 0 errors and 0 warnings.
- `pnpm build` passed.
- `git diff --check` passed.
- Changed TypeScript files pass focused Prettier checks. The login Svelte file passes `svelte-check`; this repo's Prettier installation has no Svelte parser for an explicit file check.
- Impeccable's detector returned no findings for the login page.

## Self-review

- Verified every Task 6 interface and redirect/cookie requirement against the approved brief.
- Verified the cookie token is absent from persisted session rows and session details are absent from layout data.
- Verified password-change invalidation uses a portable SQL null predicate for both SQLite and Postgres.
- Verified no route-prefix bypass exists for names such as `/login-evil` or `/setup-evil`; only exact route segments are public.

## Concerns

- Repo-wide `pnpm lint` still reports the pre-existing formatting issue in `docs/specs/2026-09-05-settings-onboarding-design.md`; Task 6 files are formatted.
- The build succeeds with Vite's existing chunking warnings because modules dynamically imported by the runtime are now also statically imported by the request hook.
- No Postgres service was configured locally, so the full suite exercised SQLite; the auth queries use the same portable Drizzle schema and query forms as the existing settings store.

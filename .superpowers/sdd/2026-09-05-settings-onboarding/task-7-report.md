# Task 7 Report: Required onboarding

## Delivered

- Added the resumable five-step setup route: Secure access, Gatekeeper, Reputation sources, Quota and scoring, and Review and activate.
- Added server actions for each persisted section plus an activation gate. Actions enforce step order, validate before saving, return non-secret form values on failure, replace only non-empty secrets, and expose the four precise gatekeeper test outcomes.
- Persisted successful gatekeeper testing through onboarding progress. Activation requires a tested gatekeeper and a fully valid credential-aware configuration, marks setup complete, restarts the runtime, and rolls activation back if runtime startup fails.
- The access step hashes the first local-admin password, creates the 12-hour strict session cookie, and never echoes password fields.
- Added `getSetupView`, returning the first incomplete step and `SafeSettings` only.
- Added shared `SecretField` and `SettingsSection` components, responsive progress/forms, configured-secret markers, activation summary, and gatekeeper guidance to pull `/blocklist.txt` roughly every hour. No theme or consent prompt was added.
- Added deterministic Playwright server environment values for `ORIGIN` and the test-only master key.

## TDD evidence

- The first focused Vitest run failed all five initial cases because the setup route did not exist.
- The first Playwright run failed before executing the test because the host could not spawn its bundled Chromium (`spawn Unknown system error -88`).
- The focused server suite turned green after the minimum action/load implementation; a later activation-success case brings it to 6 passing tests.
- A real built-server HTTP walkthrough verified protected-route redirect, all five action submissions, authenticated activation, and access to the log after activation.

## Verification

- `pnpm vitest run tests/server/routes/setup-actions.test.ts` — 6 tests passed.
- `pnpm vitest run` — 51 files and 208 tests passed.
- `pnpm check` — 0 errors and 0 warnings.
- `pnpm build` — production build passed.
- `git diff --check` — clean.
- Impeccable static detector over the changed setup/components/tokens — no findings.
- Built-server HTTP walkthrough — `/review` redirected to `/setup`; access, gatekeeper, sources, quota, and activation actions succeeded; authenticated `/` returned 200 afterward.
- `pnpm playwright test tests/e2e/onboarding.spec.ts` — blocked before test execution because this host kills the bundled Chromium at launch (`spawn Unknown system error -88`; direct headless launch exits 137).

## Self-review fixes

- Moved `getSetupView` out of `+page.server.ts` after the production build correctly rejected arbitrary SvelteKit route exports.
- Preserved password and API-key bytes exactly instead of trimming credentials; URL and other non-secret input remains normalized.
- Added `ORIGIN` to the built Playwright server so SvelteKit accepts same-origin form actions.
- Added an inline authentication-rejected browser case before the successful gatekeeper path.
- Applied the Impeccable onboarding/craft floor: removed redundant eyebrow labels and decorative status edges, kept native controls and visible focus, and added responsive form layout plus themed selection/caret/scrollbar surfaces.

## Concerns

- Browser execution remains an environment-only blocker: the Playwright test is present and the same built-server flow passes over HTTP, but Chromium cannot launch on this host. Run the focused Playwright command in CI or another browser-capable environment.
- Existing settings APIs persist a replacement secret and its non-secret section in separate transactions. This task validates the full section before either write, but a process crash between those two existing API calls could leave a newly encrypted secret stored while the old non-secret section remains active.

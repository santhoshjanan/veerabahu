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
- The initial separate secret/non-secret transaction concern was resolved in the review-fix commit described below.

## Review-fix round

- Added `saveSetupSection`, one narrow store operation that validates and atomically writes a setup section's non-secret patch, encrypted secret replacements, initial admin record, and audit entry. Setup actions no longer compose separate persistence calls.
- Added rollback integration coverage proving configuration, credentials, and admin creation all disappear when the transaction's audit write fails.
- Tightened the shared settings invariant: at least one reputation source must be enabled, in addition to the existing non-zero enabled-weight rule. Activation therefore rejects an empty source set.
- Added structured per-field server errors for passwords, gatekeeper connection results, URLs, enabled-source endpoints/credentials, AI model/pricing, quotas, and weights. Controls render those errors with `aria-invalid` and `aria-describedby`; gatekeeper connection outcomes now sit directly beside the connection fields.
- Expanded Review and activate into a masked operational summary covering gatekeeper, every source's state/endpoint/credential marker, minute/day/month quotas, weights, AI model/prices/daily cost ceiling, and curated-list URLs.
- Added a server-side completed-setup guard to all five setup actions. Later changes remain owned by authenticated Settings.
- Extended the onboarding browser path through the masked review and onward to authenticated `/settings` without asserting Task 8's not-yet-present page content.

## Review-fix TDD and verification

- Store tests first failed because zero sources were accepted and `saveSetupSection` did not exist; they then passed after the invariant and atomic operation were implemented.
- Route tests first failed for the old separate writes, unstructured errors, and missing completed-setup guard. A focused endpoint-field test also failed until endpoint mapping was added.
- `pnpm vitest run tests/server/settings/store.test.ts tests/server/routes/setup-actions.test.ts` — 24 tests passed.
- `pnpm vitest run` — 51 files and 215 tests passed.
- `pnpm check` — 0 errors and 0 warnings.
- `pnpm build` — production build passed.
- `git diff --check` — clean.
- The built-server onboarding walkthrough passed through rejected and connected gatekeeper attempts, zero-source rejection, valid source/quota saves, activation, and authenticated log access.
- `pnpm playwright test tests/e2e/onboarding.spec.ts` remains blocked before test execution by the host Chromium launch error (`spawn Unknown system error -88`).

## Re-review fix round

- Closed the activation race in `saveSetupSection`: its app-config upsert now conditionally claims the row inside the same transaction, requiring the expected incomplete state before any config, secret, admin, or audit write can proceed. The runtime-failure rollback explicitly expects the completed state.
- Added a real concurrent regression in which activation and a stale Gatekeeper save begin together; activation wins, the stale save rejects, and completed settings remain intact.
- Kept the successful Gatekeeper connection result visible after the action advances to Reputation sources. The committed browser flow still requires the visible `Connected` result, and a server-rendered component test now executes that assertion on this host.
- Added the configured AdGuard username to Review and activate. Only curated lists use the `Local` endpoint label; missing remote-provider endpoints read `Not configured`, while configured remote URLs remain visible.
- Added a server-rendered setup-page suite and enabled the existing Svelte Vite plugin for Vitest so these UI semantics run without a browser.

## Re-review verification

- Red: the concurrent store test observed the stale save fulfill; the server-rendered page omitted `Connected` and AdGuard username and labeled AI's missing endpoint `Local`.
- Focused: `pnpm vitest run tests/server/settings/store.test.ts tests/server/routes/setup-actions.test.ts tests/server/routes/setup-page.test.ts` — 3 files and 27 tests passed.
- Full: `pnpm vitest run` — 52 files and 218 tests passed.
- Static: `pnpm check` — 0 errors and 0 warnings.
- Build: `pnpm build` — production build passed.
- Diff: `git diff --check` — clean.
- Impeccable detector: no findings for the changed onboarding UI/E2E targets.
- Browser: the E2E still stops before execution because host Chromium cannot launch (`spawn Unknown system error -88`).

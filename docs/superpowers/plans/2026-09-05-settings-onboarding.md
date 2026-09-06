# Settings & Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Securely persist configuration, require a single local-admin password, and provide required onboarding plus authenticated Settings.

**Architecture:** A typed DB configuration store replaces runtime environment configuration after one import. Node standard-library crypto encrypts secrets and secures sessions. A runtime manager starts or restarts the existing scheduler only from an active DB configuration.

**Tech Stack:** SvelteKit 2, Svelte 5, TypeScript, Drizzle, SQLite/Postgres, Zod, Node crypto, Vitest, Playwright; no new runtime dependency.

**Spec:** docs/specs/2026-09-05-settings-onboarding-design.md

## Global Constraints

- VB_MASTER_KEY is strict Base64 for exactly 32 bytes; it is never logged, stored, or sent to the browser.
- AES-256-GCM encrypts each secret with fresh 12-byte IV, 16-byte tag, and version marker. Passwords use Node scrypt; sessions are opaque hashed server records.
- One password-only local admin. No username, remote recovery, multi-user mode, KMS, or settings framework.
- Persisted configuration wins after first import. Scheduler stays off until activation and when required configuration cannot decrypt.
- No theme control and no telemetry consent. The public blocklist stays unauthenticated; gatekeeper integration stays read-only.
- Keep SQLite/Postgres parity, 90% server/lib coverage, check, lint, build, and the existing CI matrix.

---

## File structure

| Files                                           | Responsibility                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| server/settings/crypto.ts                       | Master-key parsing, encrypted payloads, password/token helpers                |
| server/settings/types.ts, store.ts, validate.ts | Typed configuration, DB persistence/import, safe public views, Zod validation |
| server/settings/runtime.ts                      | Activation-gated scheduler start/restart                                      |
| server/auth.ts                                  | Admin password and server session lifecycle                                   |
| server/adapters/gatekeeper/adguard.ts           | Existing required read-only AdGuard adapter                                   |
| routes/setup, login, settings                   | Wizard, password lock screen, grouped operating settings                      |
| db schemas, migrations, repo                    | Portable persistence for config, secrets, admin, and sessions                 |

## Task 1: Add portable settings and authentication persistence

**Files:**

- Modify: src/lib/server/db/schema.sqlite.ts, src/lib/server/db/schema.pg.ts, src/lib/server/db/types.ts
- Create: drizzle/sqlite/0001_settings_onboarding.sql, drizzle/pg/0001_settings_onboarding.sql
- Test: tests/server/db/schema.test.ts

**Interfaces:**

- Produces appConfig, configSecrets, localAdmin, sessions, with matching app-facing SQLite/Postgres row types.

- [ ] **Step 1: Write the failing schema parity test**

```ts
it('exports portable settings and auth tables', () => {
  for (const name of ['appConfig', 'configSecrets', 'localAdmin', 'sessions']) {
    expect(sqliteSchema[name]).toBeDefined();
    expect(pgSchema[name]).toBeDefined();
  }
});
```

- [ ] **Step 2: Run it and verify failure**

Run: pnpm vitest run tests/server/db/schema.test.ts
Expected: FAIL because the tables do not exist.

- [ ] **Step 3: Implement the minimal schema**

Add singleton app_config (JSON non-secrets, onboarding state, activation, timestamps); name-keyed config_secrets (encrypted payload); singleton local_admin (salt/hash); and sessions (token hash, expiry, invalidated timestamp). Use the existing epoch-ms and boolean dialect conventions; add matching migrations.

- [ ] **Step 4: Verify and commit**

Run: pnpm vitest run tests/server/db/schema.test.ts tests/server/db/repo.test.ts
Expected: PASS.

```bash
git add src/lib/server/db drizzle tests/server/db/schema.test.ts
git commit -m "feat(settings): add portable config and auth tables"
```

## Task 2: Add crypto primitives with tests first

**Files:**

- Create: src/lib/server/settings/crypto.ts
- Test: tests/server/settings/crypto.test.ts

**Interfaces:**

- Produces parseMasterKey(value), encryptSecret(key, plaintext), decryptSecret(key, payload), hashPassword(password), verifyPassword(password, record), newToken(), hashToken(token).

- [ ] **Step 1: Write failing crypto cases**

```ts
it('round-trips then rejects a tampered secret', () => {
  const key = parseMasterKey(Buffer.alloc(32, 7).toString('base64'));
  const payload = encryptSecret(key, 'private');
  expect(decryptSecret(key, payload)).toBe('private');
  expect(() => decryptSecret(key, payload.slice(0, -1) + 'x')).toThrow();
});
it('rejects invalid master-key input', () => {
  expect(() => parseMasterKey('not-base64')).toThrow('VB_MASTER_KEY');
});
```

- [ ] **Step 2: Run it and verify failure**

Run: pnpm vitest run tests/server/settings/crypto.test.ts
Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement only Node crypto**

Use randomBytes, AES-256-GCM cipher/decipher, scrypt, timingSafeEqual, and SHA-256. Store a versioned JSON payload with IV/tag/ciphertext. Reject malformed or wrong-version data and ensure password comparisons are constant-time.

- [ ] **Step 4: Verify and commit**

Run: pnpm vitest run tests/server/settings/crypto.test.ts
Expected: PASS for wrong key, malformed payload, password verification, and token hashing.

```bash
git add src/lib/server/settings/crypto.ts tests/server/settings/crypto.test.ts
git commit -m "feat(settings): add local crypto primitives"
```

## Task 3: Persist validated settings and import environment once

**Files:**

- Create: src/lib/server/settings/types.ts, src/lib/server/settings/store.ts, src/lib/server/settings/validate.ts
- Modify: src/lib/server/config.ts, src/lib/server/db/repo.ts
- Test: tests/server/settings/store.test.ts, tests/server/config.test.ts

**Interfaces:**

- Produces StoredSettings, SafeSettings, SourceSettings, getSettings, getSafeSettings, saveSettings, replaceSecret, getSecret, importEnvironmentOnce, and toRuntimeConfig.

- [ ] **Step 1: Write failing safety/import tests**

```ts
it('returns markers but never plaintext secrets', async () => {
  await replaceSecret(t.db, t.schema, key, 'metadefenderApiKey', 'private');
  const safe = await getSafeSettings(t.db, t.schema, key);
  expect(JSON.stringify(safe)).not.toContain('private');
  expect(safe.sources.metadefender.secretConfigured).toBe(true);
});
it('imports legacy environment only once', async () => {
  await importEnvironmentOnce(t.db, t.schema, key, legacyEnv);
  await saveSettings(t.db, t.schema, key, { gatekeeper: changed });
  await importEnvironmentOnce(t.db, t.schema, key, legacyEnv);
  expect((await getSettings(t.db, t.schema, key)).gatekeeper).toEqual(changed);
});
```

- [ ] **Step 2: Run it and verify failure**

Run: pnpm vitest run tests/server/settings/store.test.ts tests/server/config.test.ts
Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement the single typed configuration shape**

Validate gatekeeper type/URL, source enablement and endpoints, minute/day/month limits, AI daily cost, weights, model/prices, and scheduler controls with Zod. Reject negative/NaN values, enabled sources without credentials, and all-zero enabled weights. Encrypt only credentials. Import legacy env into an incomplete configuration only when no row exists; never overlay env afterward. Audit setting categories only.

- [ ] **Step 4: Verify and commit**

Run: pnpm vitest run tests/server/settings/store.test.ts tests/server/config.test.ts
Expected: PASS, including tampered-secret behavior and zero plaintext leakage.

```bash
git add src/lib/server/settings src/lib/server/config.ts src/lib/server/db/repo.ts tests/server/settings tests/server/config.test.ts
git commit -m "feat(settings): persist encrypted configuration"
```

## Task 4: Make runtime, quotas, and weights configuration-driven

**Files:**

- Create: src/lib/server/settings/runtime.ts
- Modify: src/lib/server/bootstrap.ts, src/lib/server/reputation/types.ts, src/lib/server/reputation/registry.ts, src/lib/server/governor/rate-state.ts, src/lib/server/governor/drainer.ts, src/lib/server/scoring/score.ts
- Test: tests/server/settings/runtime.test.ts, tests/server/governor/rate-state.test.ts, tests/server/scoring/score.test.ts

**Interfaces:**

- Produces runtime.startIfActive(), runtime.restart(), runtime.stop().
- Extends SourceLimits with perMonth and dailyCostCeiling; changes computeScore(verdicts, weights).

- [ ] **Step 1: Write failing behavior tests**

```ts
it('uses the strictest configured quota interval', () => {
  expect(
    amortizedInterval({ perMinute: 4, perDay: 500, perMonth: 15500 })
  ).toBe(172800);
});
it('does not start an incomplete installation', async () => {
  await runtime.startIfActive();
  expect(startScheduler).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run it and verify failure**

Run: pnpm vitest run tests/server/settings/runtime.test.ts tests/server/governor/rate-state.test.ts tests/server/scoring/score.test.ts
Expected: FAIL because settings do not control runtime behavior.

- [ ] **Step 3: Implement the smallest runtime manager**

Move existing singleton scheduler ownership behind runtime. Decrypt only enabled-source secrets; create existing adapters/sources from stored settings only when onboarding is complete and active. Restart after valid settings mutation. Add monthly/cost governor checks and persisted weights at scoring time; retain imported defaults. Do not introduce a queue or reconfiguration framework.

- [ ] **Step 4: Verify and commit**

Run: pnpm vitest run tests/server/settings/runtime.test.ts tests/server/governor tests/server/scoring/score.test.ts
Expected: PASS.

```bash
git add src/lib/server/settings/runtime.ts src/lib/server/bootstrap.ts src/lib/server/reputation src/lib/server/governor src/lib/server/scoring tests/server/settings tests/server/governor tests/server/scoring
git commit -m "feat(settings): run scheduler from stored configuration"
```

## Task 5: Add AdGuard and deliberate connection testing

**Files:**

- Create: src/lib/server/adapters/gatekeeper/adguard.ts, src/lib/server/settings/connection-test.ts
- Modify: src/lib/server/adapters/gatekeeper/types.ts, src/lib/server/settings/runtime.ts
- Test: tests/server/adapters/adguard.test.ts, tests/server/settings/connection-test.test.ts

**Interfaces:**

- Produces makeAdguardAdapter and testGatekeeper returning connected, auth_rejected, unreachable, or invalid_response.

- [ ] **Step 1: Write failing adapter/test mapping cases**

```ts
it('maps AdGuard query reasons to allowed and blocked', async () => {
  const page = await adapter.listResolvedDomains({
    since: 0,
    until: 9,
    limit: 10
  });
  expect(page.entries.map((x) => x.disposition)).toEqual([
    'allowed',
    'blocked'
  ]);
});
it('maps a 401 to auth_rejected without returning credentials', async () => {
  await expect(testGatekeeper(settings, secret)).resolves.toMatchObject({
    kind: 'auth_rejected'
  });
});
```

- [ ] **Step 2: Run it and verify failure**

Run: pnpm vitest run tests/server/adapters/adguard.test.ts tests/server/settings/connection-test.test.ts
Expected: FAIL.

- [ ] **Step 3: Implement only documented read paths**

Implement AdGuard query-log pagination, timestamp cursor, and disposition normalization under the current GatekeeperAdapter contract. Reuse Pi-hole. Explicit test calls use short timeout and classify only response/error; never save/log credentials or start the scheduler.

- [ ] **Step 4: Verify and commit**

Run: pnpm vitest run tests/server/adapters tests/server/settings/connection-test.test.ts
Expected: PASS.

```bash
git add src/lib/server/adapters/gatekeeper src/lib/server/settings/connection-test.ts tests/server/adapters tests/server/settings/connection-test.test.ts
git commit -m "feat(settings): test gatekeeper connections"
```

## Task 6: Add password-only authentication and route gates

**Files:**

- Create: src/lib/server/auth.ts, src/routes/login/+page.server.ts, src/routes/login/+page.svelte
- Modify: src/hooks.server.ts, src/app.d.ts, src/routes/+layout.server.ts
- Test: tests/server/auth.test.ts, tests/server/routes/auth-guard.test.ts

**Interfaces:**

- Produces createSession, getSession, destroySession, requireAdmin, requireConfiguredAdmin; adds event.locals.adminSession.

- [ ] **Step 1: Write failing route/session tests**

```ts
it('redirects incomplete instances to setup and anonymous configured instances to login', async () => {
  expect(await resolveFor('/review', incomplete)).toMatchObject({
    status: 303,
    location: '/setup'
  });
  expect(await resolveFor('/review', anonymous)).toMatchObject({
    status: 303,
    location: '/login'
  });
});
it('invalidates sessions after password change', async () => {
  await changePassword(db, schema, key, oldPassword, newPassword);
  expect(await getSession(db, schema, token)).toBeNull();
});
```

- [ ] **Step 2: Run it and verify failure**

Run: pnpm vitest run tests/server/auth.test.ts tests/server/routes/auth-guard.test.ts
Expected: FAIL.

- [ ] **Step 3: Implement server-only access control**

Set a 12-hour opaque cookie with HttpOnly, SameSite=Strict, path-wide scope, and Secure for HTTPS URLs. Hash only the token in DB. Hook initialization imports settings, attaches valid sessions, calls runtime.startIfActive once, and exempts setup/login/assets/blocklist only. Keep blocklist public.

- [ ] **Step 4: Verify and commit**

Run: pnpm vitest run tests/server/auth.test.ts tests/server/routes/auth-guard.test.ts tests/server/routes/blocklist-route.test.ts
Expected: PASS.

```bash
git add src/lib/server/auth.ts src/hooks.server.ts src/app.d.ts src/routes/login src/routes/+layout.server.ts tests/server/auth.test.ts tests/server/routes/auth-guard.test.ts
git commit -m "feat(auth): protect the local application"
```

## Task 7: Implement server actions and UI for required onboarding

**Files:**

- Create: src/routes/setup/+page.server.ts, src/routes/setup/+page.svelte, src/lib/components/SecretField.svelte, src/lib/components/SettingsSection.svelte
- Modify: src/lib/design/tokens.css
- Test: tests/server/routes/setup-actions.test.ts, tests/e2e/onboarding.spec.ts

**Interfaces:**

- Produces actions access, gatekeeper, sources, quotas, activate and getSetupView returning first incomplete step plus SafeSettings.

- [ ] **Step 1: Write failing server and browser cases**

```ts
it('does not activate without a successful gatekeeper test', async () => {
  expect(await actions.activate(incompleteEvent)).toMatchObject({
    status: 400
  });
  expect(runtime.restart).not.toHaveBeenCalled();
});
test('setup blocks the log until activation', async ({ page }) => {
  await page.goto('/review');
  await expect(page).toHaveURL(/\/setup/);
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Continue' }).click();
});
```

- [ ] **Step 2: Run them and verify failure**

Run: pnpm vitest run tests/server/routes/setup-actions.test.ts && pnpm playwright test tests/e2e/onboarding.spec.ts
Expected: FAIL.

- [ ] **Step 3: Implement five resumable native-form steps**

Implement Secure access, Gatekeeper, Reputation sources, Quota and scoring, and Review and activate. Save only valid sections; preserve non-secret input on failure; replace secrets only when non-empty; render precise inline test status. Activation requires a tested gatekeeper and valid enabled sources/weights/quotas, then starts runtime and redirects to Log. Include blocklist pull and roughly hourly refresh guidance, never theme/consent prompts.

- [ ] **Step 4: Verify and commit**

Run: pnpm check && pnpm vitest run tests/server/routes/setup-actions.test.ts && pnpm playwright test tests/e2e/onboarding.spec.ts
Expected: PASS.

```bash
git add src/routes/setup src/lib/components src/lib/design/tokens.css tests/server/routes/setup-actions.test.ts tests/e2e/onboarding.spec.ts
git commit -m "feat(onboarding): add required configuration wizard"
```

## Task 8: Implement authenticated grouped Settings

**Files:**

- Create: src/routes/settings/+page.server.ts, src/routes/settings/+page.svelte
- Modify: src/routes/+layout.svelte, src/routes/login/+page.svelte
- Test: tests/server/routes/settings-actions.test.ts, tests/e2e/settings.spec.ts

**Interfaces:**

- Produces actions password, gatekeeper, sources, quotas, weights, system, signout; consumes shared validation/store/runtime APIs.

- [ ] **Step 1: Write failing Settings cases**

```ts
it('keeps an empty secret replacement unchanged', async () => {
  await actions.sources(eventWithEmptySecret);
  expect(await getSecret(db, schema, key, 'metadefenderApiKey')).toBe(
    'existing'
  );
});
test('Settings masks configured credentials', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByText('Configured')).toBeVisible();
});
```

- [ ] **Step 2: Run them and verify failure**

Run: pnpm vitest run tests/server/routes/settings-actions.test.ts && pnpm playwright test tests/e2e/settings.spec.ts
Expected: FAIL.

- [ ] **Step 3: Implement compact, scoped Settings**

Render Access, Gatekeeper, Sources, Quota & cost, Scoring, System in a left index that moves above content below 720px. Save each form independently and warn before discarding dirty fields. Password change requires current password and invalidates sessions; sign-out invalidates current session. Add Settings link only for authenticated configured sessions.

- [ ] **Step 4: Run UI detector, verify, and commit**

Run: pnpm check && pnpm vitest run tests/server/routes/settings-actions.test.ts && pnpm playwright test tests/e2e/settings.spec.ts
Expected: PASS.

Run: .agents/skills/impeccable/scripts/impeccable detect --json src/routes/setup src/routes/login src/routes/settings src/lib/components/SettingsSection.svelte src/lib/components/SecretField.svelte
Expected: no unresolved finding after one bounded fix pass.

```bash
git add src/routes/settings src/routes/+layout.svelte src/routes/login tests/server/routes/settings-actions.test.ts tests/e2e/settings.spec.ts
git commit -m "feat(settings): add authenticated configuration surface"
```

## Task 9: Document deployment and run the final suite

**Files:**

- Create: README.md
- Modify: .env.example, docker-compose.yml
- Modify: tests/server/docker.test.ts, tests/server/smoke.test.ts

- [ ] **Step 1: Write failing deployment expectation**

```ts
it('documents only the master-key configuration bootstrap', async () => {
  const readme = await readFile('README.md', 'utf8');
  expect(readme).toContain('VB_MASTER_KEY');
  expect(readme).toContain('openssl rand -base64 32');
});
```

- [ ] **Step 2: Run it and verify failure**

Run: pnpm vitest run tests/server/docker.test.ts tests/server/smoke.test.ts
Expected: FAIL until docs/examples match.

- [ ] **Step 3: Update only necessary operator guidance**

Document master-key generation, first-run onboarding, reset-and-onboard local recovery, and read-only gatekeeper/adlist refresh. Remove obsolete credential environment examples; retain DB/process bootstrap. Never inspect or print real local secrets.

- [ ] **Step 4: Run complete verification**

Run:

```bash
pnpm check
pnpm lint
pnpm test:cov
pnpm build
pnpm test:pg
pnpm playwright test
```

Expected: PASS where local services/browser exist. Record exact local environment blockers and leave their matrix to CI; never claim an unavailable check passed.

- [ ] **Step 5: Commit**

```bash
git add README.md .env.example docker-compose.yml tests/server/docker.test.ts tests/server/smoke.test.ts
git commit -m "docs: document encrypted settings onboarding"
```

## Plan self-review

- Tasks 1-3 cover portable storage, encryption, import/demotion, validation, and safe secret handling.
- Tasks 4-5 cover activation-gated runtime, quotas/cost/weights, and both supported gatekeeper read adapters.
- Tasks 6-8 cover local admin, route protection, wizard, Settings, accessibility, responsiveness, and end-to-end flows.
- Task 9 covers operator guidance and full verification. No task adds telemetry, themes, remote recovery, multi-user access, external secret stores, or gatekeeper writes.

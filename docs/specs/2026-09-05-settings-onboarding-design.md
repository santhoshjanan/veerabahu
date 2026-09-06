# Sub-project #4 — Settings & Onboarding — Design Spec

_Status: approved design · Date: 2026-09-05 · Traces to: [master-requirements.md](../master-requirements.md) §7 row #4, §9, §10, vision goals 5 / 6 / 10_

---

## 1. Purpose

Sub-project #4 turns Veerabahu's deployment-time environment configuration into a local, protected operating surface. A home operator can complete the required first-run setup, securely change the same configuration later, and run the enrichment scheduler only after the gatekeeper connection and essential settings are valid.

The surface extends the existing **Disposition Log** visual system in \`DESIGN.md\`. It is an operating interface: compact, calm, evidence-first, and built around standard form controls rather than marketing-style setup screens. UX and interaction decisions in this spec are owned by Impeccable.

## 2. Goals and non-goals

**Goals**

- Move runtime configuration and credentials from environment variables into the database. Secrets are encrypted at rest; non-secret configuration is readable.
- Require one local, password-only administrator. There is no username or remote identity provider.
- Require a completed wizard before application operation and scheduler start.
- Configure and test the gatekeeper, per-source credentials/endpoints, quota limits, scoring weights, and AI provider/cost inputs.
- Let an authenticated operator safely revisit all configuration in \`/settings\`.
- Preserve the project requirements: server and \`lib\` TypeScript coverage remains above 90%, and the suite continues to run against SQLite and Postgres.

**Non-goals**

- Multi-user, multi-site, email, password reset email, or remote recovery.
- Telemetry consent or data collection (sub-project #5).
- Theme controls. Veerabahu has one visual system for now.
- Gatekeeper write access. Veerabahu continues to publish a pullable blocklist only.
- A new secret-management service, external KMS, or a configuration-framework dependency.

## 3. Security model

### 3.1 Bootstrap root

\`VB_MASTER_KEY\` is the sole required bootstrap environment value. It supplies exactly 32 random bytes, Base64-encoded, and is provided by the deployment secret mechanism. The application validates it at startup and fails closed with a clear operator-facing startup error when it is missing or invalid. It is never written to the database, returned by an endpoint, logged, or displayed in the UI.

Environment variables no longer carry normal runtime configuration. They may only supply this bootstrap root and conventional process/database bootstrap values. Existing runtime environment values are imported once during upgrade only when the corresponding database configuration has not yet been set; database configuration then wins. This prevents an old compose file from unexpectedly overriding a later Settings change.

### 3.2 Stored secrets

Each secret is stored as an independently encrypted payload using Node's built-in AES-256-GCM: a fresh 12-byte IV and 16-byte authentication tag accompany the ciphertext. The payload includes a version marker, so a future format change is explicit. Decryption or authentication failure is fatal for that setting: the dependent source stays disabled, the scheduler does not use it, and the UI explains that the value must be re-entered. No secret value appears in logs, audit payloads, loader data, form re-renders, or test fixtures.

The first implementation uses the master key directly; it does not introduce a key ring, key rotation workflow, or KMS. Those are deferred until an actual rotation requirement exists.

### 3.3 Local administration and sessions

The first wizard step creates the only local administrator with a password and password confirmation. Passwords are salted and derived with Node's built-in \`scrypt\`; only the salt and derived hash are stored. Password inputs are never prefilled or echoed.

Successful authentication creates an opaque, random, server-side session. The browser holds only its \`HttpOnly\`, \`SameSite=Strict\` cookie; the database stores a hash of the session token and its expiry. Cookies use \`Secure\` whenever the deployment is served over HTTPS. Sessions expire after 12 hours and are invalidated on password change. Sign-out invalidates the current session.

Every route, loader, action, and mutable endpoint except login and the required setup flow requires that session. The published \`/blocklist.txt\` endpoint remains deliberately unauthenticated. Requests to ordinary routes on an unconfigured instance are redirected to onboarding; requests on a configured instance without a session are redirected to the password-only login screen.

There is no forgotten-password flow. The recovery procedure is deliberately local: the operator resets the application's configuration/database under deployment control, provides the master key, and completes onboarding again. This is documented in the operator docs rather than exposed as an unsafe UI escape hatch.

## 4. Configuration model and migration

The implementation introduces a small portable configuration schema rather than a generic settings framework:

| Record             | Purpose                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| \`app_config\`     | Versioned non-secret values: onboarding status, gatekeeper type/URL, enabled sources, quotas, weights, AI base URL/model/prices, and scheduler activation. |
| \`config_secrets\` | One encrypted payload per named credential (gatekeeper, MetaDefender, AI, VirusTotal).                                                                     |
| \`local_admin\`    | The single password hash and salt.                                                                                                                         |
| \`sessions\`       | Hashed opaque session token, expiry, creation, and invalidation time.                                                                                      |

Rows use the project's existing SQLite/Postgres-portable conventions. Configuration changes append an existing \`audit_log\` entry identifying the changed setting category and actor \`local_admin\`; audit payloads never include values that are secret.

At migration, the app creates the tables and imports existing environment configuration only if no setup record exists. The import marks onboarding incomplete so the operator reviews the imported values, sets the password, tests the gatekeeper, and activates the scheduler deliberately. New installations start with no configuration and scheduler off.

## 5. Onboarding experience

Onboarding is a full-page, resumable operating flow. It stores a completed valid step; after a restart it resumes at the first incomplete step. The scheduler stays off until the final activation action.

| Step                   | Operator task                                                                                                  | Completion rule                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1. Secure access       | Create and confirm the local admin password.                                                                   | Valid matching password is hashed and stored.                                           |
| 2. Gatekeeper          | Choose Pi-hole or AdGuard Home, enter its read-only URL and credentials, then run a connection test.           | A deliberate test succeeds.                                                             |
| 3. Reputation sources  | Configure enabled sources; enter endpoint/authentication where required. Optional sources can be skipped.      | Each enabled source has valid required fields; skipped sources are explicitly disabled. |
| 4. Quota and scoring   | Set per-source minute/day/month ceilings, AI daily-cost ceiling, source weights, and AI provider/model/prices. | Values validate and enabled source weights form a usable scoring configuration.         |
| 5. Review and activate | Review a compact, masked configuration summary and the gatekeeper's required adlist refresh guidance.          | Operator selects **Activate**; configuration is marked complete and scheduler starts.   |

The review step tells the operator that Veerabahu publishes a blocklist URL for the gatekeeper to pull, and recommends a roughly hourly refresh. It never asks for theme or telemetry consent.

Each step has back navigation, section-level save feedback, and inline validation. Connection tests are explicit actions, not background requests. A test reports one specific outcome beside the relevant fields: connected, authentication rejected, unreachable, or invalid response. Secret fields display only **Configured** after save; entering a new value replaces the stored secret.

## 6. Settings experience

\`/settings\` is an authenticated operating surface, not a new visual world. A compact section index is at the left on wide screens and above the content on narrow screens:

1. **Access** — change the admin password (requires current password).
2. **Gatekeeper** — connection details and a deliberate test.
3. **Sources** — per-source enablement, endpoint/authentication, and test where supported.
4. **Quota & cost** — quota governor limits, AI daily spend ceiling, and price inputs.
5. **Scoring** — source weights.
6. **System** — scheduler state and the published blocklist URL / refresh guidance.

Settings uses familiar, native form vocabulary, concise labels, and existing token-layer rhythm. It does not use a modal as a substitute for form structure. Each section saves independently; leaving changed fields warns before discarding them. Disabled, configured-but-unavailable, and active are visibly distinct source states. A failed source does not block unrelated settings, but its scheduler worker remains disabled until repaired.

The wizard and Settings share validation and field components so the same setting means the same thing in either place. Normal operational screens remain observation-first and do not grow inline configuration controls.

## 7. Error handling, accessibility, and responsive behavior

- Validation is server-authoritative and returns field-level errors without clearing non-secret input. Sensitive values are never returned after submission.
- Invalid master-key material, unreadable encrypted configuration, missing required configuration, or a failed activation prevents scheduler start. The process does not silently fall back to environment configuration after onboarding exists.
- Existing encrypted values are masked in summaries and audit records. Replacing a secret is explicit; an empty replacement field means "keep current value."
- All flows are keyboard operable with semantic labels, visible focus, WCAG AA contrast, and text/icon state companions. Motion is brief, informational, and respects \`prefers-reduced-motion\`.
- Form layouts collapse to one column on narrow screens; the section index moves above the working pane without hiding controls or test outcomes.

## 8. Verification

Unit and integration coverage covers:

- strict master-key parsing plus AES-GCM encryption/decryption and tamper rejection;
- no plaintext secret returned from configuration reads, errors, audit entries, or logs;
- salted password derivation, password verification, session creation/expiry/invalidation, and protection of every mutable endpoint;
- first-run redirects, wizard resume, validation, source skip/enable rules, and the activation gate that starts the scheduler only when onboarding is complete;
- environment import on upgrade, database precedence afterward, and parity on SQLite and Postgres;
- gatekeeper and source test-result mapping, scoped saves, secret replacement/masking, and password change behavior.

Playwright verifies the primary path: first run → password creation → successful gatekeeper test → configuration review → activation → authenticated Settings visit. It also covers a protected-route redirect and one representative inline failure. The existing quality gates (\`pnpm check\`, lint, Vitest coverage, build, and CI database matrix) remain required.

## 9. Explicit boundaries

This sub-project deliberately does not implement sub-project #3 AI observability, theme selection, telemetry consent, multi-user management, remote password recovery, external secret storage, or gatekeeper write access. It is one local administrator, one deployed gatekeeper, and one encrypted database configuration store.

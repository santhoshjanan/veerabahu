# Task 3 Report: Validated settings persistence

## Delivered

- Added one typed `StoredSettings` shape covering gatekeeper selection, source enablement/endpoints, quota and AI cost ceilings, scoring weights, AI model/prices, scheduler controls, onboarding state, and activation state.
- Added strict Zod validation for HTTP(S) URLs, non-negative finite limits/prices/weights, scheduler ranges, required enabled-source credentials, required enabled AI model/endpoint, usable enabled weights, and activation state.
- Added portable singleton configuration and named-secret repository operations using the existing SQLite/Postgres schemas.
- Added settings reads, partial category saves, AES-GCM credential replacement/decryption, secret-free safe views, and category-only audit records.
- Added one-time legacy environment import. It validates the complete import before writing, creates an incomplete/inactive onboarding record, encrypts credentials independently, and returns without reading or applying environment values whenever an app configuration row already exists.
- Added `toRuntimeConfig` to adapt validated DB settings and decrypted credentials to the existing runtime `Config` without exposing credentials through settings reads.

## TDD evidence

- Initial focused run failed because `$lib/server/settings/store` did not exist and `toRuntimeConfig` was not exported.
- The focused tests exercise plaintext exclusion from safe views/database config/audits, configured markers, ciphertext tampering, one-time import precedence, invalid quotas, missing credentials, all-zero enabled weights, category-only auditing, and runtime conversion.

## Verification

- `pnpm vitest run tests/server/settings/store.test.ts tests/server/config.test.ts` — 13 tests passed.
- `pnpm vitest run` — 44 files and 157 tests passed.
- `pnpm check` — 0 errors and 0 warnings.
- Task files were formatted with Prettier; `git diff --check` passed.

## Deliberate boundaries

- No generic settings framework, secret provider, cache, or new dependency was added.
- Quotas and weights are separate top-level categories so later onboarding/Settings actions can save and audit those sections without conflating them with source connection settings.
- Task 3 persists and converts configuration. Task 4 remains responsible for wiring stored quotas/weights into the governor/scorer and for scheduler lifecycle management; Task 5 adds the AdGuard runtime adapter.

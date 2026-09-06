# Task 2 Report: Crypto primitives

## Delivered

- Added strict `VB_MASTER_KEY` Base64 parsing requiring exactly 32 bytes.
- Added AES-256-GCM secret encryption/decryption with fresh 12-byte IVs, 16-byte authentication tags, and versioned JSON payloads.
- Added malformed-payload, wrong-key, wrong-version, and authentication-failure rejection.
- Added salted scrypt password hashing and constant-time password verification.
- Added random opaque session-token generation and SHA-256 token hashing.
- Added focused Vitest coverage for round trips, tampering, invalid keys, malformed payloads, password verification, and token behavior.

## Verification

- `pnpm vitest run tests/server/settings/crypto.test.ts` — 5 tests passed.
- `pnpm check` — svelte-check found 0 errors and 0 warnings.
- Prettier check passed after formatting the two task files.
- `git diff --check` passed.

## Deliberate boundaries

- Uses Node's built-in `node:crypto` only; no dependency or key-management abstraction was added.
- Password records use `{ salt, hash }`, with Base64 values; callers can map `hash` to the database's `password_hash` column.
- Secret payloads use `{ v, iv, tag, ciphertext }`; payload fields are Base64 encoded.

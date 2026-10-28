# Signals Phase A — Server Integration Test Plan

## Purpose

Exercise the server-managed Signals invitation lifecycle against an isolated Firebase Auth + Firestore emulator setup. The existing API tests only cover request guards; Firestore rules tests only cover client SDK denial. Neither proves transaction behavior.

## Test prerequisites

- Run only against emulator project `demo-queerspace-test`; never point this suite at production.
- Start both Auth and Firestore emulators from the repository root.
- Configure the API test process with `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` and `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`.
- Use emulator-created users and emulator-issued ID tokens. Do not use production user tokens or service-account credentials.
- Keep each test isolated by clearing Firestore and creating fresh test users.

## Required lifecycle cases

| ID | Scenario | Expected result |
| --- | --- | --- |
| SIG-API-01 | Sender creates an invitation with a valid recipient and idempotency key | HTTP 201; one pending invitation, one idempotency record, cooldown record |
| SIG-API-02 | Sender retries the same create payload with the same key | HTTP 200, `replayed: true`; same invitation ID; no second invitation |
| SIG-API-03 | Sender reuses the key for a different recipient | HTTP 409; no additional invitation |
| SIG-API-04 | Sender creates a second invitation within 30 seconds using a new key | HTTP 429; no invitation or idempotency record for the rejected request |
| SIG-API-05 | Sender attempts to invite themself or uses malformed IDs/keys/messages | HTTP 400; no writes |
| SIG-API-06 | Either party has blocked the other before creation | HTTP 403; no invitation |
| SIG-API-07 | Either party is suspended before creation | HTTP 403; no invitation |
| SIG-API-08 | Non-recipient tries to accept or decline an invitation | HTTP 403; invitation remains pending |
| SIG-API-09 | Non-sender tries to revoke an invitation | HTTP 403; invitation remains pending |
| SIG-API-10 | Recipient accepts a valid pending invitation | HTTP 200 accepted; invitation becomes accepted; exactly one active pair is created with sorted participant IDs |
| SIG-API-11 | Recipient accepts after a block or suspension is added | No active pair is created; invitation is not left pending |
| SIG-API-12 | Recipient accepts an expired invitation | Response reports expired; invitation is persisted as expired; no pair is created |
| SIG-API-13 | Sender declines/revokes after invitation is no longer pending | HTTP 409; terminal state is unchanged |
| SIG-API-14 | Two concurrent requests use the same idempotency key | Exactly one invitation is created; successful retries resolve to its ID |
| SIG-API-15 | Two concurrent accept requests target one invitation | At most one active pair is created; no duplicate pair or inconsistent invitation state |
| SIG-API-16 | Authenticated user reads invitations | Only sent/received records are returned |
| SIG-API-17 | Missing, malformed, expired, or revoked ID token | HTTP 401; no writes |

## Assertions beyond status codes

For each rejected operation, assert that no unintended documents were written and no existing status was changed. For acceptance, assert both invitation and pair records after the transaction. For idempotency and concurrency tests, assert document counts and stable IDs, not only response bodies.

## Current implementation caveats to verify

- The API currently surfaces expired pending invitations as `expired` in GET responses but does not persist that status during GET. Expiry is persisted when an action is attempted. Decide whether read-time persistence is needed before launch.
- There is no endpoint yet to list active pairs or end a pair. These are separate feature requirements, not covered by the invitation lifecycle.
- The existing `npm test` script does not include `test/firestore-rules.test.ts`; run that suite separately through the Firestore emulator command documented in `signals-phase-a-api-contract.md`.

## Exit criteria

Do not enable Signals in production until the lifecycle suite passes against emulators, the existing unit and rules suites pass, and the block/suspension, expiry, idempotency, and concurrent-accept cases are verified.

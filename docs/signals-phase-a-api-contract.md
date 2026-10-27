# Signals API Foundation — Deployment and Contract

This branch contains the first server-managed invitation API foundation. It is not yet a launch-ready Signals release.

## Vercel configuration

Add `FIREBASE_SERVICE_ACCOUNT_JSON` as a **server-only** Vercel environment variable for the intended project and deployment environments. Its value must be the full JSON for a service account with the minimum Firestore and Firebase Authentication permissions needed by this API. Never prefix it with `VITE_`, commit the credential, or send it to the browser.

The service account's `project_id` determines the Firebase project used by the API. Confirm it matches `VITE_FIREBASE_PROJECT_ID` before testing. Rotate the credential if it is ever exposed.

## Endpoint

All requests go to `/api/signals` and must include:

`Authorization: Bearer <Firebase ID token>`

The token is verified server-side, including revocation checks. User identity is derived from the verified token.

- `GET /api/signals`: returns up to 50 sent and 50 received invitations for the authenticated user.
- `GET /api/signals?view=pairs`: returns active and ended pair records in which the authenticated user is a participant. The server filters membership before returning pair summaries.
- `POST /api/signals` with `{ "action": "create", "recipientId": "...", "idempotencyKey": "...", "message": "..." }`: creates a pending invitation with a seven-day expiry. Message is optional and capped at 240 characters. Reuse the same idempotency key only for retries of the same create operation.
- `POST /api/signals` with `{ "action": "accept", "invitationId": "..." }`: recipient-only acceptance; creates a server-managed pair.
- `POST /api/signals` with `{ "action": "decline", "invitationId": "..." }`: recipient-only decline.
- `POST /api/signals` with `{ "action": "revoke", "invitationId": "..." }`: sender-only revocation.
- `POST /api/signals` with `{ "action": "end", "pairId": "..." }`: either participant can end an active pair. Repeating the request for an already-ended pair returns `{ "status": "ended", "alreadyEnded": true }`.

## Important limits before launch

- The API has not yet been built or exercised in a local environment; no test or deployment result is claimed.
- Pair chat, pair ending/block handling after acceptance, stronger adaptive abuse controls, and production observability still need implementation. A basic 30-second invitation-creation cooldown exists, but it is not comprehensive rate limiting.
- Expiry is surfaced on inbox reads and enforced during acceptance; no scheduled cleanup job is included.
- The existing client chat flow is separate and must not be treated as Signals consent.
- The Firestore rules deny browser SDK reads/writes to Signals collections. The UI must call this API rather than query these collections directly.
- Add emulator and API tests for every authorization and state-transition invariant before enabling the feature in production.

## Abuse-control update

- Invitation creation has a server-side per-sender cooldown of one new invitation per 30 seconds, stored in `signalsRateLimits/{uid}` and inaccessible to client SDKs.
- Replaying the same idempotency key returns the original invitation without consuming another cooldown slot.
- Firebase Authentication token errors return HTTP 401 rather than a generic 500.
- This cooldown is a basic friction control, not comprehensive abuse prevention; production still needs monitoring and stronger adaptive limits if abuse appears.

## Security test coverage added

- `api/signals.test.js` covers unsupported methods and missing/malformed bearer headers. These are lightweight Node tests and do not require Firebase credentials.
- `test/firestore-rules.test.ts` now includes SIG-01 through SIG-03 to verify that client SDK users cannot read or write invitation, pair, idempotency, or rate-limit documents.
- The Firestore rules tests require the Firestore emulator configured in `firebase.json`. Run them from the repository root with:

```sh
firebase emulators:exec --only firestore "npx tsx --test test/firestore-rules.test.ts"
```

- The API tests are included by the existing `npm test` script through `api/*.test.js`; they have not yet been executed in this change session.
- These tests verify the client-deny boundary, not server-side transaction behavior. Acceptance, expiry, block/suspension rechecks, idempotency races, and cooldown concurrency still need integration tests against an isolated Firebase project/emulator setup.
- The planned server-side lifecycle scenarios are documented in [Signals Phase A — Server Integration Test Plan](./signals-phase-a-integration-test-plan.md). This is a test plan, not evidence that the cases have run or passed.

## Transactional create checks and idempotent retries

Invitation creation now reads the sender/recipient private settings and suspension records inside the same Firestore transaction that creates the invitation and updates the cooldown/idempotency records. This closes the gap where a block or suspension could change after a pre-transaction check but before the invitation write. The transaction checks both directions of `blockedPartnerIds`.

A newly created invitation returns HTTP 201. A matching idempotent retry returns HTTP 200 with `replayed: true`; a reused key with a different action/recipient remains a conflict. This behavior has been inspected in source but has not yet been verified by executing tests against Firestore.

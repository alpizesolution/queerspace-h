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
- `POST /api/signals` with `{ "action": "create", "recipientId": "...", "idempotencyKey": "...", "message": "..." }`: creates a pending invitation with a seven-day expiry. Message is optional and capped at 240 characters. Reuse the same idempotency key only for retries of the same create operation.
- `POST /api/signals` with `{ "action": "accept", "invitationId": "..." }`: recipient-only acceptance; creates a server-managed pair.
- `POST /api/signals` with `{ "action": "decline", "invitationId": "..." }`: recipient-only decline.
- `POST /api/signals` with `{ "action": "revoke", "invitationId": "..." }`: sender-only revocation.

## Important limits before launch

- The API has not yet been built or exercised in a local environment; no test or deployment result is claimed.
- Pair chat, pair ending/block handling after acceptance, rate limits, and production observability still need implementation.
- Expiry is surfaced on inbox reads and enforced during acceptance; no scheduled cleanup job is included.
- The existing client chat flow is separate and must not be treated as Signals consent.
- The Firestore rules deny browser SDK reads/writes to Signals collections. The UI must call this API rather than query these collections directly.
- Add emulator and API tests for every authorization and state-transition invariant before enabling the feature in production.

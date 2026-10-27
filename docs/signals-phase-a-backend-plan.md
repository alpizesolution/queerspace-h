# Signals Phase A Backend Plan

## Current repository constraints

- The app is a Vite/React client deployed to Vercel.
- The only current `api/` handler found is `api/firebase-auth.js`, an Edge Runtime proxy for Firebase Auth helper pages.
- No Firebase Admin SDK dependency or trusted Signals API handler was found on this branch.
- The current browser chat service creates conversations directly through the Firebase client SDK. Its generic Firestore rules are not a sufficient consent boundary for Signals.

## Required implementation order

1. Add a Node.js Vercel Function for Signals; do not use the existing Edge Runtime auth proxy for database mutations.
2. Verify Firebase ID tokens server-side and derive the caller UID only from the verified token, never from request JSON.
3. Use Firebase Admin SDK credentials from server-only Vercel environment variables. Never expose service-account credentials or privileged tokens to `VITE_*` variables.
4. Implement invitation creation with an immutable sender/recipient pair, server-generated creation/expiry timestamps, bounded message length, and a deterministic idempotency key.
5. Implement acceptance as a Firestore transaction: require the authenticated caller to be the recipient, require invitation state `pending`, reject expired invitations, check both users' block state, and atomically transition to accepted plus create a pair record. Retries must return the existing result or a conflict without creating another pair.
6. Implement decline, expiry, revoke, and block handling as one-way transitions. Ended/blocked pairs must never reactivate; a new invitation is a new consent event.
7. Keep pair/conversation participant IDs immutable. Never grant access to generic `/conversations/{id}` solely because an invitation exists.
8. Add Firestore rules for dedicated Signals records with deny-by-default access for client writes to server-owned state. The server's Admin SDK bypasses rules, so API validation and tests are mandatory.
9. Add emulator/API tests before connecting Signals UI: sender cannot accept their own invite; non-recipient cannot accept; expired invite cannot be accepted; duplicate/replayed requests cannot create extra pairs; blocked users cannot invite or accept; third parties cannot read records; ended pairs cannot reopen; unauthenticated calls fail.
10. Run the existing tests, lint, and production build; report actual outcomes. Do not enable Signals in the UI until these pass.

## Suggested record boundaries

- `signalsInvitations/{invitationId}`: immutable `senderId`, `recipientId`, server timestamps, state, and idempotency metadata.
- `signalsPairs/{pairId}`: immutable two-member list, source invitation ID, server creation time, and one-way state.
- Optional private inbox indexes may reference invitation IDs but must not contain privileged state that clients can forge.

## Launch gate

Do not ship an operational Signals inbox until the trusted API, Firestore rules, and emulator tests enforce the invariants above. A client-only Firestore transaction cannot safely substitute for trusted authorization when block state, replay protection, and one-way consent transitions must be enforced consistently.

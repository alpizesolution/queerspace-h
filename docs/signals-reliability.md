# Signals reliability: history, inbox, listeners, accounts

What was wrong, what changed, and what has to be done by hand.

## Confirmed causes (from the code, then verified by tests on the emulator)

1. **Only the oldest 100 messages loaded.** `view=messages` read `orderBy createdAt asc limit 100` and the app had no way to load more, so in a conversation of more than 100 messages the newest ones were never shown after opening it. They were hidden, not deleted.
2. **Identity was anonymous only.** Conversations belong to the Firebase uid, and an anonymous uid lives only in the browser session. Clearing site data, a new browser or phone, or a reset PWA gives a new uid and an empty inbox. An anonymous account cannot be recovered once its session is gone. There was no way to link a permanent sign-in.
3. **A stale inbox answer could win.** A refresh after a change could join an older request that was already in flight, and the answer was remembered against the revision at the time it came back, so the old list could be trusted for 5 minutes.
4. **A refused conversation looked empty.** A block (either way) or suspension gave 403 `not_allowed`, shown as a vague error over an empty thread.
5. **The inbox list had an unordered fallback.** If the `signalsPairs` index was missing, the server fell back to an unordered read capped at 100 and returned it as if complete.
6. **The live inbox listener never reconnected** after an error.
7. **A direct invitation accepted for two members who already had a conversation made a second one.**

## What changed

| Area | Change |
| --- | --- |
| Messages | `view=messages` returns the newest page (`limit`, default 50 from the app, max 100) and `olderCursor`. `before=<cursor>` returns the next older page. A client that sends no `limit` gets the newest 100, never the oldest 100. The cursor is the position of the oldest message shown (`seconds.nanos.id`) and is checked before use (bad cursor: 400). |
| Conversation screen | Opens at the newest page. "Load earlier messages" button and scrolling to the top load older pages. The reader keeps their place; older messages are never announced as new. Merged by id and ordered by time, so a poll and a page can overlap safely. Unread and "mark read" depend only on the newest message. |
| Unavailable | A block (either direction) or a suspension answers 403 `conversation_unavailable` to both members, so it never says who did it. The app shows "This conversation isn't available right now. Nothing has been deleted.", hides the composer, and offers Try again. A network failure keeps the normal retry banner. Nothing is deleted. |
| Inbox cache | A refresh after a known change (`fresh`) never joins an older request. Each refresh has a generation number, and only the newest may change the screen. The cache is stamped with the revision at the time the request was **asked**. Cursor bookkeeping no longer depends on a state-updater side effect. |
| Listener | `useSignalsInbox` re-establishes the listener after a temporary failure with 1s, 2s, 4s, 8s, 16s pauses (5 tries), retries a permission refusal once, then reports it. Retry button, and coming back online starts again. One listener at a time; unmount cancels timers. |
| Inbox query | Missing index now returns 503 `inbox_index_missing` with a clear message, and logs the fix. The unordered fallback is gone. The un-paged list is the newest 100, ordered. Members with more than 100 conversations use the cursor pages (tested with 110). |
| Invitations | Accepting a direct invitation reuses an existing active conversation between the two members (as Looking For requests already did). A repeated accept is refused (409), changing nothing. |
| Accounts | **Not offered in the app.** Members stay anonymous. The linking service and sheet (`accountLinking.ts`, `AccountRecoverySheet.tsx`) exist and are tested but nothing in the app opens them, so no email or Google linking is exposed to members. The app still asks the browser for durable storage (best effort). |

Not changed: Firestore security rules (no republish needed), the message, photo, GIF, card and game paths, and the Cloudflare R2 media code.

## Data consistency (message and inbox metadata)

A send writes the message and **both** members' inbox entries (`last`, and the recipient's `unread`) in one atomic batch, so a stored message without its inbox update cannot happen. A retry with the same message id fails on create, so unread is never counted twice. `mark-read` recounts unread from the last message seen, so any drift corrects itself the next time the conversation is read. Clients cannot write `signalsInbox` at all (rules), so nobody can change another member's unread or last-message data.

## Manual steps before this works in production

1. *(Only if account linking is ever surfaced again.)* Firebase console, Authentication, Sign-in method: enable Email/Password and Google. Not needed while members stay anonymous.
2. **Firestore index.** `firestore.indexes.json` already declares `signalsPairs (participants array-contains, createdAt desc)`. It is not proven to be deployed. There is no automated index deployment on `main`, so deploy it by hand: `firebase deploy --only firestore:indexes --project <the production project>`. Check in the Firebase console, Firestore, Indexes, that it is "Enabled". Until then the inbox returns 503 `inbox_index_missing` instead of a short list. This now also applies to an older app that asks for the whole list with no page size (it used to work without the index, by an unordered read capped at 100, which is the behaviour that was removed).
3. No rules change. Do not republish rules for this work.
4. Deploy order: the server (`api/`) and the app can go out together. An older app against the new server still works (see "Compatibility"); a new app against an older server gets `limit` and `before` ignored and the old oldest-100 behaviour, so deploy the server first if they cannot go together.

## Compatibility

- `view=messages` with no `limit` returns the newest 100 (before: the oldest 100) and an `olderCursor`; an older app ignores the extra field.
- A block or suspension on `view=messages` now answers 403 `conversation_unavailable` (before: `not_allowed`). An older app shows its generic error text for the unknown code. Sending a message still answers `not_allowed` / `account_unavailable` as before.
- No Firestore data, rules or schema change, and no migration. Nothing is deleted anywhere.

## Verification status

- **Verified on the Firebase emulators and in unit and component tests:** pagination at 50, 100, 150, 500 and 1,100 messages, cursor safety, both members' inboxes, concurrent sends, blocked and suspended chats, duplicate acceptance, more than 100 conversations, the missing-index error, account linking with email and with a Google test credential (the same uid is kept), collisions, listener retries, refresh races.
- **Not verified against production or a real device:** that the message queries (see "Firestore queries and indexes") are served by Firestore's automatic single-field indexes (expected, but the emulator does not enforce indexes; the `signalsPairs` composite index was seen in the project's index list); that Email/Password and Google sign-in are enabled; the real Google popup (only its wrapper is tested, with the popup call replaced); scroll position in a real browser (tested with fake layout sizes); behaviour on a real phone or PWA.

## Catch-up polling and equal timestamps

A poll after the first load asks for what changed since its cursor (`after`). It returns at most 100 changes. When it hits that limit the reply carries `more: true` and a **continuation position** (`seconds.nanos.id`, the full-precision `updatedAt` and the message id of the last change returned) instead of a time, and the app asks again at once with that position. The continuation query orders by `(updatedAt, document id)` and starts strictly after that pair, so any number of changes sharing one timestamp are returned once each, with no gap and no repeat. The history pages (`before`) use the same kind of compound `(createdAt, id)` cursor. Both are covered by emulator tests with 250 messages that share a single timestamp.

## Firestore queries and indexes

Every query the Signals code runs, and what it needs. **No composite index was added by this work, and `firestore.indexes.json` is unchanged.**

| Query | Needs |
| --- | --- |
| Inbox page: `signalsPairs` where `participants` array-contains, order by `createdAt` desc then document id desc, optional start-after, limit | The composite index `signalsPairs (participants CONTAINS, createdAt DESC)`, **declared** in `firestore.indexes.json`. The project's index list (read with `firebase firestore:indexes`) showed it present. If it is missing the inbox answers 503 `inbox_index_missing`. |
| Accept: `signalsPairs` where `participants ==` the two ids and `status == 'active'`, limit 1 | Equality filters only, no composite index. |
| Invitations: `signalsInvitations` where `recipientId` (or `senderId`) `==` the member, optionally `status == 'pending'`, limit 50 | Equality filters only, no composite index. |
| Messages, newest page and older pages: order by `createdAt` desc then document id desc, optional start-after, limit | Single-field indexes (automatic): `createdAt` descending, with the document name ordered the same way. Expected to need no composite index. |
| Messages, catch-up: `updatedAt >` a time, order by `updatedAt` asc, limit | Single-field index on `updatedAt` (automatic). |
| Messages, catch-up continuation: order by `updatedAt` asc then document id asc, start-after, limit | Single-field index on `updatedAt` (automatic), document name ascending. |
| Mark read: `createdAt >` a time, order by `createdAt` asc, limit 100 | Single-field index on `createdAt` (automatic). |

The automatic single-field indexes exist unless a `fieldOverrides` entry disables them. The only override in `firestore.indexes.json` is for the `public` collection group, so none of the message queries are affected.

**Not verified against production.** The emulator does not enforce indexes, and no production query was run. The composite index for the inbox was seen in the project's index list; the single-field indexes behind the message queries are assumed from how Firestore works, not confirmed. The first real check is to open a long conversation on the deployed build: a missing index shows as a failed request, and the server log line says "The query requires an index" with a link to create it. Deploy nothing for these queries unless that happens.

## Limits that remain

- An anonymous account whose session is already gone cannot be recovered. This fix protects members who save their account **before** that happens. Members who already lost a session lose reach to the old conversations (the data is still stored under the old uid).
- Linking a Google account changes the token's sign-in provider to `google.com`. Admin access still needs the hand-made `admins/{uid}` document (`api/_lib.js` `requireAdmin`, and `isAdmin()` in the rules), so no member becomes an admin by linking.
- Browser eviction cannot be fully prevented. `navigator.storage.persist()` is best effort.
- There is no way for a member to save or link their account, by design. An anonymous account whose browser session is lost cannot be reached again.
- Two members who already have two separate active conversations (created before this change) keep both; nothing merges or deletes them.
- The `LF-06` Firestore rules test failed once during a full run under load and passed on every re-run (it expects an update with no fresh timestamp to be refused). It is unrelated to this change; watch for it if it appears in CI.

# Current Vibe

A temporary mood status on a member's profile: an emoji, a mood and an optional short message (up to 100 characters). It ends
24 hours after it is published, and a member can change or remove it at any time. It is not a mood board, a feed or a permanent
profile field. (The older permanent "My Vibe" text on a profile is a different thing and is unchanged.)

## Where it appears

- **Profile page:** a compact card (mood, message, "Updated 2 hours ago · Expires in 22 hours"). On your own page it has Edit Mood
  and Remove Mood and says who can see it; with no live status it shows a quiet "Set your Current Vibe" button. On someone else's
  page it appears only when they have a live status you are allowed to see, and never as an empty card.
- **Seek:** a small emoji-and-name chip beside the partner's name in the chat header.
- **Signals:** the same chip in the conversation header. Never on individual messages.
- **Not** in Cosmos, Galaxy, on posts, or in matching.

Exact times are shown in Manila time (Asia/Manila) in the tooltip; stored times are ordinary Firestore timestamps.

## Where it is stored

`currentVibes/{uid}`, one document per member, written only by the Signals API (Admin SDK):

| Field | Meaning |
|---|---|
| `moodId`, `emoji`, `label` | One of the 14 moods. The emoji and name always come from the server's list, never from the request. |
| `message` | Optional, tidied to one line, at most 100 characters (an emoji counts as one). |
| `visibility` | `everyone`, `connections` or `nobody`. |
| `createdAt`, `updatedAt`, `expiresAt` | Stamped by the server. `expiresAt` is exactly `updatedAt` plus 24 hours. |

`firestore.rules` denies every client read and write of this collection (`CV-01`), so a hidden or expired status cannot be fetched
directly and nobody can extend an expiry.

## Expiry

The stored `expiresAt` is the only source of truth. Every read compares it with the server's clock and returns nothing once it has
passed, so a status is gone the moment its time is up, even if the member never opens the app again. Nothing depends on a timer or
a cleanup job. Publishing again replaces the record and starts a new 24 hours.

Expired records are not deleted automatically (to avoid a scheduled job); they are simply never returned, and are replaced the
next time the member publishes. To also have Firestore remove them, add a TTL policy on the `expiresAt` field of the
`currentVibes` collection group in the Firebase console (Firestore > Time-to-live). That is optional housekeeping and has no
effect on who can see what.

## Who can see it

Decided on the server on every read (`api/_vibe.js`), in this order:

1. The viewer must be an adult member who is not suspended.
2. The member must be set up, an adult and not suspended, and neither may have blocked the other.
3. The member's own setting: **Everyone who can view my profile**, **Approved connections only** (an active Signals connection), or
   **Nobody** (only the owner sees it).
4. It must not have expired.

Whatever the reason a status is not shown, the answer is the same (`{ vibe: null }` for the indicator, no `currentVibe` on a
profile), so it never says why. The member's own setting is returned to the owner only.

## API (all in `api/signals.js`, so no new serverless function)

- `GET ?view=vibe&memberId=...` returns `{ vibe }` for the indicators (Seek, Signals header).
- `GET ?view=profile&memberId=...` now includes `currentVibe`.
- `POST { action: 'vibe-set', moodId, message?, visibility? }` publishes. The member is the one in the signed-in token. Limited to
  30 publishes an hour.
- `POST { action: 'vibe-clear' }` removes it.

Looking at other members' statuses is limited to 120 per minute per viewer.

## Tests

`test/api/current-vibe.integration.test.js` (emulators), `CV-01` in `test/firestore-rules.test.ts`, `src/utils/currentVibe.test.ts`,
`src/components/CurrentVibe.test.tsx`, `ProfileCurrentVibe.test.tsx` and `VibeIndicators.test.tsx`.

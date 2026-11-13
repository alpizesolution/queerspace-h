# Current Vibe (custom status)

A temporary custom status on a member's profile: one emoji and a short message in the member's own words (up to 60 characters),
shown as a small bubble floating beside their avatar. It ends 24 hours after it is saved, and a member can change or clear it at any
time. It is not a mood board, a feed or a permanent profile field. (The older permanent "My Vibe" text on a profile is a different
thing and is unchanged.)

## What a status is

- An **emoji** (any single emoji; the editor offers 36 common ones), a **message** (free text, up to 60 characters, one line), or both.
  At least one of the two is needed. There are no fixed moods or categories.
- Who can see it: **Everyone who can view my profile**, **Approved connections only**, or **Nobody**.
- Examples: "🥺 overwhelmed rn", "☕ need coffee", "🌙 taking it slow", "💜 feeling loved", "🦋 healing quietly".

## Where it appears

- **Public profile page** (opened by tapping a member's name or avatar, or a shared profile link): the bubble floats at the top right
  of the avatar. On your own page with no status, a small dashed "Add status" pill sits in the same spot. On someone else's page with
  no status, nothing is shown at all.
- **Your own profile** (the Profile button in the header and menu opens your full profile page directly): the same bubble, or the "Add status" pill, beside your avatar.
- **Seek and Signals headers:** a small chip beside the partner's name (the emoji and a cut-off message). Never on messages.
- **Not** in Cosmos, Galaxy, on posts, or in matching.

The bubble is one line with an ellipsis so it stays small; on someone else's profile, tapping it shows the whole message. The time
left is in the tooltip (in Manila time), not on the bubble. Tapping your own bubble opens the editor.

## The editor

One compact sheet: a live preview of the bubble, an emoji button and a message box with a "characters left" count, a row of
common emoji (opens for a new status, closes once one is chosen), who can see it, and **Save**, **Cancel** and (when editing) **Clear**.

## Where it is stored

`currentVibes/{uid}`, one document per member, written only by the Signals API (Admin SDK):

| Field | Meaning |
|---|---|
| `emoji` | Exactly one emoji, or an empty string for a words-only status. |
| `message` | Up to 60 characters, tidied to one line, no control characters. |
| `visibility` | `everyone`, `connections` or `nobody`. |
| `createdAt`, `updatedAt`, `expiresAt` | Stamped by the server. `expiresAt` is exactly `updatedAt` plus 24 hours. |

`firestore.rules` denies every client read and write of this collection (`CV-01`), so a hidden or expired status cannot be fetched
directly and nobody can extend an expiry.

Statuses saved before this redesign used a mood (`moodId`, `label`, a message up to 100 characters). They are still read, as their
emoji with their message (or the mood name, cut to 60 characters), until they expire, and the next save replaces them completely.
Nothing is migrated.

## Expiry

The stored `expiresAt` is the only source of truth. Every read compares it with the server's clock and returns nothing once it has
passed, so a status is gone the moment its time is up, even if the member never opens the app again. Nothing depends on a timer or
a cleanup job. Saving again replaces the record and starts a new 24 hours. Clearing or expiring a status never touches the profile.

Expired records are not deleted automatically (to avoid a scheduled job); they are simply never returned, and are replaced the
next time the member saves. To also have Firestore remove them, add a TTL policy on the `expiresAt` field of the `currentVibes`
collection group in the Firebase console (Firestore > Time-to-live). That is optional housekeeping with no effect on who sees what.

## Who can see it

Decided on the server on every read (`api/_vibe.js`), in this order:

1. The viewer must be an adult member who is not suspended.
2. The member must be set up, an adult and not suspended, and neither may have blocked the other.
3. The member's own setting (above). "Approved connections" means an active Signals connection.
4. It must not have expired.

Whatever the reason a status is not shown, the answer is the same (`{ vibe: null }` for the indicator, no `currentVibe` on a
profile), so it never says why. The member's own setting is returned to the owner only.

## API (all in `api/signals.js`, so no new serverless function)

- `GET ?view=vibe&memberId=...` returns `{ vibe }` for the indicators (Seek, Signals header).
- `GET ?view=profile&memberId=...` includes `currentVibe`.
- `POST { action: 'vibe-set', emoji?, message?, visibility? }` saves. The member is the one in the signed-in token. Anything other
  than one emoji, a message of up to 60 characters and a known visibility is refused. Limited to 30 saves an hour.
- `POST { action: 'vibe-clear' }` removes it.

Looking at other members' statuses is limited to 120 per minute per viewer.

## Tests

`test/api/current-vibe.integration.test.js` (emulators), `CV-01` in `test/firestore-rules.test.ts`, `src/utils/currentVibe.test.ts`,
`src/components/CurrentVibe.test.tsx`, `ProfileCurrentVibe.test.tsx`, `MyProfileCurrentVibe.test.tsx` and `VibeIndicators.test.tsx`.

# GIFs in the Signal Inbox

Members can send a GIPHY GIF inside a Signals conversation. It reuses the existing `send-message` action, so every check on a
normal message (conversation membership, active pair, blocks, suspensions) applies to a GIF unchanged.

## Configuration

| Variable | Where | Notes |
| --- | --- | --- |
| `GIPHY_API_KEY` | Vercel, **server-only** | An *API* key from <https://developers.giphy.com/dashboard/>. Never prefix with `VITE_`, never commit it. |

If it is missing, `GET /api/signals?view=gifs` answers `503 gif_not_configured` and the picker shows "GIFs are unavailable
right now". Text, photos and reactions are not affected. No new serverless function was added (`api/_giphy.js` is a helper).

The CSP in `vercel.json` allows GIPHY images (`img-src https://*.giphy.com`). The browser never calls GIPHY's API, only loads
the images.

## API

- `GET /api/signals?view=gifs[&q=text][&limit=1-30][&offset=0-200]` → `{ gifs: [...], nextOffset: number | null }`.
  No `q` means trending. `q` is at most 50 characters. Rating is fixed at `pg-13`. 40 requests a minute per member (`429 rate_limited`).
  Trending pages are cached on the server for a minute.
- `POST /api/signals { action: 'send-message', pairId, messageId, kind: 'gif', gifId, replyTo? }`. The client sends **only the id**.
  The server checks the conversation, looks the id up on GIPHY (`GET /v1/gifs/{id}`), and stores GIPHY's own renditions after
  checking that each is an `https` address on `media*.giphy.com` / `i.giphy.com` containing that id. A link in the request
  (`url`, `gifUrl`, `gif`) is refused with `400 invalid_gif`. 20 GIF sends a minute per member. A repeated `messageId` returns the
  stored message and never makes a second copy.

Errors: `400 invalid_gif_request` / `invalid_gif`, `403 not_allowed` / `account_unavailable`, `404 gif_not_found`,
`429 gif_rate_limited` (GIPHY) or `rate_limited` (ours), `502 gif_unavailable`, `503 gif_not_configured`.

## Stored message

`signalsPairs/{pairId}/messages/{id}`: `{ senderId, kind: 'gif', text: 'GIF', gif: { id, url, previewUrl, stillUrl, width, height, previewWidth, previewHeight, title }, createdAt, updatedAt }`.
`url` is the message rendition (`downsized_medium`), `previewUrl` the small `fixed_width` used in the picker. When the thread is
read, a stored GIF whose addresses are not approved GIPHY addresses is dropped and the message shows as plain "GIF" text.
Clients cannot write to `signalsPairs` at all (rules deny everything), so only this path can create a GIF message.

## Attribution and motion

The picker shows "Powered by GIPHY". GIPHY's guidelines also ask for their logo where the API is used; swap the text for the
official "Powered By GIPHY" badge asset if you want to follow that to the letter. With `prefers-reduced-motion`, the picker and
messages show a still frame, and a tap plays the GIF.

## Galaxy Room

The same picker and the same GIPHY proxy are used in the Galaxy Room (public room). Search and trending are still
`GET /api/signals?view=gifs`; there is one GIPHY client (`sharedGiphy`) and one `GIPHY_API_KEY`.

Room text messages are written by the app straight to Firestore, but a GIF needs the server to ask GIPHY, so GIFs are sent with
`POST /api/room { action: 'send-gif', gifId, messageId? }` (`api/room.js`, logic in `api/_room.js`). Nothing else may be in the
request (no author, link, text or reply quote: `400 invalid_gif`). The server writes the message to `public_room_messages` as
`{ authorId, authorName, authorPronouns, authorAvatar?, text: 'GIF', kind: 'gif', gif: {...}, timestamp }`, with the identity taken
from the member's own profile. `firestore.rules` were not loosened: a client still cannot create a message with `kind` or `gif`
fields, so this endpoint is the only way to make one. Members see GIFs through the existing live feed, can react to them, and a
moderator removes one with the existing delete, which disappears from every open room.

Safeguards, mirroring the rules for text: an adult member with a completed profile, not suspended (`403 not_allowed` /
`account_unavailable`), the room slow mode (2 seconds, shared with text through `rate_limits/{uid}.publicRoom`, `429 too_fast`),
and at most 10 GIFs a minute (`429 rate_limited`). Errors from GIPHY are the same codes as in Signals. Replying to a message
with a GIF is not supported in the room (the quote check lives in the rules). The picker stays open while a GIF sends and closes
when it succeeds; a failed send keeps it open with the reason and retries with the same message id, so no copy is made.

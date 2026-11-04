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

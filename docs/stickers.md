# Stickers in Signals

Members can send a sticker in a Signals conversation. A sticker is a native message kind (`kind: 'sticker'`), not a photo or a GIF.
It reuses the existing `send-message` action, so every check on a normal message (conversation membership, active pair, blocks,
suspensions, retries by `messageId`) applies unchanged. No new function or route was added (`api/_stickers.js` is a helper).

This phase ships the two regular packs only. **After Dark (18+) is not part of the app** (see "After Dark" below).

## Packs

| Pack | Folder | Stickers |
| --- | --- | --- |
| Sapphic Feelings | `public/stickers/sapphic-feelings/` | 20 |
| Androgynous Sapphic | `public/stickers/androgynous-sapphic/` | 20 |

Files are `NN_caption.png` (512 x 512 RGBA). A sticker's id is `<pack-id>-NN`, for example `sapphic-feelings-05`. Ids never change once published.

### Catalog

`npm run stickers` (`scripts/generate-stickers.mjs`) scans the two folders and writes both sides of the app from the same files:

- `api/_stickers.generated.js`: the server's trusted list.
- `src/utils/stickerCatalog.ts`: the app's copy, used to draw the picker and the message.

`src/utils/stickers.test.ts` fails if either file is out of date, if the two lists differ, if a file is not a 512 x 512 RGBA PNG, or if
anything about After Dark appears in them. After adding or renaming a sticker file, run `npm run stickers`.

## Sending (API)

`POST /api/signals { action: 'send-message', pairId, messageId?, kind: 'sticker', stickerId, replyTo? }`

The client sends **only the id**. The server looks it up in its own list; `text`, `sticker`, `stickerPackId`, `packId`, `path`, `url`, `src`,
`file`, `cardId`, `gifId`, `gif`, `card`, `game`, `testId` are refused with `400 invalid_sticker`. An unknown id (including every After Dark
id) is `400 invalid_sticker`. `stickerId` on any other kind is `400 invalid_message`.

## Stored message

`signalsPairs/{pairId}/messages/{id}`: `{ senderId, kind: 'sticker', sticker: { id, packId }, text: 'Sticker', createdAt, updatedAt }`.
Existing kinds are unchanged, and older messages (no `kind`) read exactly as before.

When a thread is read, the sticker is re-read from the server's list: the pack always comes from the list, and a record whose id is not on
the list is returned as plain `Sticker` text with no picture. The app draws the picture from `/stickers/<pack>/<file>` built from its own
list, so a message can never make the app load another image. Clients cannot write to `signalsPairs` at all (rules deny everything).

## Inbox, unread and previews

The inbox preview is `Sticker` for both people (`previewText(..., 'sticker')` in `api/_inbox.js`). The recipient's unread counter and the
latest-message line are written in the same batch as the message, exactly as for text. Ordering and paging (`_messages.js`) are by
`createdAt` and id and do not care about the kind.

## The picker

The sticker button sits in the composer's attachment row, between GIF and Comfort Cards. It opens a sheet with Recent, Favorites and the
two packs. Tapping a sticker previews it, and sending is a second tap, like the GIF picker. A sent sticker shows at once as the sticker,
marked "Sending...", and goes through the same outbox as text (no duplicate image bubble). Recent (12) and Favorites (60) are kept on this
device only, as ids in `localStorage`; ids that are no longer in the catalog are dropped when read.

## Artwork status (needs correction before release)

The artwork was imported unchanged. Inspection of the 40 regular files found problems in the art itself:

- **A fixed crop window.** Every file's artwork sits inside the same box (about x 107-404, y 133-378 of the 512 x 512 canvas), and 37 of the 40
  files have opaque pixels touching that box on one or more sides, so the art looks cut off at the left or right edge. This suggests the stickers
  were cropped from a larger sheet. About 58% of the canvas width is empty, so stickers look smaller than they could.
- **Detached fragments** (pieces of a neighbouring sticker): `sapphic-feelings` 08, 13, 19; `androgynous-sapphic` 02, 06, 07, 12, 17.
- **A white bar baked into the artwork** near the top: `androgynous-sapphic` 06, 07 and 10 (`10_sana_all.png`, rows 133-140, x 107-338).
- Transparency is fine (all files are RGBA with a fully transparent background).

None of this was edited. Replacing a file with a corrected one of the same name needs no code change; run `npm run stickers` and the tests.

## After Dark (18+): disabled, requirements for later

After Dark is **not** in `public/`, the catalog, the generated files, the picker or any API response, and its ids are refused by the server
like any other unknown id. Its artwork is not in this repository. Before it can be switched on:

1. **Decide whether self-reported age is enough.** The only age signal in the product is the member's self-reported birthday
   (`api/_adult.js`, an access gate and not identity verification; see `docs/age-review.md`). This needs an explicit product decision.
2. **Use `isAdultMember()` only if that is approved.** Do not create a new age system.
3. **Move the assets to private R2 storage** (the private bucket and SigV4 client in `api/_media.js`), not `public/`. A file under `public/` is
   reachable by anyone who knows its URL, so hiding it in the app is not protection.
4. **Authorised server-side delivery.** Serve the bytes only through the existing Signals function (a `view` on `GET /api/signals`, so no new
   function is added and `test/api/function-limit.test.js` still passes), after checking the viewer belongs to the conversation that holds
   that sticker. Send `Cache-Control: private, no-store`; never return a public or long-lived URL.
5. **Check both participants.** Sending requires the sender and the other member to pass the adult check, the way the NSFW cards need an
   adult who opted in.
6. **Revalidate on read.** Reading a restricted sticker message re-checks the viewer on every read and returns a neutral placeholder (the way
   NSFW cards put only an id and a neutral line in `text` and previews) when they no longer qualify.
7. **No public asset URLs, and no catalog leak.** Keep After Dark ids, captions and previews out of the app bundle and out of responses for
   anyone who is not eligible; the inbox preview stays the generic `Sticker`.

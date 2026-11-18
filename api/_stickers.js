// Stickers for Signals: a message that is just a picture from the app's own sticker packs. A sticker is sent by its id alone, the
// server checks the id against its own list (api/_stickers.generated.js, built from the files in public/stickers), and a message
// stores only `{ kind: 'sticker', sticker: { id, packId } }`. Nothing the app says about the picture (a path, a link, a caption)
// is ever stored or trusted, and the address of the image is worked out by the app from the id.
//
// Only the regular packs exist here. "After Dark" (18+) is deliberately absent: its ids are not in the list, so they are refused like
// any other unknown id. See docs/stickers.md for what must be true before it can be switched on.
// Underscore-prefixed files in api/ are not deployed as separate functions.
import { STICKERS, STICKER_PACKS } from './_stickers.generated.js';

export { STICKERS, STICKER_PACKS };

/** What a sticker message says as plain text (replies, accessibility, older apps). */
export const STICKER_TEXT = 'Sticker';

const BY_ID = new Map(STICKERS.map(sticker => [sticker.id, sticker]));

/** True for an id in the approved list. Anything else (including non-strings and After Dark ids) is refused. */
export const isStickerId = value => typeof value === 'string' && BY_ID.has(value);

export const stickerById = id => (isStickerId(id) ? BY_ID.get(id) : null);

/** A stored message's sticker read back for a viewer. Only the id is trusted: the pack always comes from the list. */
export function shapeStoredSticker(stored) {
  const sticker = stickerById(stored?.id);
  return sticker ? { id: sticker.id, packId: sticker.packId } : null;
}

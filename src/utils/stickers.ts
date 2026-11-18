/**
 * Stickers in Signals. The app only ever knows a sticker by its id; the picture's address is worked out here from the approved
 * list, so a message can never make the app load an image from anywhere else. Keep in step with api/_stickers.js (a test checks).
 * "After Dark" (18+) is not part of the app yet, see docs/stickers.md.
 */
import { STICKERS, STICKER_PACKS, type StickerEntry } from './stickerCatalog.ts';

export { STICKERS, STICKER_PACKS };
export type Sticker = StickerEntry;

export const STICKER_TEXT = 'Sticker';

const BY_ID = new Map(STICKERS.map((s) => [s.id, s]));

export const isStickerId = (value: unknown): value is string => typeof value === 'string' && BY_ID.has(value);
export const stickerById = (id: unknown): Sticker | null => (isStickerId(id) ? (BY_ID.get(id) as Sticker) : null);
export const stickersInPack = (packId: string): Sticker[] => STICKERS.filter((s) => s.packId === packId);

/** Where the picture lives. Always a file of this app under /stickers, built from the list, never taken from a message. */
export const stickerUrl = (sticker: Pick<Sticker, 'packId' | 'file'>): string => `/stickers/${sticker.packId}/${sticker.file}`;

/** A message's sticker as stored by the server: valid only if its id is on the approved list (then the pack comes from the list). */
export function parseSticker(value: unknown): { id: string; packId: string } | null {
  const id = (value as { id?: unknown } | null | undefined)?.id;
  const sticker = stickerById(id);
  return sticker ? { id: sticker.id, packId: sticker.packId } : null;
}

// ---- Recent and favourite stickers: ids kept on this device only (no account data) ----
const RECENT_KEY = 'qs.stickers.recent';
const FAVORITE_KEY = 'qs.stickers.favorites';
const RECENT_MAX = 12;
const FAVORITE_MAX = 60;

function readIds(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed.filter(isStickerId) : [];
  } catch {
    return [];
  }
}
function writeIds(key: string, ids: string[]) {
  try { localStorage.setItem(key, JSON.stringify(ids)); } catch { /* storage unavailable: the lists just do not persist */ }
}

export const getRecentStickers = (): Sticker[] => readIds(RECENT_KEY).map((id) => stickerById(id)!).filter(Boolean);
export function rememberSticker(id: string) {
  if (!isStickerId(id)) return;
  writeIds(RECENT_KEY, [id, ...readIds(RECENT_KEY).filter((x) => x !== id)].slice(0, RECENT_MAX));
}
export const getFavoriteStickers = (): Sticker[] => readIds(FAVORITE_KEY).map((id) => stickerById(id)!).filter(Boolean);
export function toggleFavoriteSticker(id: string): string[] {
  if (!isStickerId(id)) return readIds(FAVORITE_KEY);
  const current = readIds(FAVORITE_KEY);
  const next = current.includes(id) ? current.filter((x) => x !== id) : [id, ...current].slice(0, FAVORITE_MAX);
  writeIds(FAVORITE_KEY, next);
  return next;
}
export const favoriteStickerIds = (): string[] => readIds(FAVORITE_KEY);

// GIPHY for Signals: search and trending go through the server, so the API key never reaches the browser, and a GIF in a
// message is looked up on GIPHY by its id. The client never supplies a URL: the stored link comes from GIPHY's own answer
// and must also be a GIPHY media address, so a message can never point at an arbitrary site.
//
// Underscore-prefixed files in api/ are not deployed as separate functions.
import { rateLimit } from './_lib.js';

const GIPHY_API = 'https://api.giphy.com/v1/gifs';
/** Content rating allowed in Signals. GIPHY filters on its side; the same cap is applied again when a GIF is sent. */
export const GIF_RATING = 'pg-13';
const RATINGS = ['g', 'pg', 'pg-13'];
export const GIF_PAGE_DEFAULT = 18;
export const GIF_PAGE_MAX = 30;
export const GIF_OFFSET_MAX = 200;
export const GIF_QUERY_MAX = 50;
export const GIF_SEARCHES_PER_MINUTE = 40;
export const GIF_SENDS_PER_MINUTE = 20;
const UPSTREAM_TIMEOUT_MS = 6000;
const TRENDING_CACHE_MS = 60_000;
const GIF_TITLE_MAX = 100;
/** The text kept on a GIF message, so previews and replies have something to show. */
export const GIF_TEXT = 'GIF';

const fail = (statusCode, code) => Object.assign(new Error(code), { statusCode });

/** A GIPHY id: letters and digits only. Anything else is refused before it can reach a URL. */
export const isGifId = value => typeof value === 'string' && /^[A-Za-z0-9]{5,30}$/.test(value);

/**
 * True only for an https address on GIPHY's media hosts (media.giphy.com, media0-4.giphy.com, i.giphy.com) that belongs to
 * this GIF: no credentials, no port, and the GIF's id is a path segment. Used on what GIPHY returns and again on what is
 * read back from storage, so a bad value is never rendered.
 */
export function isApprovedGifUrl(value, id) {
  if (typeof value !== 'string' || value.length > 600) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  if (!/^(media\d?|i)\.giphy\.com$/.test(url.hostname)) return false;
  if (id !== undefined) {
    const segments = url.pathname.split('/');
    // media.giphy.com/media/<id>/giphy.gif (also with a version segment before the id), or i.giphy.com/<id>.gif
    if (!isGifId(id) || !(segments.includes(id) || segments[segments.length - 1].startsWith(`${id}.`))) return false;
  }
  return /\.(gif|webp|mp4)$/i.test(url.pathname);
}

const dimension = value => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 16 && n <= 2000 ? n : null;
};

const cleanTitle = value => (typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, GIF_TITLE_MAX)
  : '');

/** Picks the first rendition that has a usable GIF address for this id. */
function rendition(images, names, id, extension = 'url') {
  for (const name of names) {
    const entry = images?.[name];
    const url = entry?.[extension];
    if (isApprovedGifUrl(url, id) && /\.gif(\?|$)/i.test(url)) {
      const width = dimension(entry.width);
      const height = dimension(entry.height);
      if (width && height) return { url, width, height };
    }
  }
  return null;
}

/**
 * Turns one GIPHY object into what Signals stores and sends to the app: the id, a small animated preview for the picker,
 * the message rendition, a still frame (for reduced motion), and the size. Returns null when anything is missing or not
 * a GIPHY media address, or the rating is above the allowed one, so such a GIF is simply left out.
 */
export function shapeGif(item) {
  const id = item?.id;
  if (!isGifId(id)) return null;
  const rating = typeof item.rating === 'string' ? item.rating.toLowerCase() : '';
  if (rating && !RATINGS.includes(rating)) return null;
  const images = item.images;
  const preview = rendition(images, ['fixed_width', 'fixed_width_small', 'downsized_small'], id);
  const full = rendition(images, ['downsized_medium', 'downsized', 'fixed_width'], id);
  const still = rendition(images, ['fixed_width_still', 'downsized_still', 'original_still'], id);
  if (!preview || !full) return null;
  return {
    id,
    url: full.url,
    previewUrl: preview.url,
    stillUrl: still?.url ?? null,
    width: full.width,
    height: full.height,
    previewWidth: preview.width,
    previewHeight: preview.height,
    title: cleanTitle(item.alt_text || item.title),
  };
}

/**
 * Reads a stored message's GIF back into the shape the app renders. Anything that is not an approved GIPHY address is
 * dropped, so even a bad record in the database cannot make the app load another site's image.
 */
export function shapeStoredGif(stored) {
  const id = stored?.id;
  if (!isGifId(id) || !isApprovedGifUrl(stored.url, id) || !isApprovedGifUrl(stored.previewUrl, id)) return null;
  const width = dimension(stored.width);
  const height = dimension(stored.height);
  if (!width || !height) return null;
  return {
    id,
    url: stored.url,
    previewUrl: stored.previewUrl,
    stillUrl: isApprovedGifUrl(stored.stillUrl, id) ? stored.stillUrl : null,
    width,
    height,
    previewWidth: dimension(stored.previewWidth) ?? width,
    previewHeight: dimension(stored.previewHeight) ?? height,
    title: cleanTitle(stored.title),
  };
}

/** Search text, page size and offset from a request, bounded. Throws invalid_gif_request for anything out of range. */
export function parseGifQuery(params) {
  const bad = () => fail(400, 'invalid_gif_request');
  const get = name => {
    const value = params?.[name];
    return Array.isArray(value) ? value[0] : value;
  };
  let q = get('q');
  if (q !== undefined && q !== null && typeof q !== 'string') throw bad();
  q = (q ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (q.length > GIF_QUERY_MAX) throw bad();
  const number = (name, fallback, min, max) => {
    const raw = get(name);
    if (raw === undefined || raw === null || raw === '') return fallback;
    if (!/^\d{1,4}$/.test(String(raw))) throw bad();
    const n = Number(raw);
    if (n < min || n > max) throw bad();
    return n;
  };
  return { q, limit: number('limit', GIF_PAGE_DEFAULT, 1, GIF_PAGE_MAX), offset: number('offset', 0, 0, GIF_OFFSET_MAX) };
}

/**
 * The GIPHY client. `fetchImpl` and `getKey` are injectable for tests. The key is read when a request is made, only on
 * the server, and is never logged or returned: errors are reported as a short code and the upstream status.
 */
export function createGiphy({ fetchImpl = (...args) => fetch(...args), getKey = () => process.env.GIPHY_API_KEY, now = () => Date.now() } = {}) {
  const trendingCache = new Map();

  async function call(path, params) {
    const key = getKey();
    if (typeof key !== 'string' || !key.trim()) {
      console.error('[GIPHY] GIPHY_API_KEY is not set');
      throw fail(503, 'gif_not_configured');
    }
    const url = new URL(`${GIPHY_API}/${path}`);
    url.searchParams.set('api_key', key.trim());
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
    let response;
    try {
      response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    } catch (error) {
      console.error(`[GIPHY] request failed: ${error?.name || 'error'}`); // never the URL: it carries the key
      throw fail(502, 'gif_unavailable');
    }
    if (response.status === 429) throw fail(429, 'gif_rate_limited');
    if (response.status === 401 || response.status === 403) {
      console.error(`[GIPHY] the key was refused (${response.status})`);
      throw fail(503, 'gif_not_configured');
    }
    if (response.status === 404) throw fail(404, 'gif_not_found');
    if (!response.ok) {
      console.error(`[GIPHY] upstream answered ${response.status}`);
      throw fail(502, 'gif_unavailable');
    }
    try {
      return await response.json();
    } catch {
      throw fail(502, 'gif_unavailable');
    }
  }

  const list = (body, { offset }) => {
    const gifs = (Array.isArray(body?.data) ? body.data : []).map(shapeGif).filter(Boolean);
    const total = Number(body?.pagination?.total_count);
    const count = Number(body?.pagination?.count);
    const next = offset + (Number.isFinite(count) && count > 0 ? count : gifs.length);
    const more = Number.isFinite(total) ? next < total : gifs.length > 0;
    return { gifs, nextOffset: more && next <= GIF_OFFSET_MAX ? next : null };
  };

  return {
    /** Trending when there is no search text, otherwise search. Trending pages are kept for a minute to spare the quota. */
    async browse({ q, limit, offset }) {
      const common = { limit, offset, rating: GIF_RATING, bundle: 'messaging_non_clips' };
      if (!q) {
        const cacheKey = `${limit}:${offset}`;
        const hit = trendingCache.get(cacheKey);
        if (hit && now() - hit.at < TRENDING_CACHE_MS) return hit.value;
        const value = list(await call('trending', common), { offset });
        trendingCache.set(cacheKey, { at: now(), value });
        if (trendingCache.size > 20) trendingCache.delete(trendingCache.keys().next().value);
        return value;
      }
      return list(await call('search', { ...common, q, lang: 'en' }), { offset });
    },

    /** One GIF by id, as GIPHY describes it. Throws gif_not_found for an id GIPHY does not know or will not serve. */
    async byId(id) {
      if (!isGifId(id)) throw fail(400, 'invalid_gif');
      const body = await call(id, { rating: GIF_RATING });
      const gif = shapeGif(Array.isArray(body?.data) ? null : body?.data);
      if (!gif || gif.id !== id) throw fail(404, 'gif_not_found');
      return gif;
    },
  };
}

/** Shared by the browse view and the send path. */
export async function limitGifSearches(db, uid) {
  await rateLimit(db, uid, 'signals-gif-search', GIF_SEARCHES_PER_MINUTE, 60_000);
}
export async function limitGifSends(db, uid) {
  await rateLimit(db, uid, 'signals-gif-send', GIF_SENDS_PER_MINUTE, 60_000);
}

/**
 * GIFs in Signals: the shape the app works with, and the checks that keep anything but GIPHY pictures off the screen.
 * The server has already checked these; they are checked again here so a wrong value can never become an <img src>.
 */

export type GifInfo = {
  id: string;
  /** The message rendition. */
  url: string;
  /** A small animated preview for the picker. */
  previewUrl: string;
  /** A still frame, for people who prefer reduced motion. */
  stillUrl: string | null;
  width: number;
  height: number;
  previewWidth: number;
  previewHeight: number;
  title: string;
};

export type GifPage = { gifs: GifInfo[]; nextOffset: number | null };

export const GIF_QUERY_MAX = 50;

export const isGifId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9]{5,30}$/.test(value);

/** An https address on GIPHY's media hosts that belongs to this GIF. Same rule as the server. */
export function isApprovedGifUrl(value: unknown, id: string): value is string {
  if (typeof value !== 'string' || value.length > 600 || !isGifId(id)) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  if (!/^(media\d?|i)\.giphy\.com$/.test(url.hostname)) return false;
  const segments = url.pathname.split('/');
  if (!(segments.includes(id) || segments[segments.length - 1].startsWith(`${id}.`))) return false;
  return /\.(gif|webp|mp4)$/i.test(url.pathname);
}

const size = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 16 && value <= 2000 ? value : null);

/** Reads one GIF from the server's answer. Returns null for anything that is not a complete, approved GIPHY GIF. */
export function parseGifInfo(raw: unknown): GifInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const id = item.id;
  if (!isGifId(id) || !isApprovedGifUrl(item.url, id) || !isApprovedGifUrl(item.previewUrl, id)) return null;
  const width = size(item.width);
  const height = size(item.height);
  if (!width || !height) return null;
  return {
    id,
    url: item.url as string,
    previewUrl: item.previewUrl as string,
    stillUrl: isApprovedGifUrl(item.stillUrl, id) ? (item.stillUrl as string) : null,
    width,
    height,
    previewWidth: size(item.previewWidth) ?? width,
    previewHeight: size(item.previewHeight) ?? height,
    title: typeof item.title === 'string' ? item.title.slice(0, 100) : '',
  };
}

/** Reads a page of GIFs. A GIF that fails the checks is left out; a malformed page is an error (null). */
export function parseGifPage(raw: unknown): GifPage | null {
  if (!raw || typeof raw !== 'object') return null;
  const page = raw as { gifs?: unknown; nextOffset?: unknown };
  if (!Array.isArray(page.gifs)) return null;
  const gifs = page.gifs.map(parseGifInfo).filter((gif): gif is GifInfo => gif !== null);
  const next = page.nextOffset;
  return { gifs, nextOffset: typeof next === 'number' && Number.isInteger(next) && next > 0 ? next : null };
}

/** Search text as it will be sent: tidy spaces, no control characters, at most 50 characters. */
export function cleanGifQuery(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, GIF_QUERY_MAX);
}

export type GifProblem = 'unavailable' | 'busy' | 'offline' | 'failed';

/** Words for why the picker could not load. */
export function gifProblemText(problem: GifProblem): string {
  switch (problem) {
    case 'unavailable': return 'GIFs are unavailable right now.';
    case 'busy': return 'Too many searches. Wait a moment and try again.';
    case 'offline': return 'No connection. Check your internet and try again.';
    default: return 'Could not load GIFs. Try again.';
  }
}

/** Maps a server error code to a problem the picker can describe. */
export function gifProblemFor(status: number, code: string | undefined): GifProblem {
  if (code === 'gif_not_configured' || code === 'account_unavailable') return 'unavailable';
  if (status === 429 || code === 'rate_limited' || code === 'gif_rate_limited') return 'busy';
  return 'failed';
}

/** Words for a GIF that could not be sent, from the server's error code; null when the code is not a GIF one. */
export function gifSendProblemText(code: string | undefined): string | null {
  switch (code) {
    case 'gif_not_found': case 'invalid_gif': return 'That GIF is no longer available. Pick another one.';
    case 'gif_rate_limited': case 'rate_limited': return 'You are sending GIFs very quickly. Wait a moment and try again.';
    case 'gif_not_configured': return 'GIFs are unavailable right now.';
    case 'gif_unavailable': return 'GIFs could not be reached. Try again in a moment.';
    default: return null;
  }
}

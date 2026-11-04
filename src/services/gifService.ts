import { auth } from '../lib/firebase.ts';
import { cleanGifQuery, gifProblemFor, parseGifPage, type GifPage, type GifProblem } from '../utils/gif.ts';

export type GifResult = { ok: true; page: GifPage } | { ok: false; problem: GifProblem };

const TIMEOUT_MS = 12_000;

/**
 * Trending GIFs (no text) or a search, through the server, which holds the GIPHY key. `signal` lets the picker cancel a
 * search the member has already typed past (that rejects with an AbortError, which the picker ignores).
 */
export async function fetchGifs(input: { query: string; offset?: number; limit?: number; signal?: AbortSignal }): Promise<GifResult> {
  const user = auth?.currentUser;
  if (!user) return { ok: false, problem: 'failed' };
  const params = new URLSearchParams({ view: 'gifs', limit: String(input.limit ?? 18) });
  const q = cleanGifQuery(input.query);
  if (q) params.set('q', q);
  if (input.offset) params.set('offset', String(input.offset));
  const timeout = new AbortController();
  const timer = window.setTimeout(() => timeout.abort(), TIMEOUT_MS);
  const onAbort = () => timeout.abort();
  input.signal?.addEventListener('abort', onAbort);
  try {
    const token = await user.getIdToken();
    const response = await fetch(`/api/signals?${params}`, { headers: { Authorization: `Bearer ${token}` }, signal: timeout.signal });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) return { ok: false, problem: gifProblemFor(response.status, data.error) };
    const page = parseGifPage(data);
    return page ? { ok: true, page } : { ok: false, problem: 'failed' };
  } catch (error) {
    if (input.signal?.aborted) throw error;
    return { ok: false, problem: error instanceof TypeError ? 'offline' : 'failed' };
  } finally {
    window.clearTimeout(timer);
    input.signal?.removeEventListener('abort', onAbort);
  }
}

import { auth } from '../lib/firebase.ts';
import { VIBE_CACHE_MS, isLive, parseVibe, tidyMessage, type VibeView, type VibeVisibility } from '../utils/currentVibe.ts';

/**
 * Current Vibe, through the Signals API (api/_vibe.js). Nothing is read from or written to Firestore here: the status lives in a
 * server-only collection, and the server decides who may see it and whether it has expired. Statuses of other members are
 * remembered for a minute, so opening a few chats or profiles does not ask again each time; a cached one is dropped the moment
 * its expiry passes.
 */

const REQUEST_TIMEOUT_MS = 15_000;
const cache = new Map<string, { at: number; vibe: VibeView | null }>();
const inFlight = new Map<string, Promise<VibeView | null>>();

export function clearVibeCache(memberId?: string): void {
  if (memberId) cache.delete(memberId);
  else cache.clear();
}

async function request(path: string, body?: Record<string, unknown>): Promise<Response | null> {
  const user = auth?.currentUser;
  if (!user) return null;
  const token = await user.getIdToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export type VibeOutcome = { ok: true; vibe: VibeView | null } | { ok: false; reason: 'invalid' | 'not-allowed' | 'rate-limited' | 'failed' };

const failure = (status: number): VibeOutcome => ({
  ok: false,
  reason: status === 400 ? 'invalid' : status === 403 ? 'not-allowed' : status === 429 ? 'rate-limited' : 'failed',
});

/** Words for a failed publish or removal. */
export function vibeProblemText(reason: Extract<VibeOutcome, { ok: false }>['reason']): string {
  switch (reason) {
    case 'invalid': return 'That status couldn’t be saved. Check the emoji and message and try again.';
    case 'not-allowed': return 'You can’t set a Current Vibe right now.';
    case 'rate-limited': return 'You’re updating very quickly. Please wait a little and try again.';
    default: return 'Couldn’t save that. Please try again.';
  }
}

/** Publishes (or replaces) the member's Current Vibe. The server stamps the times and sets the 24-hour expiry. */
export async function publishCurrentVibe(input: { emoji: string; message: string; visibility: VibeVisibility }): Promise<VibeOutcome> {
  try {
    const message = tidyMessage(input.message);
    const response = await request('/api/signals', { action: 'vibe-set', ...(input.emoji ? { emoji: input.emoji } : {}), ...(message ? { message } : {}), visibility: input.visibility });
    if (!response) return { ok: false, reason: 'failed' };
    if (!response.ok) return failure(response.status);
    const data = await response.json().catch(() => null);
    const vibe = parseVibe(data?.vibe);
    if (!vibe) return { ok: false, reason: 'failed' };
    clearVibeCache();
    return { ok: true, vibe };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Removes the member's Current Vibe before it expires. */
export async function removeCurrentVibe(): Promise<VibeOutcome> {
  try {
    const response = await request('/api/signals', { action: 'vibe-clear' });
    if (!response) return { ok: false, reason: 'failed' };
    if (!response.ok) return failure(response.status);
    clearVibeCache();
    return { ok: true, vibe: null };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** A member's live Current Vibe as this viewer may see it, or null. Never throws: a failed lookup shows no status. */
export function fetchMemberVibe(memberId: string, now: number = Date.now()): Promise<VibeView | null> {
  const hit = cache.get(memberId);
  if (hit && now - hit.at < VIBE_CACHE_MS) return Promise.resolve(isLive(hit.vibe, now) ? hit.vibe : null);
  const pending = inFlight.get(memberId);
  if (pending) return pending;
  const load = (async (): Promise<VibeView | null> => {
    try {
      const response = await request(`/api/signals?view=vibe&memberId=${encodeURIComponent(memberId)}`);
      if (!response || !response.ok) return null;
      const data = await response.json().catch(() => null);
      const vibe = parseVibe(data?.vibe);
      const live = isLive(vibe) ? vibe : null;
      cache.set(memberId, { at: Date.now(), vibe: live });
      return live;
    } catch {
      return null;
    } finally {
      inFlight.delete(memberId);
    }
  })();
  inFlight.set(memberId, load);
  return load;
}

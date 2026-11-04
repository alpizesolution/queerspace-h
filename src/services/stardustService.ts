import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase.ts';

/**
 * Stardust is the one appreciation system for Cosmos posts, Community and Looking For alike. Every give and remove goes
 * through /api/stardust (api/stardust.js), which alone writes reactions and counters. This file is the thin client for it;
 * the counts themselves arrive with the posts, so showing them costs no extra read.
 */

export type StardustPostType = 'community' | 'lookingFor';

export type StardustResult = { ok: true; given: boolean; count: number } | { ok: false; message: string };

/** Plain-language text for each answer the API can give. Never says who blocked whom. */
export function stardustErrorMessage(code?: string): string {
  switch (code) {
    case 'rate_limited': return 'You’re going a little fast. Try again in a moment.';
    case 'post_unavailable': return 'That post is no longer available.';
    case 'own_post': return 'You can’t give Stardust to your own post.';
    case 'not_allowed': return 'Finish setting up your profile to give Stardust.';
    case 'account_unavailable': return 'Your account can’t give Stardust right now.';
    case 'unauthenticated': return 'Sign in to give Stardust.';
    default: return 'Couldn’t update Stardust. Please try again.';
  }
}

async function call<T>(body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    const user = auth?.currentUser;
    if (!user) return { ok: false, message: stardustErrorMessage('unauthenticated') };
    const token = await user.getIdToken();
    const response = await fetch('/api/stardust', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, message: stardustErrorMessage((data as { error?: string }).error) };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, message: 'No connection. Please try again.' };
  }
}

/** Gives (`give` true) or removes (false) the member's Stardust. Repeating the same request never changes the count twice. */
export async function setStardust(postType: StardustPostType, postId: string, give: boolean): Promise<StardustResult> {
  const result = await call<{ given: boolean; count: number }>({ action: give ? 'give' : 'remove', postType, postId });
  if (!result.ok) return result;
  const { given, count } = result.data;
  return { ok: true, given: given === true, count: Number.isFinite(count) ? Math.max(0, count) : 0 };
}

/** Which of these posts the member has given Stardust to, in one request. Null when it could not be read. */
export async function fetchGivenStardust(postType: StardustPostType, postIds: string[]): Promise<string[] | null> {
  if (!postIds.length) return [];
  const result = await call<{ given?: unknown }>({ action: 'state', postType, postIds });
  if (!result.ok) return null;
  return Array.isArray(result.data.given) ? result.data.given.filter((id): id is string => typeof id === 'string') : [];
}

/** A member's single Stardust total across Community and Looking For (one small server-kept document), or null if unavailable. */
export async function fetchStardustTotal(memberId: string): Promise<number | null> {
  if (!db) return null;
  try {
    const snap = await getDoc(doc(db, 'stardust_totals', memberId));
    const total = snap.exists() ? Number(snap.data().total) : 0;
    return Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  } catch {
    return null;
  }
}

/** The most posts one state request may ask about; matches the API. */
export const MAX_STATE_IDS = 60;

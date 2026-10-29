import { doc, increment, serverTimestamp, writeBatch } from 'firebase/firestore';
import { auth, db, ensureAnonymousAuth } from '../lib/firebase.ts';

export type ViewedCollection = 'unsaid' | 'community_posts';

const SEEN_KEY = 'queerspace_viewed_posts';
const SEEN_MAX = 600;

function readSeen(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const seenKey = (collectionName: ViewedCollection, postId: string) => `${collectionName}/${postId}`;

/** True once this device has counted the post, so a scroll back never writes again. */
export function hasViewedPost(collectionName: ViewedCollection, postId: string): boolean {
  return readSeen().includes(seenKey(collectionName, postId));
}

function markViewed(collectionName: ViewedCollection, postId: string) {
  try {
    const next = [...readSeen().filter((x) => x !== seenKey(collectionName, postId)), seenKey(collectionName, postId)];
    localStorage.setItem(SEEN_KEY, JSON.stringify(next.slice(-SEEN_MAX)));
  } catch {
    // Private mode: the rules still allow only one view per member.
  }
}

/**
 * Counts one view for this member: +1 on the post and a views/{uid} marker in the same batch.
 * The rules accept it once per member per post, so a repeat (another device, cleared storage) is
 * refused and harmless.
 */
export async function recordPostView(collectionName: ViewedCollection, postId: string): Promise<boolean> {
  if (!db || hasViewedPost(collectionName, postId)) return false;
  markViewed(collectionName, postId);
  try {
    const user = auth?.currentUser ?? (await ensureAnonymousAuth());
    if (!user) return false;
    const batch = writeBatch(db);
    batch.update(doc(db, collectionName, postId), { views: increment(1) });
    batch.set(doc(db, collectionName, postId, 'views', user.uid), { createdAt: serverTimestamp() });
    await batch.commit();
    return true;
  } catch {
    return false;
  }
}

export function formatViewCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 10000) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(count / 1000)}k`;
}

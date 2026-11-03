import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  FirestoreError,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, ensureAnonymousAuth, isFirebaseConfigured } from '../lib/firebase.ts';
import type { UserPreferences } from '../types.ts';
import { isValidAvatar } from '../utils/avatar.ts';
import { calculateAge } from '../utils/ageEligibility.ts';
import { feedErrorReason, isIntention, LIMITS, lookingForPostId, draftToDocument, type LookingForDraft, type LookingForIntention, type LookingForPost } from '../utils/lookingFor.ts';

/**
 * The Cosmos "Looking For" board, shared through Firestore `looking_for_posts`. Reading and writing is limited to adult
 * members with a saved profile by firestore.rules; contacting an author goes through the Signals API.
 */

export const LOOKING_FOR_HISTORY = 60;
/** Seconds between new posts; must match slowMode('lookingForPost', ...) in firestore.rules. */
export const LOOKING_FOR_SLOW_MODE_SECONDS = 60;

export const isLookingForAvailable = () => isFirebaseConfigured && Boolean(db);

const millis = (value: unknown): number | undefined =>
  value && typeof (value as Timestamp).toMillis === 'function' ? (value as Timestamp).toMillis() : undefined;

const age = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= LIMITS.minAge && value <= LIMITS.maxAge ? value : undefined;

/** Turns a stored document into a post, ignoring anything malformed. Unknown fields are dropped, never shown. */
export function toLookingForPost(id: string, data: Record<string, unknown>): LookingForPost | null {
  if (!isIntention(data.intention)) return null;
  return {
    id,
    authorId: String(data.authorId ?? ''),
    author: String(data.authorName ?? 'Sapphic Guest').slice(0, 30),
    authorPronouns: String(data.authorPronouns ?? '').slice(0, 20),
    authorAvatar: isValidAvatar(data.authorAvatar) ? data.authorAvatar : undefined,
    title: String(data.title ?? '').slice(0, LIMITS.title),
    intro: String(data.intro ?? '').slice(0, LIMITS.intro),
    lookingFor: String(data.lookingFor ?? '').slice(0, LIMITS.lookingFor),
    intention: data.intention,
    age: age(data.age),
    seekAgeMin: age(data.seekAgeMin),
    seekAgeMax: age(data.seekAgeMax),
    region: typeof data.region === 'string' && data.region ? data.region.slice(0, LIMITS.region) : undefined,
    tags: Array.isArray(data.tags) ? data.tags.map(String).slice(0, LIMITS.tags) : [],
    isNsfw: data.isNsfw === true,
    requestsPaused: data.requestsPaused === true,
    contentWarning: data.isNsfw === true && typeof data.contentWarning === 'string' && data.contentWarning ? data.contentWarning.slice(0, LIMITS.contentWarning) : null,
    timestamp: millis(data.timestamp) ?? Date.now(),
    updatedAt: millis(data.updatedAt),
  };
}

async function currentUid(): Promise<string | null> {
  const user = auth?.currentUser ?? (await ensureAnonymousAuth());
  return user?.uid ?? null;
}

/** The member's own age from the birthday saved on this device, or null. Only shown on a post if they choose to. */
export const ownAgeFrom = (prefs: UserPreferences): number | null => (prefs.birthDate ? calculateAge(prefs.birthDate) : null);

/** Live board, newest first. A category asks the server for just that intention (see firestore.indexes.json). */
export function subscribeToLookingFor(
  category: 'all' | LookingForIntention,
  onPosts: (posts: LookingForPost[], uid: string) => void,
  onError: (reason: 'denied' | 'failed') => void
): () => void {
  if (!db) {
    onError('failed');
    return () => {};
  }
  const firestore = db;
  let unsubscribe: (() => void) | null = null;
  let cancelled = false;
  currentUid().then((uid) => {
    if (cancelled) return;
    if (!uid) {
      onError('failed');
      return;
    }
    const base = collection(firestore, 'looking_for_posts');
    const q =
      category === 'all'
        ? query(base, orderBy('timestamp', 'desc'), limit(LOOKING_FOR_HISTORY))
        : query(base, where('intention', '==', category), orderBy('timestamp', 'desc'), limit(LOOKING_FOR_HISTORY));
    unsubscribe = onSnapshot(
      q,
      (snap) => onPosts(snap.docs.flatMap((d) => { const post = toLookingForPost(d.id, d.data()); return post ? [post] : []; }), uid),
      (err) => {
        console.warn('[LookingFor] Feed notice:', err);
        onError(feedErrorReason(err));
      }
    );
  });
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}

export type LookingForWriteResult = 'ok' | 'denied' | 'failed';

/** Optional fields that the draft turned off must be removed from an existing post, not just left out. */
const OPTIONAL_FIELDS = ['authorAvatar', 'age', 'seekAgeMin', 'seekAgeMax', 'region'] as const; // requestsPaused is kept as it is when a post is edited

/**
 * Posts, or edits the member's existing post for that intention (one per intention). The rules re-check eligibility,
 * the age shown, the 60-second pace and every field, so a refused write is reported as "denied".
 */
export async function saveLookingForPost(prefs: UserPreferences, draft: LookingForDraft): Promise<LookingForWriteResult> {
  if (!db || !isIntention(draft.intention)) return 'failed';
  try {
    const uid = await currentUid();
    if (!uid) return 'failed';
    const fields = draftToDocument(
      draft,
      { uid, name: prefs.displayName ?? '', pronouns: prefs.pronouns ?? '', avatar: isValidAvatar(prefs.avatar) ? prefs.avatar : undefined },
      ownAgeFrom(prefs)
    );
    const ref = doc(db, 'looking_for_posts', lookingForPostId(uid, draft.intention));
    if ((await getDoc(ref)).exists()) {
      const removed = Object.fromEntries(OPTIONAL_FIELDS.filter((key) => !(key in fields)).map((key) => [key, deleteField()]));
      await updateDoc(ref, { ...fields, ...removed, updatedAt: serverTimestamp() });
    } else {
      const batch = writeBatch(db);
      batch.set(ref, { ...fields, timestamp: serverTimestamp() });
      batch.set(doc(db, 'rate_limits', uid), { lookingForPost: serverTimestamp() }, { merge: true });
      await batch.commit();
    }
    return 'ok';
  } catch (err) {
    console.warn('[LookingFor] Could not save:', err);
    return (err as FirestoreError)?.code === 'permission-denied' ? 'denied' : 'failed';
  }
}

export async function deleteLookingForPost(postId: string): Promise<boolean> {
  if (!db) return false;
  try {
    await deleteDoc(doc(db, 'looking_for_posts', postId));
    return true;
  } catch (err) {
    console.warn('[LookingFor] Could not delete:', err);
    return false;
  }
}

export const REPORT_REASONS = [
  'Sexually explicit or non-consensual content',
  'Harassment, hate or threats',
  'Underage or unsafe',
  'Spam, scam or solicitation',
  'Something else',
] as const;

/** Files a report in the shared `reports` collection; admins see it in the Reports tab as target "looking_for:{postId}". */
export async function reportLookingForPost(postId: string, reason: string): Promise<boolean> {
  if (!db) return false;
  try {
    const uid = await currentUid();
    if (!uid) return false;
    await addDoc(collection(db, 'reports'), {
      reporterId: uid,
      targetId: `looking_for:${postId}`,
      targetType: 'post',
      reason: reason.trim().slice(0, 300) || 'Something else',
      timestamp: serverTimestamp(),
    });
    return true;
  } catch (err) {
    console.warn('[LookingFor] Could not report:', err);
    return false;
  }
}

/** Pauses or resumes new connection requests on the member's own post. The rules let only the author change it. */
export async function setRequestsPaused(postId: string, paused: boolean): Promise<boolean> {
  if (!db) return false;
  try {
    await updateDoc(doc(db, 'looking_for_posts', postId), { requestsPaused: paused, updatedAt: serverTimestamp() });
    return true;
  } catch (err) {
    console.warn('[LookingFor] Could not change requests:', err);
    return false;
  }
}

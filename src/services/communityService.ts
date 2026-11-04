import {
  collection,
  deleteDoc,
  doc,
  FirestoreError,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  Query,
  QueryDocumentSnapshot,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, ensureAnonymousAuth, isFirebaseConfigured } from '../lib/firebase.ts';
import { CommunityPost, CommunityReply, UserPreferences } from '../types.ts';
import { isValidAvatar } from '../utils/avatar.ts';
import { checkAdmin } from './adminService.ts';
import { postLoadFromError, type PostLoad } from '../utils/communityPostLink.ts';

/**
 * Community board shared through Firestore `community_posts`. The reply count lives on the post; firestore.rules only
 * lets it move by one alongside the matching replies/{id} doc. Appreciation is Stardust (stardustService.ts): its count
 * is on the post too, but only /api/stardust can change it.
 */

export const COMMUNITY_HISTORY = 60;
/** Seconds between posts and between replies; must match slowMode(...) in firestore.rules. */
export const COMMUNITY_POST_SLOW_MODE_SECONDS = 30;
export const COMMUNITY_REPLY_SLOW_MODE_SECONDS = 5;
export const COMMUNITY_REPLY_MAX_LENGTH = 500;

const CATEGORIES: CommunityPost['category'][] = ['vents', 'media', 'friends', 'advice', 'general'];

export const isCommunityAvailable = () => isFirebaseConfigured && Boolean(db);

function toMillis(value: unknown): number {
  return value && typeof (value as Timestamp).toMillis === 'function' ? (value as Timestamp).toMillis() : Date.now();
}

export function toCommunityPost(id: string, data: Record<string, unknown>): CommunityPost {
  const category = CATEGORIES.includes(data.category as CommunityPost['category'])
    ? (data.category as CommunityPost['category'])
    : 'general';
  return {
    id,
    authorId: String(data.authorId ?? ''),
    author: String(data.authorName ?? 'Sapphic Guest').slice(0, 30),
    authorPronouns: String(data.authorPronouns ?? '').slice(0, 20),
    authorAvatar: isValidAvatar(data.authorAvatar) ? data.authorAvatar : undefined,
    category,
    title: String(data.title ?? ''),
    content: String(data.content ?? ''),
    timestamp: toMillis(data.timestamp),
    likes: Math.max(0, Number(data.likes) || 0),
    // Posts not yet moved from likes to Stardust (scripts/migrate-stardust.mjs) still show the appreciation they had.
    stardustCount: typeof data.stardustCount === 'number' ? Math.max(0, Math.floor(data.stardustCount)) : Math.max(0, Number(data.likes) || 0),
    replyCount: Math.max(0, Number(data.replyCount) || 0),
    replies: [],
    tags: Array.isArray(data.tags) ? data.tags.map(String).slice(0, 4) : [],
  };
}

export function toCommunityReply(id: string, data: Record<string, unknown>): CommunityReply {
  return {
    id,
    authorId: String(data.authorId ?? ''),
    author: String(data.authorName ?? 'Sapphic Guest').slice(0, 30),
    authorPronouns: String(data.authorPronouns ?? '').slice(0, 20),
    authorAvatar: isValidAvatar(data.authorAvatar) ? data.authorAvatar : undefined,
    content: String(data.content ?? ''),
    timestamp: toMillis(data.timestamp),
  };
}

async function currentUid(): Promise<string | null> {
  const user = auth?.currentUser ?? (await ensureAnonymousAuth());
  return user?.uid ?? null;
}

function authorFields(prefs: UserPreferences, uid: string) {
  return {
    authorId: uid,
    authorName: (prefs.displayName?.trim() || 'Sapphic Guest').slice(0, 30),
    authorPronouns: (prefs.pronouns?.trim() || 'she/her').slice(0, 20),
    ...(isValidAvatar(prefs.avatar) ? { authorAvatar: prefs.avatar } : {}),
  };
}

/** Runs a live query once signed in; returns an unsubscribe that also cancels a pending start. */
function liveQuery(
  build: () => Query,
  onDocs: (docs: QueryDocumentSnapshot[], uid: string) => void,
  onError: () => void,
  label: string
): () => void {
  let unsubscribe: (() => void) | null = null;
  let cancelled = false;
  currentUid().then((uid) => {
    if (cancelled) return;
    if (!uid || !db) {
      onError();
      return;
    }
    unsubscribe = onSnapshot(
      build(),
      (snap) => onDocs(snap.docs, uid),
      (err) => {
        console.warn(`[Community] ${label} notice:`, err);
        onError();
      }
    );
  });
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}

/** Live feed of the newest posts. Also reports the signed-in uid, to spot your own posts. */
export function subscribeToCommunity(
  onPosts: (posts: CommunityPost[], uid: string) => void,
  onError: () => void
): () => void {
  if (!db) {
    onError();
    return () => {};
  }
  const firestore = db;
  return liveQuery(
    () => query(collection(firestore, 'community_posts'), orderBy('timestamp', 'desc'), limit(COMMUNITY_HISTORY)),
    (docs, uid) => onPosts(docs.map((d) => toCommunityPost(d.id, d.data())), uid),
    onError,
    'Feed'
  );
}

/**
 * One post, live, by its id: the original document in `community_posts`, so its likes, replies and author are the real
 * ones and every change to them shows here. A deleted or unreadable post is reported as "unavailable", never recreated.
 */
export function subscribeToCommunityPost(postId: string, onState: (state: PostLoad<CommunityPost>) => void): () => void {
  if (!db) {
    onState({ status: 'failed' });
    return () => {};
  }
  const firestore = db;
  let cancelled = false;
  let unsubscribe: (() => void) | null = null;
  const start = auth?.currentUser ? Promise.resolve(auth.currentUser) : ensureAnonymousAuth();
  start.then((user) => {
    if (cancelled) return;
    if (!user) {
      onState({ status: 'failed' });
      return;
    }
    unsubscribe = onSnapshot(
      doc(firestore, 'community_posts', postId),
      (snap) => onState(snap.exists() ? { status: 'ready', post: toCommunityPost(snap.id, snap.data()) } : { status: 'unavailable' }),
      (err) => {
        console.warn('[Community] Post notice:', err);
        onState(postLoadFromError(err));
      }
    );
  });
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}

/** Live replies for one post, oldest first. */
export function subscribeToReplies(
  postId: string,
  onReplies: (replies: CommunityReply[]) => void,
  onError: () => void
): () => void {
  if (!db) {
    onError();
    return () => {};
  }
  const firestore = db;
  return liveQuery(
    () => query(collection(firestore, 'community_posts', postId, 'replies'), orderBy('timestamp', 'asc'), limit(100)),
    (docs) => onReplies(docs.map((d) => toCommunityReply(d.id, d.data()))),
    onError,
    'Replies'
  );
}

export type CommunityWriteResult = 'ok' | 'too-fast' | 'failed';

function resultFromError(err: unknown, label: string): CommunityWriteResult {
  console.warn(`[Community] Could not ${label}:`, err);
  return (err as FirestoreError)?.code === 'permission-denied' ? 'too-fast' : 'failed';
}

export async function createCommunityPost(
  prefs: UserPreferences,
  post: { title: string; content: string; category: CommunityPost['category']; tags: string[] }
): Promise<CommunityWriteResult> {
  if (!db) return 'failed';
  try {
    const uid = await currentUid();
    if (!uid) return 'failed';
    const batch = writeBatch(db);
    batch.set(doc(collection(db, 'community_posts')), {
      ...authorFields(prefs, uid),
      title: post.title.slice(0, 90),
      content: post.content.slice(0, 1000),
      category: post.category,
      tags: post.tags.slice(0, 4).map((t) => t.slice(0, 15)),
      likes: 0,
      replyCount: 0,
      timestamp: serverTimestamp(),
    });
    batch.set(doc(db, 'rate_limits', uid), { communityPost: serverTimestamp() }, { merge: true });
    await batch.commit();
    return 'ok';
  } catch (err) {
    return resultFromError(err, 'post');
  }
}

export async function replyToCommunityPost(
  prefs: UserPreferences,
  postId: string,
  content: string
): Promise<CommunityWriteResult> {
  if (!db) return 'failed';
  try {
    const uid = await currentUid();
    if (!uid) return 'failed';
    const batch = writeBatch(db);
    batch.set(doc(collection(db, 'community_posts', postId, 'replies')), {
      ...authorFields(prefs, uid),
      content: content.slice(0, COMMUNITY_REPLY_MAX_LENGTH),
      timestamp: serverTimestamp(),
    });
    batch.update(doc(db, 'community_posts', postId), { replyCount: increment(1) });
    batch.set(doc(db, 'rate_limits', uid), { communityReply: serverTimestamp() }, { merge: true });
    await batch.commit();
    return 'ok';
  } catch (err) {
    return resultFromError(err, 'reply');
  }
}

export async function deleteCommunityPost(postId: string): Promise<boolean> {
  if (!db) return false;
  try {
    await deleteDoc(doc(db, 'community_posts', postId));
    return true;
  } catch (err) {
    console.warn('[Community] Could not delete:', err);
    return false;
  }
}

/**
 * Whether this session is a moderator. Only decides whether to show the controls: it reads
 * admins/{uid}, which only the Firebase Console can write, and firestore.rules re-check
 * every admin delete on the server.
 */
export async function fetchIsCommunityAdmin(): Promise<boolean> {
  try {
    const user = auth?.currentUser ?? (await ensureAnonymousAuth());
    return (await checkAdmin(user)) === 'admin';
  } catch {
    return false;
  }
}

/**
 * Admin removal of a reply. The rules require the post's replyCount to drop by one in the
 * same batch, so the two writes succeed or fail together.
 */
export async function adminDeleteCommunityReply(postId: string, replyId: string): Promise<boolean> {
  if (!db) return false;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'community_posts', postId, 'replies', replyId));
    batch.update(doc(db, 'community_posts', postId), { replyCount: increment(-1) });
    await batch.commit();
    return true;
  } catch (err) {
    console.warn('[Community] Admin could not delete reply:', err);
    return false;
  }
}

/**
 * Admin removal of any post. Replies go first (one by one, each with its counter) so none are
 * left orphaned; if any step fails the post is kept and the admin can retry. Likes markers
 * and Stardust reactions are cleared afterwards, best-effort: they're invisible without the post (the author's total drops
 * at the next reconcile, see docs/stardust.md).
 */
export async function adminDeleteCommunityPost(postId: string): Promise<boolean> {
  if (!db) return false;
  try {
    const replies = collection(db, 'community_posts', postId, 'replies');
    for (let round = 0; round < 20; round++) {
      const snap = await getDocs(query(replies, limit(50)));
      if (snap.empty) break;
      for (const reply of snap.docs) {
        if (!(await adminDeleteCommunityReply(postId, reply.id))) return false;
      }
    }
    await deleteDoc(doc(db, 'community_posts', postId));
  } catch (err) {
    console.warn('[Community] Admin could not delete post:', err);
    return false;
  }
  try {
    for (const sub of ['likes', 'stardust']) {
      const left = await getDocs(collection(db, 'community_posts', postId, sub));
      await Promise.all(left.docs.map((d) => deleteDoc(d.ref)));
    }
  } catch {
    // Leftover like markers are harmless; the post itself is gone.
  }
  return true;
}

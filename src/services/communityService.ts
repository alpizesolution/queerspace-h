import {
  collection,
  deleteDoc,
  doc,
  FirestoreError,
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

/**
 * Community board shared through Firestore `community_posts`. Like and reply counts
 * live on the post; firestore.rules only lets them move by one alongside the
 * matching likes/{uid} or replies/{id} doc.
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

/** Likes (or unlikes) a post. Returns false if the server refused, e.g. it was already liked. */
export async function setCommunityLike(postId: string, liked: boolean): Promise<boolean> {
  if (!db) return false;
  try {
    const uid = await currentUid();
    if (!uid) return false;
    const batch = writeBatch(db);
    batch.update(doc(db, 'community_posts', postId), { likes: increment(liked ? 1 : -1) });
    const marker = doc(db, 'community_posts', postId, 'likes', uid);
    if (liked) batch.set(marker, { createdAt: serverTimestamp() });
    else batch.delete(marker);
    await batch.commit();
    return true;
  } catch {
    return false;
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

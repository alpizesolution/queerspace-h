import {
  collection,
  doc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
  getDocs,
  addDoc,
  documentId,
  updateDoc,
} from 'firebase/firestore';
import { auth, db, ensureAnonymousAuth, isFirebaseConfigured } from '../lib/firebase.ts';
import { sanitizeMessageText } from '../utils/matching-logic.ts';

/**
 * Echoes (the Unsaid wall): anonymous posts that stay visible until the author deletes them or moderation removes them.
 * Older posts still carry the `expiresAt` they were written with (a 48-hour lifetime), but it is ignored: nothing expires.
 *
 * `unsaid/{id}` holds only text, timestamps and counters. Authorship lives in
 * `unsaid_owners/{id}`, which only the author can read, so posts can't be traced
 * back to a profile. Reactions and flags are one per person, enforced by rules.
 */

export const UNSAID_MAX_LENGTH = 500;
/** Echoes in the live first page, and in each "older" page. */
export const UNSAID_FIRST_PAGE = 60;
export const UNSAID_PAGE_SIZE = 30;
/** Posts with this many flags are hidden for everyone until reviewed. */
export const UNSAID_HIDE_AT_FLAGS = 3;
/** Why someone can report an Echo or a reply. */
export const UNSAID_REPORT_REASONS = ['Harassment or hate', 'Names or exposes someone', 'Spam or selling', 'Something else'] as const;

/** Reaction counters on a post; must match the list in firestore.rules. */
export const UNSAID_REACTIONS = ['hugs', 'same', 'felt', 'strong', 'proud', 'cry'] as const;
export type UnsaidReaction = (typeof UNSAID_REACTIONS)[number];

// The eight categories (three groups) and which take replies live in utils/echoKinds.ts; re-exported here so existing imports work.
export { UNSAID_KINDS, UNSAID_REPLY_KINDS, UNSAID_REPLY_MAX_LENGTH, UNSAID_REPLY_SLOW_MODE_SECONDS, kindAllowsReplies, toUnsaidKind, type UnsaidKind } from '../utils/echoKinds.ts';
import { UNSAID_REPLY_MAX_LENGTH, kindAllowsReplies, toUnsaidKind, unseenReplies, type UnsaidKind } from '../utils/echoKinds.ts';
import { toMoodTags, type MoodId } from '../utils/echoMoods.ts';

export interface UnsaidPost {
  id: string;
  kind: UnsaidKind;
  text: string;
  createdAt: number;
  /** Replies, for the categories that take them (Need Advice and Uplift); 0 for everything else, including older posts. */
  replyCount: number;
  /** Optional mood tags (0 to 2); empty for older Echoes and for any Echo posted without one. */
  moodTags: MoodId[];
  /** Only on Echoes posted before they became permanent; null means the Echo stays until deleted or removed. */
  expiresAt: number | null;
  hugs: number;
  same: number;
  felt: number;
  strong: number;
  proud: number;
  cry: number;
  flags: number;
}

// Links, @handles and phone numbers would break anonymity (and invite spam).
const IDENTIFYING_PATTERNS = [
  /https?:\/\/|www\.|\.(com|net|org|ph|me|ly)\b/i,
  /(^|\s)@[a-z0-9_.]{2,}/i,
  /(\+?\d[\s-]?){9,}/,
];

const CRISIS_PATTERNS = [
  /suicid/i,
  /kill(ing)? my ?self/i,
  /end (it all|my life)/i,
  /(want|wanna) to die/i,
  /don'?t want to (live|be alive|exist)/i,
  /self[- ]?harm/i,
  /(cut|cutting|hurt|hurting) my ?self/i,
  /magpakamatay/i,
  /mamatay na lang/i,
  /ayoko na(ng)? mabuhay/i,
];

type TextCheck = { ok: true; text: string } | { ok: false; error: string };

/** The anonymity and guideline checks every Echo text goes through, whatever its length limit. */
function checkAnonymousText(text: string, max: number, empty: string, blocked: string): TextCheck {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: empty };
  if (trimmed.length > max) return { ok: false, error: `Keep it under ${max} characters.` };
  if (IDENTIFYING_PATTERNS.some((p) => p.test(trimmed))) {
    return { ok: false, error: 'Keep it anonymous: no links, handles or numbers.' };
  }
  const { isBlocked } = sanitizeMessageText(trimmed);
  if (isBlocked) return { ok: false, error: blocked };
  return { ok: true, text: trimmed };
}

export function validateUnsaidText(text: string): TextCheck {
  return checkAnonymousText(text, UNSAID_MAX_LENGTH, 'Write something first.', "This goes against our guidelines, so it can't be posted.");
}

/** A reply: the same anonymity rules as a post, in a shorter box. */
export function validateUnsaidReplyText(text: string): TextCheck {
  return checkAnonymousText(text, UNSAID_REPLY_MAX_LENGTH, 'Write a reply first.', "This goes against our guidelines, so it can't be sent.");
}

/** True when the text suggests the writer may be in crisis. */
export function needsCrisisSupport(text: string): boolean {
  return CRISIS_PATTERNS.some((p) => p.test(text));
}

/** Visible unless heavily flagged. An old post's `expiresAt` is ignored: Echoes no longer expire. */
export function isUnsaidVisible(post: UnsaidPost, _now: number = Date.now()): boolean {
  return post.flags < UNSAID_HIDE_AT_FLAGS;
}

/** Newest first, without duplicates (a post can arrive from both the live feed and an older page). */
export function mergeUnsaidPages(...pages: UnsaidPost[][]): UnsaidPost[] {
  const byId = new Map<string, UnsaidPost>();
  for (const post of pages.flat()) if (!byId.has(post.id)) byId.set(post.id, post);
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/** "just now", "12m ago", "2h ago", "5 days ago", "3 months ago". */
export function formatPostedAgo(createdAt: number, now: number = Date.now()): string {
  const mins = Math.floor(Math.max(0, now - createdAt) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  const months = Math.floor(days / 30);
  return `${months} ${months === 1 ? 'month' : 'months'} ago`;
}

function toMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof (value as Timestamp).toMillis === 'function') return (value as Timestamp).toMillis();
  return Date.now();
}

function toMillisOrNull(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof (value as Timestamp).toMillis === 'function') return (value as Timestamp).toMillis();
  return null;
}

/** Public shape of an Echo: text, kind, timestamps and counters only. No author, no owner id. */
export function toUnsaidPost(id: string, data: Record<string, unknown>): UnsaidPost {
  return {
    id,
    kind: toUnsaidKind(data.kind),
    text: String(data.text ?? ''),
    createdAt: toMillis(data.createdAt),
    replyCount: Math.max(0, Math.floor(Number(data.replyCount) || 0)),
    moodTags: toMoodTags(data.moodTags),
    expiresAt: toMillisOrNull(data.expiresAt),
    hugs: Number(data.hugs) || 0,
    same: Number(data.same) || 0,
    felt: Number(data.felt) || 0,
    strong: Number(data.strong) || 0,
    proud: Number(data.proud) || 0,
    cry: Number(data.cry) || 0,
    flags: Number(data.flags) || 0,
  };
}

export const isUnsaidAvailable = () => isFirebaseConfigured && Boolean(db);

async function currentUid(): Promise<string | null> {
  const user = auth?.currentUser ?? (await ensureAnonymousAuth());
  return user?.uid ?? null;
}

/** Where the next, older page starts; null when the live page already reached the end. */
export interface UnsaidFeedMeta {
  nextBefore: number | null;
}

/** Live first page of Echoes (newest first). Older pages come from loadOlderUnsaid. */
export function subscribeToUnsaid(
  onPosts: (posts: UnsaidPost[], meta: UnsaidFeedMeta) => void,
  onError: () => void
): () => void {
  if (!db) {
    onError();
    return () => {};
  }
  const firestore = db;
  let unsubscribe: (() => void) | null = null;
  let cancelled = false;

  currentUid().then((uid) => {
    if (cancelled) return;
    if (!uid) {
      onError();
      return;
    }
    unsubscribe = onSnapshot(
      query(
        collection(firestore, 'unsaid'),
        orderBy('createdAt', 'desc'),
        limit(UNSAID_FIRST_PAGE)
      ),
      (snap) => {
        const now = Date.now();
        const all = snap.docs.map((d) => toUnsaidPost(d.id, d.data()));
        onPosts(
          all.filter((p) => isUnsaidVisible(p, now)),
          { nextBefore: snap.size >= UNSAID_FIRST_PAGE ? all[all.length - 1].createdAt : null }
        );
      },
      (err) => {
        console.warn('[Unsaid] Feed notice:', err);
        onError();
      }
    );
  });

  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}

/** The next page of older Echoes, newest first, starting just before `before` (a createdAt in ms). */
export async function loadOlderUnsaid(before: number): Promise<{ posts: UnsaidPost[]; nextBefore: number | null } | null> {
  if (!db) return null;
  try {
    const uid = await currentUid();
    if (!uid) return null;
    const snap = await getDocs(
      query(
        collection(db, 'unsaid'),
        where('createdAt', '<', Timestamp.fromMillis(before)),
        orderBy('createdAt', 'desc'),
        limit(UNSAID_PAGE_SIZE)
      )
    );
    const all = snap.docs.map((d) => toUnsaidPost(d.id, d.data()));
    const now = Date.now();
    return {
      posts: all.filter((p) => isUnsaidVisible(p, now)),
      nextBefore: snap.size >= UNSAID_PAGE_SIZE ? all[all.length - 1].createdAt : null,
    };
  } catch (err) {
    console.warn('[Unsaid] Could not load older Echoes:', err);
    return null;
  }
}

/** Seconds between Unsaid posts; must match slowMode('unsaid', …) in firestore.rules. */
export const UNSAID_SLOW_MODE_SECONDS = 60;

export async function postUnsaid(kind: UnsaidKind, text: string, moodTags: readonly string[] = []): Promise<'posted' | 'too-fast' | 'failed'> {
  const checked = validateUnsaidText(text);
  if (!checked.ok || !db) return 'failed';
  try {
    const uid = await currentUid();
    if (!uid) return 'failed';
    const postRef = doc(collection(db, 'unsaid'));
    const batch = writeBatch(db);
    const takesReplies = kindAllowsReplies(kind);
    const moods = toMoodTags(moodTags);
    batch.set(postRef, {
      kind,
      text: checked.text,
      createdAt: serverTimestamp(),
      hugs: 0,
      same: 0,
      flags: 0,
      // Only the categories that take replies carry a reply counter; everything else is exactly what it always was.
      ...(takesReplies ? { replyCount: 0 } : {}),
      // Optional mood tags: only written when chosen, so Echoes without a mood are exactly what they were.
      ...(moods.length ? { moodTags: moods } : {}),
    });
    // Ownership stays private (only the author can read it). For a category with replies it also remembers the kind and how many
    // replies the author has already seen, which is how they are told about new ones without anyone learning who they are.
    batch.set(doc(db, 'unsaid_owners', postRef.id), takesReplies ? { authorId: uid, kind, seenReplies: 0 } : { authorId: uid });
    batch.set(doc(db, 'rate_limits', uid), { unsaid: serverTimestamp() }, { merge: true });
    await batch.commit();
    return 'posted';
  } catch (err) {
    console.warn('[Unsaid] Could not post:', err);
    return (err as { code?: string })?.code === 'permission-denied' ? 'too-fast' : 'failed';
  }
}

/** IDs of the current user's own posts (so they can delete them). */
export async function loadMyUnsaidIds(): Promise<string[]> {
  if (!db) return [];
  try {
    const uid = await currentUid();
    if (!uid) return [];
    const snap = await getDocs(query(collection(db, 'unsaid_owners'), where('authorId', '==', uid)));
    return snap.docs.map((d) => d.id);
  } catch {
    return [];
  }
}

export async function reactToUnsaid(postId: string, type: UnsaidReaction): Promise<boolean> {
  if (!db) return false;
  try {
    const uid = await currentUid();
    if (!uid) return false;
    const batch = writeBatch(db);
    batch.update(doc(db, 'unsaid', postId), { [type]: increment(1) });
    batch.set(doc(db, 'unsaid', postId, 'reactions', uid), { type, createdAt: serverTimestamp() });
    await batch.commit();
    return true;
  } catch {
    // Already reacted (rules allow one per person) or offline.
    return false;
  }
}

/** Flags a post (hidden at 3 flags) and files a report for moderators. */
export async function flagUnsaid(postId: string, reason: string): Promise<boolean> {
  if (!db) return false;
  try {
    const uid = await currentUid();
    if (!uid) return false;
    const batch = writeBatch(db);
    batch.update(doc(db, 'unsaid', postId), { flags: increment(1) });
    batch.set(doc(db, 'unsaid', postId, 'flags', uid), { createdAt: serverTimestamp() });
    await batch.commit();
    addDoc(collection(db, 'reports'), {
      reporterId: uid,
      targetId: postId,
      targetType: 'post',
      reason: `Unsaid: ${reason}`.slice(0, 300),
      timestamp: serverTimestamp(),
    }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export async function deleteUnsaid(postId: string): Promise<boolean> {
  if (!db) return false;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'unsaid', postId));
    batch.delete(doc(db, 'unsaid_owners', postId));
    await batch.commit();
    return true;
  } catch (err) {
    console.warn('[Unsaid] Could not delete:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------- replies
//
// Need Advice, Little Wins, Gratitude and Daydreams take replies; Confession, Vent, Unsent Letters and Random Thoughts do not
// (utils/echoKinds.ts, and firestore.rules refuses a reply to anything else). Like posts, replies are anonymous: the public
// document is just text and a time, and who wrote it lives in `unsaid_reply_owners/{replyId}`, which only that member (and no
// one else, not even the post's author) can read.

/** The public shape of a reply. No author, no owner id. */
export interface UnsaidReply {
  id: string;
  text: string;
  createdAt: number;
}

export function toUnsaidReply(id: string, data: Record<string, unknown>): UnsaidReply {
  return { id, text: String(data.text ?? ''), createdAt: toMillis(data.createdAt) };
}

/** Live replies for one post, oldest first, so a thread reads top to bottom. */
export function subscribeToUnsaidReplies(
  postId: string,
  onReplies: (replies: UnsaidReply[]) => void,
  onError: () => void
): () => void {
  if (!db) {
    onError();
    return () => {};
  }
  const firestore = db;
  let unsubscribe: (() => void) | null = null;
  let cancelled = false;
  currentUid().then((uid) => {
    if (cancelled) return;
    if (!uid) {
      onError();
      return;
    }
    unsubscribe = onSnapshot(
      query(collection(firestore, 'unsaid', postId, 'replies'), orderBy('createdAt', 'asc'), limit(UNSAID_REPLIES_SHOWN)),
      (snap) => onReplies(snap.docs.map((d) => toUnsaidReply(d.id, d.data()))),
      (err) => {
        console.warn('[Unsaid] Replies notice:', err);
        onError();
      }
    );
  });
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}

/** The most replies one thread shows. */
export const UNSAID_REPLIES_SHOWN = 100;

/** Which replies on this post are the current member's own (so only they see a delete control on them). */
export async function loadMyReplyIds(postId: string): Promise<string[]> {
  if (!db) return [];
  try {
    const uid = await currentUid();
    if (!uid) return [];
    const snap = await getDocs(query(collection(db, 'unsaid_reply_owners'), where('authorId', '==', uid), where('postId', '==', postId)));
    return snap.docs.map((d) => d.id);
  } catch {
    return [];
  }
}

export type UnsaidReplyResult = { ok: true; id: string } | { ok: false; reason: 'not-allowed' | 'too-fast' | 'invalid' | 'failed' };

/**
 * Sends a reply. One batch: the reply, its private owner record, the post's counter (+1, with the reply's id so the rules can
 * check the two belong together) and the member's slow-mode stamp. A category that does not take replies is refused here
 * and, if anyone tried anyway, by firestore.rules.
 */
export async function replyToUnsaid(post: { id: string; kind: UnsaidKind }, text: string): Promise<UnsaidReplyResult> {
  if (!kindAllowsReplies(post.kind)) return { ok: false, reason: 'not-allowed' };
  const checked = validateUnsaidReplyText(text);
  if (!checked.ok) return { ok: false, reason: 'invalid' };
  if (!db) return { ok: false, reason: 'failed' };
  try {
    const uid = await currentUid();
    if (!uid) return { ok: false, reason: 'failed' };
    const replyRef = doc(collection(db, 'unsaid', post.id, 'replies'));
    const batch = writeBatch(db);
    batch.set(replyRef, { text: checked.text, createdAt: serverTimestamp() });
    batch.set(doc(db, 'unsaid_reply_owners', replyRef.id), { authorId: uid, postId: post.id });
    batch.update(doc(db, 'unsaid', post.id), { replyCount: increment(1), lastReply: replyRef.id });
    batch.set(doc(db, 'rate_limits', uid), { unsaidReply: serverTimestamp() }, { merge: true });
    await batch.commit();
    return { ok: true, id: replyRef.id };
  } catch (err) {
    console.warn('[Unsaid] Could not reply:', err);
    return { ok: false, reason: (err as { code?: string })?.code === 'permission-denied' ? 'too-fast' : 'failed' };
  }
}

/** Deletes a reply: the member's own, or any one for a moderator. Takes its owner record and one off the post's counter with it. */
export async function deleteUnsaidReply(postId: string, replyId: string): Promise<boolean> {
  if (!db) return false;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'unsaid', postId, 'replies', replyId));
    batch.delete(doc(db, 'unsaid_reply_owners', replyId));
    batch.update(doc(db, 'unsaid', postId), { replyCount: increment(-1), lastReply: replyId });
    await batch.commit();
    return true;
  } catch (err) {
    console.warn('[Unsaid] Could not delete the reply:', err);
    return false;
  }
}

/** Reports a reply to the moderators (the same reports inbox as posts). */
export async function reportUnsaidReply(postId: string, replyId: string, reason: string): Promise<boolean> {
  if (!db) return false;
  try {
    const uid = await currentUid();
    if (!uid) return false;
    await addDoc(collection(db, 'reports'), {
      reporterId: uid,
      targetId: `${postId}/${replyId}`,
      targetType: 'post',
      reason: `Unsaid reply: ${reason}`.slice(0, 300),
      timestamp: serverTimestamp(),
    });
    return true;
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------------------------------- telling authors about replies

/** One of the member's own posts that takes replies: how many replies it has, and how many the author has already seen. */
export interface OwnReplyPost {
  id: string;
  replyCount: number;
  seen: number;
}

/** The replies the author has not seen yet, per post (only posts with at least one). */
export function unseenByPost(posts: OwnReplyPost[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of posts) {
    const unseen = unseenReplies(p.replyCount, p.seen);
    if (unseen > 0) out[p.id] = unseen;
  }
  return out;
}

const NOTICE_CHUNK = 30; // Firestore's limit for an "in" query
const NOTICE_MAX_CHUNKS = 3;

/**
 * Tells an author about new replies without anyone learning who they are. The author's own owner records (readable only by
 * them) name their posts that take replies and how many replies they have seen; the posts' public counters say how many
 * there are. The difference is what is new. Calls `onChange` with the unseen count per post whenever either side changes, but
 * only once the counts have really loaded (never a misleading "all zero" first); `initial` is true for that first call.
 */
export function subscribeToReplyNotices(onChange: (unseen: Record<string, number>, info: { initial: boolean }) => void): () => void {
  if (!db) return () => {};
  const firestore = db;
  let cancelled = false;
  let stopOwners: (() => void) | null = null;
  let stopPosts: Array<() => void> = [];
  let seen = new Map<string, number>();
  let counts = new Map<string, number>();
  let idsKey = '';
  let expected = 0; // how many "in" queries must answer once before the counts are known
  const ready = new Set<number>();
  let sentInitial = false;

  const emit = () => {
    if (cancelled || ready.size < expected) return;
    const initial = !sentInitial;
    sentInitial = true;
    onChange(unseenByPost([...seen].map(([id, s]) => ({ id, seen: s, replyCount: counts.get(id) ?? 0 }))), { initial });
  };

  currentUid().then((uid) => {
    if (cancelled || !uid) return;
    stopOwners = onSnapshot(
      query(collection(firestore, 'unsaid_owners'), where('authorId', '==', uid)),
      (snap) => {
        // Only posts of a category that takes replies matter; older owner records have no kind and are never among them.
        seen = new Map(
          snap.docs
            .filter((d) => kindAllowsReplies(d.data().kind))
            .map((d) => [d.id, Math.max(0, Math.floor(Number(d.data().seenReplies) || 0))] as const)
        );
        const ids = [...seen.keys()].sort();
        const key = ids.join(',');
        if (key !== idsKey) {
          idsKey = key;
          stopPosts.forEach((stop) => stop());
          stopPosts = [];
          counts = new Map();
          ready.clear();
          expected = Math.ceil(Math.min(ids.length, NOTICE_CHUNK * NOTICE_MAX_CHUNKS) / NOTICE_CHUNK);
          for (let i = 0; i < Math.min(ids.length, NOTICE_CHUNK * NOTICE_MAX_CHUNKS); i += NOTICE_CHUNK) {
            const chunk = ids.slice(i, i + NOTICE_CHUNK);
            const index = i / NOTICE_CHUNK;
            stopPosts.push(
              onSnapshot(
                query(collection(firestore, 'unsaid'), where(documentId(), 'in', chunk)),
                (postsSnap) => {
                  for (const id of chunk) counts.delete(id);
                  postsSnap.docs.forEach((d) => counts.set(d.id, Math.max(0, Math.floor(Number(d.data().replyCount) || 0))));
                  ready.add(index);
                  emit();
                },
                (err) => console.warn('[Unsaid] Reply notices notice:', err)
              )
            );
          }
        }
        emit();
      },
      (err) => console.warn('[Unsaid] Reply notices notice:', err)
    );
  });

  return () => {
    cancelled = true;
    stopOwners?.();
    stopPosts.forEach((stop) => stop());
  };
}

/** The author has looked at a post's replies: remember that, so only newer ones count as new. Best effort. */
export async function markRepliesSeen(postId: string, replyCount: number): Promise<void> {
  if (!db) return;
  try {
    await updateDoc(doc(db, 'unsaid_owners', postId), { seenReplies: Math.max(0, Math.floor(replyCount)) });
  } catch {
    // Not the author, or offline: nothing to remember.
  }
}

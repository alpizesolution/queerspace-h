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
} from 'firebase/firestore';
import { auth, db, ensureAnonymousAuth, isFirebaseConfigured } from '../lib/firebase.ts';
import { sanitizeMessageText } from '../utils/matching-logic.ts';

/**
 * Unsaid wall: anonymous posts that fade after 48 hours.
 *
 * `unsaid/{id}` holds only text, timestamps and counters. Authorship lives in
 * `unsaid_owners/{id}`, which only the author can read, so posts can't be traced
 * back to a profile. Reactions and flags are one per person, enforced by rules.
 */

export const UNSAID_MAX_LENGTH = 500;
export const UNSAID_LIFETIME_MS = 48 * 60 * 60 * 1000;
/** Posts with this many flags are hidden for everyone until reviewed. */
export const UNSAID_HIDE_AT_FLAGS = 3;

/** Reaction counters on a post; must match the list in firestore.rules. */
export const UNSAID_REACTIONS = ['hugs', 'same', 'felt', 'strong', 'proud', 'cry'] as const;
export type UnsaidReaction = (typeof UNSAID_REACTIONS)[number];

export const UNSAID_KINDS = [
  { id: 'vent', label: 'Vent' },
  { id: 'confession', label: 'Confession' },
] as const;

export type UnsaidKind = (typeof UNSAID_KINDS)[number]['id'];

export function toUnsaidKind(value: unknown): UnsaidKind {
  return value === 'confession' ? 'confession' : 'vent';
}

export interface UnsaidPost {
  id: string;
  kind: UnsaidKind;
  text: string;
  createdAt: number;
  expiresAt: number;
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

export function validateUnsaidText(text: string): { ok: true; text: string } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'Write something first.' };
  if (trimmed.length > UNSAID_MAX_LENGTH) return { ok: false, error: `Keep it under ${UNSAID_MAX_LENGTH} characters.` };
  if (IDENTIFYING_PATTERNS.some((p) => p.test(trimmed))) {
    return { ok: false, error: 'Keep it anonymous: no links, handles or numbers.' };
  }
  const { isBlocked } = sanitizeMessageText(trimmed);
  if (isBlocked) return { ok: false, error: "This goes against our guidelines, so it can't be posted." };
  return { ok: true, text: trimmed };
}

/** True when the text suggests the writer may be in crisis. */
export function needsCrisisSupport(text: string): boolean {
  return CRISIS_PATTERNS.some((p) => p.test(text));
}

export function isUnsaidVisible(post: UnsaidPost, now: number = Date.now()): boolean {
  return post.expiresAt > now && post.flags < UNSAID_HIDE_AT_FLAGS;
}

/** "Fades in 31h" / "Fades in 12m". */
export function formatFadesIn(expiresAt: number, now: number = Date.now()): string {
  const ms = Math.max(0, expiresAt - now);
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `Fades in ${hours}h`;
  return `Fades in ${Math.max(1, Math.ceil(ms / 60_000))}m`;
}

function toMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof (value as Timestamp).toMillis === 'function') return (value as Timestamp).toMillis();
  return Date.now();
}

export const isUnsaidAvailable = () => isFirebaseConfigured && Boolean(db);

async function currentUid(): Promise<string | null> {
  const user = auth?.currentUser ?? (await ensureAnonymousAuth());
  return user?.uid ?? null;
}

/** Live feed of posts that haven't faded or been hidden, newest first. */
export function subscribeToUnsaid(onPosts: (posts: UnsaidPost[]) => void, onError: () => void): () => void {
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
        where('expiresAt', '>', Timestamp.now()),
        orderBy('expiresAt', 'desc'),
        limit(60)
      ),
      (snap) => {
        const now = Date.now();
        onPosts(
          snap.docs
            .map((d) => {
              const data = d.data();
              return {
                id: d.id,
                kind: toUnsaidKind(data.kind),
                text: String(data.text ?? ''),
                createdAt: toMillis(data.createdAt),
                expiresAt: toMillis(data.expiresAt),
                hugs: Number(data.hugs) || 0,
                same: Number(data.same) || 0,
                felt: Number(data.felt) || 0,
                strong: Number(data.strong) || 0,
                proud: Number(data.proud) || 0,
                cry: Number(data.cry) || 0,
                flags: Number(data.flags) || 0,
              };
            })
            .filter((p) => isUnsaidVisible(p, now))
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

/** Seconds between Unsaid posts; must match slowMode('unsaid', …) in firestore.rules. */
export const UNSAID_SLOW_MODE_SECONDS = 60;

export async function postUnsaid(kind: UnsaidKind, text: string): Promise<'posted' | 'too-fast' | 'failed'> {
  const checked = validateUnsaidText(text);
  if (!checked.ok || !db) return 'failed';
  try {
    const uid = await currentUid();
    if (!uid) return 'failed';
    const postRef = doc(collection(db, 'unsaid'));
    const batch = writeBatch(db);
    batch.set(postRef, {
      kind,
      text: checked.text,
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + UNSAID_LIFETIME_MS),
      hugs: 0,
      same: 0,
      flags: 0,
    });
    batch.set(doc(db, 'unsaid_owners', postRef.id), { authorId: uid });
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

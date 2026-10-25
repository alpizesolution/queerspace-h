import {
  collection,
  doc,
  FirestoreError,
  getCountFromServer,
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
import { auth, db, ensureAnonymousAuth } from '../lib/firebase.ts';
import { UserPreferences } from '../types.ts';
import { isValidAvatar } from '../utils/avatar.ts';

/**
 * Private support chat: support_threads/{uid} is the member's thread (a summary for the
 * admin inbox) and support_threads/{uid}/messages holds the chat. Only that member and
 * admins can read it (firestore.rules section 7).
 */

export const SUPPORT_MAX_LENGTH = 1000;
/** Must match the 140-character limit in firestore.rules. */
export const SUPPORT_PREVIEW_LENGTH = 140;
/** Seconds between member messages; must match slowMode('support', …) in firestore.rules. */
export const SUPPORT_SLOW_MODE_SECONDS = 2;
export const TEAM_NAME = 'QUEERSPACE Team';
/** Set once a member has used support, so only they pay for the unread check on app open. */
const SUPPORT_USED_KEY = 'qs_support_used';

export interface SupportMessage {
  id: string;
  from: 'user' | 'team';
  text: string;
  timestamp: number;
}

export interface SupportThread {
  id: string;
  displayName: string;
  avatar?: string;
  lastMessage: string;
  lastFrom: 'user' | 'team';
  updatedAt: number;
  unreadForTeam: boolean;
  unreadForUser: boolean;
}

function toMillis(value: unknown): number {
  return value && typeof (value as Timestamp).toMillis === 'function' ? (value as Timestamp).toMillis() : Date.now();
}

export function toSupportMessage(id: string, data: Record<string, unknown>): SupportMessage {
  return {
    id,
    from: data.from === 'team' ? 'team' : 'user',
    text: String(data.text ?? ''),
    timestamp: toMillis(data.timestamp),
  };
}

export function toSupportThread(id: string, data: Record<string, unknown>): SupportThread {
  return {
    id,
    displayName: String(data.displayName ?? 'Member').slice(0, 30),
    avatar: isValidAvatar(data.avatar) ? data.avatar : undefined,
    lastMessage: String(data.lastMessage ?? ''),
    lastFrom: data.lastFrom === 'team' ? 'team' : 'user',
    updatedAt: toMillis(data.updatedAt),
    unreadForTeam: data.unreadForTeam === true,
    unreadForUser: data.unreadForUser === true,
  };
}

function rememberSupportUsed() {
  try {
    localStorage.setItem(SUPPORT_USED_KEY, '1');
  } catch {
    // Only skips the unread check on the next visit.
  }
}

function hasUsedSupport(): boolean {
  try {
    return localStorage.getItem(SUPPORT_USED_KEY) === '1';
  } catch {
    return false;
  }
}

async function currentUid(): Promise<string | null> {
  const user = auth?.currentUser ?? (await ensureAnonymousAuth());
  return user?.uid ?? null;
}

/** Live messages of one thread, oldest first. Used by the member and by admins. */
export function subscribeToSupportMessages(
  threadId: string,
  onMessages: (messages: SupportMessage[]) => void,
  onError: () => void
): () => void {
  if (!db) {
    onError();
    return () => {};
  }
  return onSnapshot(
    query(collection(db, 'support_threads', threadId, 'messages'), orderBy('timestamp', 'asc'), limit(200)),
    (snap) => onMessages(snap.docs.map((d) => toSupportMessage(d.id, d.data()))),
    (err) => {
      console.warn('[Support] Messages notice:', err);
      onError();
    }
  );
}

/** The signed-in member's own thread ID (their uid), signing in anonymously if needed. */
export const getMySupportThreadId = currentUid;

export type SupportSendResult = 'sent' | 'too-fast' | 'failed';

export async function sendSupportMessage(prefs: UserPreferences, text: string): Promise<SupportSendResult> {
  const clean = text.trim().slice(0, SUPPORT_MAX_LENGTH);
  if (!db || !clean) return 'failed';
  try {
    const uid = await currentUid();
    if (!uid) return 'failed';
    const batch = writeBatch(db);
    batch.set(doc(collection(db, 'support_threads', uid, 'messages')), {
      from: 'user',
      text: clean,
      timestamp: serverTimestamp(),
    });
    batch.set(
      doc(db, 'support_threads', uid),
      {
        displayName: (prefs.displayName?.trim() || 'Sapphic Guest').slice(0, 30),
        ...(isValidAvatar(prefs.avatar) ? { avatar: prefs.avatar } : {}),
        lastMessage: clean.slice(0, SUPPORT_PREVIEW_LENGTH),
        lastFrom: 'user',
        updatedAt: serverTimestamp(),
        unreadForTeam: true,
      },
      { merge: true }
    );
    batch.set(doc(db, 'rate_limits', uid), { support: serverTimestamp() }, { merge: true });
    await batch.commit();
    rememberSupportUsed();
    return 'sent';
  } catch (err) {
    console.warn('[Support] Could not send:', err);
    return (err as FirestoreError)?.code === 'permission-denied' ? 'too-fast' : 'failed';
  }
}

/** Clears the member's "team replied" flag after they've seen it. */
export async function markSupportReadByUser(): Promise<void> {
  if (!db) return;
  try {
    const uid = await currentUid();
    if (!uid) return;
    await updateDoc(doc(db, 'support_threads', uid), { unreadForUser: false });
  } catch {
    // No thread yet, or offline: nothing to clear.
  }
}

/** One read on app open, and only for members who have used support before. */
export async function hasUnreadSupportReply(): Promise<boolean> {
  if (!db || !hasUsedSupport()) return false;
  try {
    const uid = await currentUid();
    if (!uid) return false;
    const snap = await getDoc(doc(db, 'support_threads', uid));
    return snap.exists() && snap.data().unreadForUser === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- Admin side

/** Admin inbox: newest conversations first. */
export function subscribeToSupportThreads(
  onThreads: (threads: SupportThread[]) => void,
  onError: () => void
): () => void {
  if (!db) {
    onError();
    return () => {};
  }
  return onSnapshot(
    query(collection(db, 'support_threads'), orderBy('updatedAt', 'desc'), limit(50)),
    (snap) => onThreads(snap.docs.map((d) => toSupportThread(d.id, d.data()))),
    (err) => {
      console.warn('[Support] Inbox notice:', err);
      onError();
    }
  );
}

/** Conversations waiting on the team, for the tab badge. One aggregate read. */
export async function countUnreadSupport(): Promise<number> {
  if (!db) return 0;
  try {
    const snap = await getCountFromServer(query(collection(db, 'support_threads'), where('unreadForTeam', '==', true)));
    return snap.data().count;
  } catch {
    return 0;
  }
}

export async function replyAsTeam(threadId: string, text: string): Promise<boolean> {
  const clean = text.trim().slice(0, SUPPORT_MAX_LENGTH);
  if (!db || !clean) return false;
  try {
    const batch = writeBatch(db);
    batch.set(doc(collection(db, 'support_threads', threadId, 'messages')), {
      from: 'team',
      text: clean,
      timestamp: serverTimestamp(),
    });
    batch.update(doc(db, 'support_threads', threadId), {
      lastMessage: clean.slice(0, SUPPORT_PREVIEW_LENGTH),
      lastFrom: 'team',
      updatedAt: serverTimestamp(),
      unreadForUser: true,
      unreadForTeam: false,
    });
    await batch.commit();
    return true;
  } catch (err) {
    console.warn('[Support] Could not reply:', err);
    return false;
  }
}

export async function markSupportReadByTeam(threadId: string): Promise<void> {
  if (!db) return;
  try {
    await updateDoc(doc(db, 'support_threads', threadId), { unreadForTeam: false });
  } catch (err) {
    console.warn('[Support] Could not mark read:', err);
  }
}

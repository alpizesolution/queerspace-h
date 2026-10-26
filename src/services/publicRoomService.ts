import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  writeBatch,
  FirestoreError,
} from 'firebase/firestore';
import { auth, db, ensureAnonymousAuth, isFirebaseConfigured } from '../lib/firebase.ts';
import { PublicRoomMessage, RoomQuote, UserPreferences } from '../types.ts';
import { isValidAvatar } from '../utils/avatar.ts';
import { isAdminDevice } from '../utils/adminDevice.ts';
import { TEAM_NAME } from './supportService.ts';
export { fetchIsCommunityAdmin as fetchIsRoomModerator } from './communityService.ts';

/** How many recent messages the room shows. */
export const PUBLIC_ROOM_HISTORY = 15;

export const isPublicRoomAvailable = () => isFirebaseConfigured && Boolean(db);

/** Firestore document → message for display, oldest first is the caller's job. */
export function toPublicRoomMessage(id: string, data: Record<string, unknown>, selfUid: string | null): PublicRoomMessage {
  const ts = data.timestamp;
  const millis =
    ts && typeof (ts as Timestamp).toMillis === 'function' ? (ts as Timestamp).toMillis() : Date.now();
  const authorId = String(data.authorId ?? '');
  return {
    id,
    authorId,
    author: String(data.authorName ?? 'Guest').slice(0, 30),
    authorPronouns: String(data.authorPronouns ?? '').slice(0, 20),
    authorAvatar: isValidAvatar(data.authorAvatar) ? data.authorAvatar : undefined,
    text: String(data.text ?? ''),
    timestamp: millis,
    isSelf: Boolean(selfUid) && authorId === selfUid,
    ...(data.team === true ? { team: true } : {}),
    ...(toRoomQuote(data.replyTo) ? { replyTo: toRoomQuote(data.replyTo) } : {}),
  };
}

function toRoomQuote(value: unknown): RoomQuote | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const q = value as Record<string, unknown>;
  if (typeof q.id !== 'string' || !q.id) return undefined;
  return { id: q.id, author: String(q.author ?? '').slice(0, 30), text: String(q.text ?? '').slice(0, 140) };
}

/** The short quote a reply stores (limits must match isValidRoomQuote in firestore.rules). */
export function quoteOf(message: PublicRoomMessage): RoomQuote {
  return { id: message.id.slice(0, 64), author: message.author.slice(0, 30), text: message.text.slice(0, 140) };
}

/** Live feed of the latest room messages, oldest first. */
export function subscribeToPublicRoom(
  onMessages: (messages: PublicRoomMessage[]) => void,
  onError: () => void
): () => void {
  if (!db) {
    onError();
    return () => {};
  }
  const firestore = db;
  let unsubscribe: (() => void) | null = null;
  let cancelled = false;

  (async () => {
    const user = auth?.currentUser ?? (await ensureAnonymousAuth());
    if (cancelled) return;
    if (!user) {
      onError();
      return;
    }
    unsubscribe = onSnapshot(
      query(collection(firestore, 'public_room_messages'), orderBy('timestamp', 'desc'), limit(PUBLIC_ROOM_HISTORY)),
      (snap) => {
        onMessages(snap.docs.map((d) => toPublicRoomMessage(d.id, d.data(), user.uid)).reverse());
      },
      (err) => {
        console.warn('[PublicRoom] Feed notice:', err);
        onError();
      }
    );
  })();

  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}

export type SendResult = 'sent' | 'too-fast' | 'failed';

/** Seconds between room messages; must match slowMode('publicRoom', …) in firestore.rules. */
export const PUBLIC_ROOM_SLOW_MODE_SECONDS = 2;

export async function sendPublicRoomMessage(prefs: UserPreferences, text: string): Promise<SendResult> {
  if (!db) return 'failed';
  try {
    const user = auth?.currentUser ?? (await ensureAnonymousAuth());
    if (!user) return 'failed';
    const batch = writeBatch(db);
    batch.set(doc(collection(db, 'public_room_messages')), {
      authorId: user.uid,
      authorName: (prefs.displayName?.trim() || 'Sapphic Guest').slice(0, 30),
      authorPronouns: (prefs.pronouns?.trim() || 'she/her').slice(0, 20),
      ...(isValidAvatar(prefs.avatar) ? { authorAvatar: prefs.avatar } : {}),
      text: text.slice(0, 1000),
      timestamp: serverTimestamp(),
    });
    batch.set(doc(db, 'rate_limits', user.uid), { publicRoom: serverTimestamp() }, { merge: true });
    await batch.commit();
    return 'sent';
  } catch (err) {
    console.warn('[PublicRoom] Could not send:', err);
    return (err as FirestoreError)?.code === 'permission-denied' ? 'too-fast' : 'failed';
  }
}

/**
 * Whether this device may offer "Post as Team": an admin signed in with Google here
 * (via /admin). firestore.rules make the final call on every team post.
 */
export async function canPostAsTeam(): Promise<boolean> {
  if (!db || !isAdminDevice()) return false;
  const user = auth?.currentUser ?? (await ensureAnonymousAuth());
  return Boolean(user?.providerData.some((p) => p.providerId === 'google.com'));
}

/** Posts with the verified team badge. Returns the new message ID, or null if it failed. */
export async function sendTeamRoomMessage(text: string, replyTo?: RoomQuote): Promise<string | null> {
  const clean = text.trim().slice(0, 1000);
  const uid = auth?.currentUser?.uid;
  if (!db || !uid || !clean) return null;
  try {
    const ref = await addDoc(collection(db, 'public_room_messages'), {
      authorId: uid,
      authorName: TEAM_NAME,
      authorPronouns: 'team',
      text: clean,
      timestamp: serverTimestamp(),
      team: true,
      ...(replyTo ? { replyTo } : {}),
    });
    return ref.id;
  } catch (err) {
    console.warn('[PublicRoom] Could not post as team:', err);
    return null;
  }
}

/** Admin removal of any room message. firestore.rules allow it only for admins/{uid} Google sessions. */
export async function adminDeleteRoomMessage(messageId: string): Promise<boolean> {
  if (!db) return false;
  try {
    await deleteDoc(doc(db, 'public_room_messages', messageId));
    return true;
  } catch (err) {
    console.warn('[PublicRoom] Admin could not delete message:', err);
    return false;
  }
}

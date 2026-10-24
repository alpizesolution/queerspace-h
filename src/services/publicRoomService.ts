import {
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { auth, db, ensureAnonymousAuth, isFirebaseConfigured } from '../lib/firebase.ts';
import { PublicRoomMessage, UserPreferences } from '../types.ts';
import { isValidAvatar } from '../utils/avatar.ts';

/** How many recent messages the room shows. */
export const PUBLIC_ROOM_HISTORY = 100;

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
  };
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

export async function sendPublicRoomMessage(prefs: UserPreferences, text: string): Promise<boolean> {
  if (!db) return false;
  try {
    const user = auth?.currentUser ?? (await ensureAnonymousAuth());
    if (!user) return false;
    await addDoc(collection(db, 'public_room_messages'), {
      authorId: user.uid,
      authorName: (prefs.displayName?.trim() || 'Sapphic Guest').slice(0, 30),
      authorPronouns: (prefs.pronouns?.trim() || 'she/her').slice(0, 20),
      ...(isValidAvatar(prefs.avatar) ? { authorAvatar: prefs.avatar } : {}),
      text: text.slice(0, 1000),
      timestamp: serverTimestamp(),
    });
    return true;
  } catch (err) {
    console.warn('[PublicRoom] Could not send:', err);
    return false;
  }
}

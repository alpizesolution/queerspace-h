import {
  addDoc,
  collection,
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
import { PublicRoomMessage, UserPreferences } from '../types.ts';
import { isValidAvatar } from '../utils/avatar.ts';
import { isAdminDevice } from '../utils/adminDevice.ts';
import { TEAM_NAME } from './supportService.ts';

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
    ...(data.team === true ? { team: true } : {}),
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
export async function sendTeamRoomMessage(text: string): Promise<string | null> {
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
    });
    return ref.id;
  } catch (err) {
    console.warn('[PublicRoom] Could not post as team:', err);
    return null;
  }
}

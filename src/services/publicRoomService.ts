import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  Timestamp,
  writeBatch,
  FirestoreError,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import { auth, db, ensureAnonymousAuth, isFirebaseConfigured } from '../lib/firebase.ts';
import { PublicRoomMessage, RoomQuote, UserPreferences } from '../types.ts';
import { isValidAvatar } from '../utils/avatar.ts';
import { parseGifInfo, type GifInfo } from '../utils/gif.ts';
import { isAdminDevice } from '../utils/adminDevice.ts';
import { TEAM_NAME } from './supportService.ts';
export { fetchIsCommunityAdmin as fetchIsRoomModerator } from './communityService.ts';

/** Reaction types on room messages. Ids must match the lists in firestore.rules. */
export const ROOM_REACTIONS = [
  // Cat faces, like the chat's quick reactions. The ids are what's stored, so they stay fixed.
  { id: 'heart', emoji: '😻', label: 'Love' },
  { id: 'laugh', emoji: '😹', label: 'Haha' },
  { id: 'hug', emoji: '😽', label: 'Kiss' },
  { id: 'fire', emoji: '🙀', label: 'Shook' },
  { id: 'cry', emoji: '😿', label: 'Sad' },
] as const;
export type RoomReactionId = (typeof ROOM_REACTIONS)[number]['id'];

function toReactionCounts(data: Record<string, unknown>): Record<string, number> | undefined {
  const counts: Record<string, number> = {};
  for (const { id } of ROOM_REACTIONS) {
    const n = Number(data[id]);
    if (Number.isFinite(n) && n > 0) counts[id] = Math.floor(n);
  }
  return Object.keys(counts).length ? counts : undefined;
}

/** Messages per page: the live window at the bottom of the room, and each "Load older messages" page. */
export const PUBLIC_ROOM_HISTORY = 30;

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
    // A GIF is shown only if its addresses are approved GIPHY ones; otherwise it is the plain text "GIF".
    ...(data.kind === 'gif' && parseGifInfo(data.gif) ? { kind: 'gif' as const, gif: parseGifInfo(data.gif) as GifInfo } : {}),
    ...(toReactionCounts(data) ? { reactions: toReactionCounts(data) } : {}),
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

/** Opaque position in the room's history, for loading the page before it. */
export type RoomCursor = QueryDocumentSnapshot<DocumentData>;

export interface RoomFeedMeta {
  /** The live window holds a full page, so older messages may exist. */
  windowFull: boolean;
  /** Oldest message in the live window, where "load older" starts. */
  oldest: RoomCursor | null;
}

/**
 * Live feed of the latest room messages, oldest first. Only the newest page is listened to, so a new
 * message costs one document read; older pages are fetched once, on request (loadOlderRoomMessages).
 */
export function subscribeToPublicRoom(
  onMessages: (messages: PublicRoomMessage[], meta: RoomFeedMeta) => void,
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
        const docs = snap.docs;
        onMessages(docs.map((d) => toPublicRoomMessage(d.id, d.data(), user.uid)).reverse(), {
          windowFull: docs.length >= PUBLIC_ROOM_HISTORY,
          oldest: docs.length ? docs[docs.length - 1] : null,
        });
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

export interface OlderRoomPage {
  /** Oldest first. */
  messages: PublicRoomMessage[];
  /** Where the next page starts; null when nothing older remains. */
  cursor: RoomCursor | null;
  hasMore: boolean;
}

/**
 * One page of messages older than `before`, using a cursor (not an offset). Asks for one extra document so it
 * knows whether more remain, which saves an empty round trip at the end. Read-only.
 */
export async function loadOlderRoomMessages(before: RoomCursor): Promise<OlderRoomPage> {
  if (!db) throw new Error('Firebase is not configured');
  const user = auth?.currentUser ?? (await ensureAnonymousAuth());
  if (!user) throw new Error('Not signed in');
  const snap = await getDocs(
    query(
      collection(db, 'public_room_messages'),
      orderBy('timestamp', 'desc'),
      startAfter(before),
      limit(PUBLIC_ROOM_HISTORY + 1)
    )
  );
  const hasMore = snap.docs.length > PUBLIC_ROOM_HISTORY;
  const docs = snap.docs.slice(0, PUBLIC_ROOM_HISTORY);
  return {
    messages: docs.map((d) => toPublicRoomMessage(d.id, d.data(), user.uid)).reverse(),
    cursor: docs.length ? docs[docs.length - 1] : null,
    hasMore,
  };
}

/**
 * Combines what is on screen with a fresh live window (both oldest first), without duplicates.
 * - Messages that slid out of the window because newer ones arrived, and older pages already loaded, are kept.
 * - A message inside the window's time range that the window no longer has was deleted, so it is dropped.
 * - If everything on screen is older than the window, messages arrived in between that were never seen
 *   (the listener was paused for a while); keep only the window and report a reset so paging restarts from it.
 */
export function mergeRoomMessages(
  shown: PublicRoomMessage[],
  live: PublicRoomMessage[],
  windowFull: boolean
): { messages: PublicRoomMessage[]; reset: boolean } {
  if (!live.length) return { messages: [], reset: shown.length > 0 };
  const oldestLive = live[0].timestamp;
  const liveIds = new Set(live.map((m) => m.id));
  const newestShown = shown[shown.length - 1];
  if (windowFull && newestShown && !liveIds.has(newestShown.id) && newestShown.timestamp < oldestLive) {
    return { messages: live, reset: true };
  }
  const kept = windowFull ? shown.filter((m) => !liveIds.has(m.id) && m.timestamp < oldestLive) : [];
  return { messages: [...kept, ...live], reset: false };
}

/** Adds an older page above the messages on screen, skipping any already shown, oldest first. */
export function prependRoomPage(shown: PublicRoomMessage[], older: PublicRoomMessage[]): PublicRoomMessage[] {
  const have = new Set(shown.map((m) => m.id));
  return [...older.filter((m) => !have.has(m.id)), ...shown];
}

export type SendResult = 'sent' | 'too-fast' | 'failed';

/** Seconds between room messages; must match slowMode('publicRoom', …) in firestore.rules. */
export const PUBLIC_ROOM_SLOW_MODE_SECONDS = 2;

export async function sendPublicRoomMessage(prefs: UserPreferences, text: string, replyTo?: RoomQuote): Promise<SendResult> {
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
      ...(replyTo ? { replyTo } : {}),
    });
    batch.set(doc(db, 'rate_limits', user.uid), { publicRoom: serverTimestamp() }, { merge: true });
    await batch.commit();
    return 'sent';
  } catch (err) {
    console.warn('[PublicRoom] Could not send:', err);
    return (err as FirestoreError)?.code === 'permission-denied' ? 'too-fast' : 'failed';
  }
}

export type GifSendResult =
  | { ok: true }
  | { ok: false; reason: 'too-fast' | 'not-allowed' | 'gone' | 'unavailable' | 'failed' };

/** Words for a GIF that could not be sent to the room. */
export function roomGifProblemText(reason: Exclude<GifSendResult, { ok: true }>['reason']): string {
  switch (reason) {
    case 'too-fast': return 'Slow down a little, then try again.';
    case 'not-allowed': return 'You cannot send GIFs right now.';
    case 'gone': return 'That GIF is no longer available. Pick another one.';
    case 'unavailable': return 'GIFs are unavailable right now.';
    default: return "Couldn't send. Check your connection and try again.";
  }
}

/**
 * Sends a GIF to the room by its GIPHY id. The server checks the member, asks GIPHY for the GIF and writes the message, so
 * no link ever comes from the app. `messageId` is chosen once per GIF the member picks, so a retry makes no second copy. The
 * message then arrives through the same live feed as every other room message.
 */
export async function sendRoomGif(gifId: string, messageId: string): Promise<GifSendResult> {
  try {
    const user = auth?.currentUser ?? (await ensureAnonymousAuth());
    if (!user) return { ok: false, reason: 'failed' };
    const token = await user.getIdToken();
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch('/api/room', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send-gif', gifId, messageId }),
        signal: controller.signal,
      });
      if (response.ok) return { ok: true };
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (data.error === 'too_fast' || data.error === 'rate_limited') return { ok: false, reason: 'too-fast' };
      if (data.error === 'not_allowed' || data.error === 'account_unavailable') return { ok: false, reason: 'not-allowed' };
      if (data.error === 'gif_not_found' || data.error === 'invalid_gif') return { ok: false, reason: 'gone' };
      if (data.error === 'gif_not_configured') return { ok: false, reason: 'unavailable' };
      return { ok: false, reason: 'failed' };
    } finally {
      window.clearTimeout(timer);
    }
  } catch (err) {
    console.warn('[PublicRoom] Could not send GIF:', err);
    return { ok: false, reason: 'failed' };
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

/**
 * Adds my reaction (+1 on the message counter with a marker doc) or removes it (-1 and delete
 * the marker), in one batch. One reaction per person per message; the rules enforce it.
 * Returns false if the server refused, e.g. I'd already reacted from another device.
 */
export async function setRoomReaction(messageId: string, type: RoomReactionId, on: boolean): Promise<boolean> {
  if (!db) return false;
  try {
    const uid = auth?.currentUser?.uid ?? (await ensureAnonymousAuth())?.uid;
    if (!uid) return false;
    const batch = writeBatch(db);
    batch.update(doc(db, 'public_room_messages', messageId), { [type]: increment(on ? 1 : -1) });
    const marker = doc(db, 'public_room_messages', messageId, 'reactions', uid);
    if (on) batch.set(marker, { type, createdAt: serverTimestamp() });
    else batch.delete(marker);
    await batch.commit();
    return true;
  } catch (err) {
    console.warn('[PublicRoom] Could not update reaction:', err);
    return false;
  }
}

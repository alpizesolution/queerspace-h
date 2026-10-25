import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  Query,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase.ts';
import { isFreshQueueEntry } from './liveMatchService.ts';

/**
 * Admin page data. Every read and write here is also guarded by firestore.rules:
 * only a Google account with a doc at admins/{uid} gets through.
 */

export type InboxStatus = 'open' | 'done';

export interface AdminSuggestion {
  id: string;
  category: string;
  text: string;
  createdAt: number;
  status: InboxStatus;
}

export interface AdminReport {
  id: string;
  reporterId: string;
  targetId: string;
  targetType: string;
  reason: string;
  createdAt: number;
  status: InboxStatus;
}

export interface AdminUnsaidPost {
  id: string;
  kind: string;
  text: string;
  flags: number;
  expiresAt: number;
}

export interface DayCount {
  /** Midnight (local time) that starts the day. */
  day: number;
  count: number;
}

export interface AdminStats {
  members: number;
  membersToday: number;
  membersWeek: number;
  chatsTotal: number;
  chatsToday: number;
  chatsWeek: number;
  searchingNow: number;
  roomToday: number;
  unsaidLive: number;
  memberDays: DayCount[];
  chatDays: DayCount[];
  /** Set when a count needs a Firestore index that hasn't been created yet. */
  indexLink: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const CHART_DAYS = 14;

function toMillis(value: unknown): number {
  if (value && typeof (value as Timestamp).toMillis === 'function') return (value as Timestamp).toMillis();
  return 0;
}

function toStatus(value: unknown): InboxStatus {
  return value === 'done' ? 'done' : 'open';
}

/** Local midnights for the last `days` days, oldest first. */
export function lastDays(days: number, now: Date = new Date()): number[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Array.from({ length: days }, (_, i) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - i)).getTime()
  );
}

/** Pulls the "create it here" link out of a Firestore missing-index error. */
export function indexLinkFromError(err: unknown): string | null {
  const message = err instanceof Error ? err.message : String(err ?? '');
  const match = message.match(/https:\/\/console\.firebase\.google\.com\S+/);
  return match ? match[0] : null;
}

// ---------------------------------------------------------------- Sign-in

export async function signInAdmin(): Promise<void> {
  if (!auth) throw new Error('Firebase is not configured');
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if ((err as { code?: string })?.code === 'auth/popup-blocked') {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw err;
  }
}

export async function signOutAdmin(): Promise<void> {
  if (auth) await signOut(auth);
}

export function isGoogleUser(user: User | null): boolean {
  return Boolean(user?.providerData.some((p) => p.providerId === 'google.com'));
}

/** 'missing': no admins/{uid} doc. 'blocked': the rules refused the read (usually not published yet). */
export type AdminCheck = 'admin' | 'missing' | 'blocked' | 'error';

export async function checkAdmin(user: User | null): Promise<AdminCheck> {
  if (!db || !user || !isGoogleUser(user)) return 'missing';
  try {
    // Straight from the server, so a doc added in the console shows up on "Check again".
    return (await getDocFromServer(doc(db, 'admins', user.uid))).exists() ? 'admin' : 'missing';
  } catch (err) {
    console.warn('[Admin] Admin check failed:', err);
    return (err as { code?: string })?.code === 'permission-denied' ? 'blocked' : 'error';
  }
}

// ---------------------------------------------------------------- Stats

async function count(q: Query): Promise<number> {
  return (await getCountFromServer(q)).data().count;
}

export async function loadStats(): Promise<AdminStats> {
  if (!db) throw new Error('Firebase is not configured');
  const firestore = db;
  const days = lastDays(CHART_DAYS);
  const ts = (ms: number) => Timestamp.fromMillis(ms);
  const today = days[days.length - 1];
  const weekStart = days[days.length - 7];

  const members = collectionGroup(firestore, 'public');
  const chats = collection(firestore, 'conversations');
  const between = (q: Query, field: string, from: number, to?: number) =>
    to === undefined
      ? query(q, where(field, '>=', ts(from)))
      : query(q, where(field, '>=', ts(from)), where(field, '<', ts(to)));

  let indexLink: string | null = null;
  // Member counts by join date need a collection-group index; fall back to zeros until it exists.
  const memberCount = (q: Query) =>
    count(q).catch((err) => {
      indexLink = indexLink ?? indexLinkFromError(err);
      if (!indexLinkFromError(err)) throw err;
      return 0;
    });

  const [
    memberTotal,
    membersToday,
    membersWeek,
    chatsTotal,
    chatsToday,
    chatsWeek,
    roomToday,
    unsaidLive,
    queueSnap,
    memberDayCounts,
    chatDayCounts,
  ] = await Promise.all([
    count(members),
    memberCount(between(members, 'createdAt', today)),
    memberCount(between(members, 'createdAt', weekStart)),
    count(chats),
    count(between(chats, 'createdAt', today)),
    count(between(chats, 'createdAt', weekStart)),
    count(between(collection(firestore, 'public_room_messages'), 'timestamp', today)),
    count(query(collection(firestore, 'unsaid'), where('expiresAt', '>', Timestamp.now()))),
    getDocs(query(collection(firestore, 'match_queue'), where('status', '==', 'waiting'))),
    Promise.all(days.map((d) => memberCount(between(members, 'createdAt', d, d + DAY_MS)))),
    Promise.all(days.map((d) => count(between(chats, 'createdAt', d, d + DAY_MS)))),
  ]);

  return {
    members: memberTotal,
    membersToday,
    membersWeek,
    chatsTotal,
    chatsToday,
    chatsWeek,
    searchingNow: queueSnap.docs.filter((d) => isFreshQueueEntry(d.data())).length,
    roomToday,
    unsaidLive,
    memberDays: days.map((day, i) => ({ day, count: memberDayCounts[i] })),
    chatDays: days.map((day, i) => ({ day, count: chatDayCounts[i] })),
    indexLink,
  };
}

// ---------------------------------------------------------------- Inbox

export async function loadSuggestions(): Promise<AdminSuggestion[]> {
  if (!db) return [];
  const snap = await getDocs(query(collection(db, 'suggestions'), orderBy('createdAt', 'desc'), limit(200)));
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      category: String(data.category ?? 'other'),
      text: String(data.text ?? ''),
      createdAt: toMillis(data.createdAt),
      status: toStatus(data.status),
    };
  });
}

export async function loadReports(): Promise<AdminReport[]> {
  if (!db) return [];
  const snap = await getDocs(query(collection(db, 'reports'), orderBy('timestamp', 'desc'), limit(200)));
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      reporterId: String(data.reporterId ?? ''),
      targetId: String(data.targetId ?? ''),
      targetType: String(data.targetType ?? ''),
      reason: String(data.reason ?? ''),
      createdAt: toMillis(data.timestamp),
      status: toStatus(data.status),
    };
  });
}

export async function setInboxStatus(
  collectionName: 'suggestions' | 'reports',
  id: string,
  status: InboxStatus
): Promise<void> {
  if (!db) return;
  await updateDoc(doc(db, collectionName, id), { status });
}

export async function deleteInboxItem(collectionName: 'suggestions' | 'reports', id: string): Promise<void> {
  if (!db) return;
  await deleteDoc(doc(db, collectionName, id));
}

/** Display name for a reported user, from their public profile. */
export async function loadDisplayName(uid: string): Promise<string | null> {
  if (!db || !uid) return null;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'public', 'profile'));
    return snap.exists() ? String(snap.data().displayName ?? '') || null : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Moderation

export async function deleteRoomMessage(id: string): Promise<void> {
  if (!db) return;
  await deleteDoc(doc(db, 'public_room_messages', id));
}

/** Live Unsaid posts that someone has flagged, most flagged first. */
export async function loadFlaggedUnsaid(): Promise<AdminUnsaidPost[]> {
  if (!db) return [];
  const snap = await getDocs(query(collection(db, 'unsaid'), where('flags', '>', 0), orderBy('flags', 'desc'), limit(100)));
  const now = Date.now();
  return snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        kind: String(data.kind ?? 'vent'),
        text: String(data.text ?? ''),
        flags: Number(data.flags) || 0,
        expiresAt: toMillis(data.expiresAt),
      };
    })
    .filter((p) => p.expiresAt > now);
}

export async function restoreUnsaid(id: string): Promise<void> {
  if (!db) return;
  await updateDoc(doc(db, 'unsaid', id), { flags: 0 });
}

export async function removeUnsaid(id: string): Promise<void> {
  if (!db) return;
  const batch = writeBatch(db);
  batch.delete(doc(db, 'unsaid', id));
  batch.delete(doc(db, 'unsaid_owners', id));
  await batch.commit();
}

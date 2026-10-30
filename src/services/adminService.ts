import {
  getRedirectResult,
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
import type { ReportStatus, SuggestionStatus } from './adminInboxService.ts';
import { isFreshQueueEntry } from './liveMatchService.ts';

/**
 * Admin page data. Every read and write here is also guarded by firestore.rules:
 * only a Google account with a doc at admins/{uid} gets through.
 */

export interface AdminUnsaidPost {
  id: string;
  kind: string;
  text: string;
  flags: number;
  expiresAt: number | null;
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
  /** Totals for comparisons: yesterday, and the same number of days just before the chart's range. */
  membersYesterday: number;
  chatsYesterday: number;
  roomYesterday: number;
  membersRange: number;
  membersPrevRange: number;
  chatsRange: number;
  chatsPrevRange: number;
  range: StatsRange;
  /** Set when a count needs a Firestore index that hasn't been created yet. */
  indexLink: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const STATS_RANGES = [7, 14, 30] as const;
export type StatsRange = (typeof STATS_RANGES)[number];
export const DEFAULT_STATS_RANGE: StatsRange = 14;

/** How a count moved against the period before it. `null` when there is nothing to compare with. */
export function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Splits per-day counts (oldest first) into the last `range` days and the `range` days before them. */
export function splitPeriods(counts: number[], range: number): { current: number[]; previous: number[] } {
  const current = counts.slice(-range);
  const previous = counts.slice(-range * 2, -range);
  return { current, previous };
}

function toMillis(value: unknown): number {
  if (value && typeof (value as Timestamp).toMillis === 'function') return (value as Timestamp).toMillis();
  return 0;
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
  // Phones, tablets and home-screen apps handle a full-page redirect far better than a popup.
  const touchFirst =
    window.matchMedia?.('(pointer: coarse)').matches || window.matchMedia?.('(display-mode: standalone)').matches;
  if (touchFirst) {
    await signInWithRedirect(auth, provider);
    return;
  }
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

/** Finishes a redirect sign-in; throws its error (if any) so the page can show it. */
export async function finishRedirectSignIn(): Promise<void> {
  if (auth) await getRedirectResult(auth);
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

/**
 * Counts scan one index entry per document (billed 1 read per 1,000 entries), so the totals grow
 * with the app. Reopening Overview within a few minutes reuses the last result; Refresh forces.
 */
const STATS_TTL_MS = 5 * 60_000;
const cachedStats = new Map<StatsRange, { at: number; stats: AdminStats }>();

export async function loadStats(range: StatsRange = DEFAULT_STATS_RANGE, force = false): Promise<AdminStats> {
  const hit = cachedStats.get(range);
  if (!force && hit && Date.now() - hit.at < STATS_TTL_MS) return hit.stats;
  const stats = await fetchStats(range);
  cachedStats.set(range, { at: Date.now(), stats });
  return stats;
}

/** When the stats for this range were last fetched (for "Updated 3:05 PM"). */
export function statsFetchedAt(range: StatsRange): number | null {
  return cachedStats.get(range)?.at ?? null;
}

async function fetchStats(range: StatsRange): Promise<AdminStats> {
  if (!db) throw new Error('Firebase is not configured');
  const firestore = db;
  // The range plus the same number of days before it, so every figure can be compared with the last period.
  const allDays = lastDays(range * 2);
  const days = allDays.slice(-range);
  const ts = (ms: number) => Timestamp.fromMillis(ms);
  const today = days[days.length - 1];
  const yesterday = today - DAY_MS;

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

  // Today and this week come from the daily counts, so each day's index entries are scanned once.
  const [memberTotal, chatsTotal, roomToday, roomYesterday, unsaidLive, queueSnap, memberAllCounts, chatAllCounts] = await Promise.all([
    count(members),
    count(chats),
    count(between(collection(firestore, 'public_room_messages'), 'timestamp', today)),
    count(between(collection(firestore, 'public_room_messages'), 'timestamp', yesterday, today)),
    // Echoes are permanent, so this is every Echo ever written.
    count(collection(firestore, 'unsaid')),
    getDocs(query(collection(firestore, 'match_queue'), where('status', '==', 'waiting'))),
    Promise.all(allDays.map((d) => memberCount(between(members, 'createdAt', d, d + DAY_MS)))),
    Promise.all(allDays.map((d) => count(between(chats, 'createdAt', d, d + DAY_MS)))),
  ]);
  const memberPeriods = splitPeriods(memberAllCounts, range);
  const chatPeriods = splitPeriods(chatAllCounts, range);
  const memberDayCounts = memberPeriods.current;
  const chatDayCounts = chatPeriods.current;
  const sum = (counts: number[]) => counts.reduce((a, b) => a + b, 0);
  const membersToday = memberDayCounts[memberDayCounts.length - 1];
  const membersWeek = sum(memberDayCounts.slice(-7));
  const chatsToday = chatDayCounts[chatDayCounts.length - 1];
  const chatsWeek = sum(chatDayCounts.slice(-7));

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
    membersYesterday: memberAllCounts[memberAllCounts.length - 2] ?? 0,
    chatsYesterday: chatAllCounts[chatAllCounts.length - 2] ?? 0,
    roomYesterday,
    membersRange: sum(memberPeriods.current),
    membersPrevRange: sum(memberPeriods.previous),
    chatsRange: sum(chatPeriods.current),
    chatsPrevRange: sum(chatPeriods.previous),
    range,
    indexLink,
  };
}

// ---------------------------------------------------------------- Inbox

export async function setInboxStatus(
  collectionName: 'suggestions' | 'reports',
  id: string,
  status: SuggestionStatus | ReportStatus
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

/** Unsaid posts that someone has flagged, most flagged first. */
export async function loadFlaggedUnsaid(): Promise<AdminUnsaidPost[]> {
  if (!db) return [];
  const snap = await getDocs(query(collection(db, 'unsaid'), where('flags', '>', 0), orderBy('flags', 'desc'), limit(100)));
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      kind: String(data.kind ?? 'vent'),
      text: String(data.text ?? ''),
      flags: Number(data.flags) || 0,
      expiresAt: data.expiresAt ? toMillis(data.expiresAt) : null,
    };
  });
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

import { and, collection, getCountFromServer, getDocs, limit, orderBy, or, query, Query, where } from 'firebase/firestore';
import { auth, db } from '../lib/firebase.ts';
import { ACQUISITION_SOURCES, AcquisitionSource, activityDayKey, activityDayNumber, addDays, dayNumberToLocalMs } from '../utils/acquisition.ts';
import type { DayCount } from './adminService.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_MS = 5 * 60_000;

const memo = new Map<string, { at: number; value: unknown }>();
async function remember<T>(key: string, force: boolean, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  const value = await load();
  memo.set(key, { at: Date.now(), value });
  return value;
}

const countOf = async (q: Query) => (await getCountFromServer(q)).data().count;

// ---------------------------------------------------------------- Firebase Authentication (via the admin endpoint)

export interface AuthGrowth {
  /** Every Firebase Authentication account, including visitors who never finished a profile. */
  total: number;
  anonymous: number;
  /** Accounts created per day (Philippine time), oldest first, 90 days. */
  days: DayCount[];
  generatedAt: number;
}

export async function loadAuthGrowth(force = false): Promise<AuthGrowth> {
  return remember('auth-growth', force, async () => {
    const token = await auth?.currentUser?.getIdToken();
    if (!token) throw new Error('Not signed in');
    const response = await fetch(`/api/admin-growth${force ? '?force=1' : ''}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Growth request failed (${response.status})`);
    const body = (await response.json()) as { total: number; anonymous: number; days: { date: string; count: number }[]; generatedAt: number };
    return {
      total: body.total,
      anonymous: body.anonymous,
      generatedAt: body.generatedAt,
      days: body.days.map((d) => ({ day: dayNumberToLocalMs(Number(d.date.replace(/-/g, ''))), count: d.count })),
    };
  });
}

/** Sum of the last `n` entries. */
export const sumLast = (days: DayCount[], n: number) => days.slice(-n).reduce((total, d) => total + d.count, 0);

// ---------------------------------------------------------------- Activity (member_activity)

export interface ActivityStats {
  /** First day anyone was counted, as a day number (20261030); null before any activity exists. */
  trackingSince: number | null;
  dau: number;
  dauYesterday: number;
  wau: number;
  mau: number;
  /** Active in the last 7 / 30 days but first counted before that window. */
  returningWeek: number;
  returningMonth: number;
  dauDays: DayCount[];
  sources: { source: AcquisitionSource | 'unknown'; count: number }[];
  tracked: number;
}

const dayField = (key: string) => `days.${key}`;

export async function loadActivityStats(range: number, force = false, now: number = Date.now()): Promise<ActivityStats> {
  return remember(`activity-${range}-${activityDayNumber(now)}`, force, async () => {
    if (!db) throw new Error('Firebase is not configured');
    const members = collection(db, 'member_activity');
    const keys = Array.from({ length: 30 }, (_, i) => activityDayKey(now - i * DAY_MS)); // today first
    const activeOn = (key: string) => query(members, where(dayField(key), '==', true));
    const anyOf = (list: string[]) => query(members, or(...list.map((k) => where(dayField(k), '==', true))));
    const chartAgo = Array.from({ length: range }, (_, i) => range - 1 - i); // days ago, oldest first
    const weekStart = activityDayNumber(now - 6 * DAY_MS);
    const monthStart = activityDayNumber(now - 29 * DAY_MS);
    const localToday = new Date(now);

    const [first, dau, dauYesterday, wau, mau, newWeek, newMonth, tracked, dauCounts, sourceCounts] = await Promise.all([
      getDocs(query(members, orderBy('firstDay'), limit(1))),
      countOf(activeOn(keys[0])),
      countOf(activeOn(keys[1])),
      countOf(anyOf(keys.slice(0, 7))),
      countOf(anyOf(keys)),
      countOf(query(members, where('firstDay', '>=', weekStart))),
      countOf(query(members, where('firstDay', '>=', monthStart))),
      countOf(members),
      Promise.all(chartAgo.map((ago) => countOf(activeOn(activityDayKey(now - ago * DAY_MS))))),
      Promise.all(ACQUISITION_SOURCES.map((s) => countOf(query(members, where('source', '==', s))))),
    ]);

    const attributed = sourceCounts.reduce((a, b) => a + b, 0);
    return {
      trackingSince: first.empty ? null : Number(first.docs[0].data().firstDay) || null,
      dau,
      dauYesterday,
      wau,
      mau,
      returningWeek: Math.max(0, wau - newWeek),
      returningMonth: Math.max(0, mau - newMonth),
      dauDays: chartAgo.map((ago, i) => ({
        day: new Date(localToday.getFullYear(), localToday.getMonth(), localToday.getDate() - ago).getTime(),
        count: dauCounts[i],
      })),
      sources: [
        ...ACQUISITION_SOURCES.map((source, i) => ({ source, count: sourceCounts[i] })),
        { source: 'unknown' as const, count: Math.max(0, tracked - attributed) },
      ],
      tracked,
    };
  });
}

// ---------------------------------------------------------------- Retention

export const RETENTION_DAYS = [1, 7, 14, 30] as const;
export type RetentionDay = (typeof RETENTION_DAYS)[number];

export interface CohortRow {
  /** First and last day of the cohort week (day numbers). */
  from: number;
  to: number;
  size: number;
  /** Share of the cohort active again on exactly day N; null while that window is still open. */
  rates: Record<RetentionDay, number | null>;
}

export interface RetentionLookups {
  /** Members whose first counted day is `day`. */
  cohortSize: (day: number) => Promise<number>;
  /** Of those, how many were active again on day + n. */
  retained: (day: number, n: number) => Promise<number>;
}

/**
 * Weekly cohorts of members by first counted day. A rate is only worked out once every day in the
 * cohort has lived through the whole window (last day + N is already over), so an open window shows
 * "no data yet" instead of a misleading low number.
 */
export async function computeRetention(
  trackingSince: number,
  today: number,
  lookups: RetentionLookups,
  maxCohorts = 4
): Promise<CohortRow[]> {
  const yesterday = addDays(today, -1);
  const weeks: { from: number; to: number }[] = [];
  for (let from = trackingSince; from <= yesterday; from = addDays(from, 7)) weeks.push({ from, to: Math.min(addDays(from, 6), yesterday) });
  const rows: CohortRow[] = [];
  for (const week of weeks.slice(-maxCohorts)) {
    const days: number[] = [];
    for (let d = week.from; d <= week.to; d = addDays(d, 1)) days.push(d);
    const sizes = await Promise.all(days.map((d) => lookups.cohortSize(d)));
    const size = sizes.reduce((a, b) => a + b, 0);
    const fullWeek = week.to === addDays(week.from, 6);
    const rates = {} as Record<RetentionDay, number | null>;
    for (const n of RETENTION_DAYS) {
      if (!fullWeek || size === 0 || addDays(week.to, n) > yesterday) {
        rates[n] = null;
        continue;
      }
      const kept = await Promise.all(days.map((d, i) => (sizes[i] > 0 ? lookups.retained(d, n) : Promise.resolve(0))));
      rates[n] = Math.round((kept.reduce((a, b) => a + b, 0) / size) * 100);
    }
    rows.push({ from: week.from, to: week.to, size, rates });
  }
  return rows;
}

export async function loadRetention(trackingSince: number, force = false, now: number = Date.now()): Promise<CohortRow[]> {
  return remember(`retention-${activityDayNumber(now)}`, force, async () => {
    if (!db) throw new Error('Firebase is not configured');
    const members = collection(db, 'member_activity');
    return computeRetention(trackingSince, activityDayNumber(now), {
      cohortSize: (day) => countOf(query(members, where('firstDay', '==', day))),
      retained: (day, n) =>
        countOf(query(members, and(where('firstDay', '==', day), where(dayField(`d${addDays(day, n)}`), '==', true)))),
    });
  });
}

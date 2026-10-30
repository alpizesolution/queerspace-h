import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, ensureAnonymousAuth } from '../lib/firebase.ts';
import {
  AcquisitionSource,
  activityDayKey,
  activityDayNumber,
  captureAcquisitionSource,
  isAcquisitionSource,
} from '../utils/acquisition.ts';

const LAST_DAY_KEY = 'queerspace_activity_day';
const CREATED_KEY = 'queerspace_activity_created';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 5 * 60_000;

export interface ActivityDeps {
  now: () => number;
  getUid: () => Promise<string | null>;
  exists: (uid: string) => Promise<boolean>;
  create: (uid: string, data: { firstDay: number; days: Record<string, true>; source?: AcquisitionSource }) => Promise<void>;
  addDay: (uid: string, dayKey: string) => Promise<void>;
  attributableSource: (uid: string, now: number) => Promise<AcquisitionSource | null>;
  store: { get: (key: string) => string | null; set: (key: string, value: string) => void };
  /** Called with a short error code only (never an id, name or message text). */
  report: (code: string) => void;
}

// Session state: after a failure, stop retrying for a while so a blocked or offline device never hammers Firestore.
let retryAt = 0;
const reported = new Set<string>();

export function resetActivityState() {
  retryAt = 0;
  reported.clear();
}

const errorCode = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code.replace(/^firestore\//, '') : 'unknown';
};

/**
 * Counts this member as active today. Never throws and never blocks the app: any failure (no permission, offline,
 * not a member yet) just returns false and is retried on a later open.
 *
 * Cost: one write a day. A device that has created its record skips the existence read and writes the day directly.
 */
export async function recordActivity(deps: ActivityDeps): Promise<boolean> {
  try {
    const now = deps.now();
    const dayKey = activityDayKey(now);
    if (deps.store.get(LAST_DAY_KEY) === dayKey) return false; // already counted today: no network at all
    if (now < retryAt) return false;

    const uid = await deps.getUid();
    if (!uid) return false;

    let done = false;
    if (deps.store.get(CREATED_KEY) === '1') {
      try {
        await deps.addDay(uid, dayKey);
        done = true;
      } catch (error) {
        // The record isn't there (new account on this device, or removed): fall back to checking and creating it.
        if (errorCode(error) !== 'not-found') throw error;
        deps.store.set(CREATED_KEY, '0');
      }
    }
    if (!done) {
      if (await deps.exists(uid)) {
        await deps.addDay(uid, dayKey);
      } else {
        const source = await deps.attributableSource(uid, now);
        await deps.create(uid, { firstDay: activityDayNumber(now), days: { [dayKey]: true }, ...(source ? { source } : {}) });
      }
      deps.store.set(CREATED_KEY, '1');
    }
    deps.store.set(LAST_DAY_KEY, dayKey);
    return true;
  } catch (error) {
    const code = errorCode(error);
    // A refusal by the rules (not a member yet, or rules not published) won't fix itself within this visit.
    retryAt = code === 'permission-denied' ? Number.POSITIVE_INFINITY : deps.now() + RETRY_AFTER_MS;
    if (!reported.has(code)) {
      reported.add(code);
      try {
        deps.report(code);
      } catch {
        // Reporting is best effort.
      }
    }
    return false;
  }
}

function localStore(): ActivityDeps['store'] {
  return {
    get: (key) => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set: (key, value) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Private mode: the next open simply tries again.
      }
    },
  };
}

/**
 * The source is only recorded for a profile created in the last week, so a long-standing member who
 * opens the app on a new device is never given a made-up source.
 */
async function attributableSource(uid: string, now: number): Promise<AcquisitionSource | null> {
  const source = captureAcquisitionSource();
  if (!isAcquisitionSource(source) || !db) return null;
  const profile = await getDoc(doc(db, 'users', uid, 'public', 'profile'));
  const createdAt = profile.data()?.createdAt;
  const createdMs = createdAt && typeof createdAt.toMillis === 'function' ? createdAt.toMillis() : 0;
  return createdMs && now - createdMs < WEEK_MS ? source : null;
}

/** The app's entry point: counts the signed-in member once a day. */
export function recordDailyActivity(): Promise<boolean> {
  if (!db) return Promise.resolve(false);
  const firestore = db;
  return recordActivity({
    now: Date.now,
    getUid: async () => (auth?.currentUser ?? (await ensureAnonymousAuth()))?.uid ?? null,
    exists: async (uid) => (await getDoc(doc(firestore, 'member_activity', uid))).exists(),
    create: (uid, data) => setDoc(doc(firestore, 'member_activity', uid), data),
    addDay: (uid, dayKey) => updateDoc(doc(firestore, 'member_activity', uid), { [`days.${dayKey}`]: true }),
    attributableSource,
    store: localStore(),
    report: (code) => console.warn(`[Activity] not recorded (${code})`),
  });
}

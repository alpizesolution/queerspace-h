import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, ensureAnonymousAuth } from '../lib/firebase.ts';
import { activityDayKey, activityDayNumber, captureAcquisitionSource, isAcquisitionSource } from '../utils/acquisition.ts';

const LAST_DAY_KEY = 'queerspace_activity_day';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function readLastDay(): string | null {
  try {
    return localStorage.getItem(LAST_DAY_KEY);
  } catch {
    return null;
  }
}

/**
 * Counts this member as active today: one document per member (member_activity/{uid}) holding the days
 * they opened the app, so nothing is written twice in a day. It stores no content, only day markers, and
 * the one-time acquisition source for members who joined after tracking began.
 */
export async function recordDailyActivity(now: number = Date.now()): Promise<boolean> {
  if (!db) return false;
  const dayKey = activityDayKey(now);
  if (readLastDay() === dayKey) return false;
  try {
    const user = auth?.currentUser ?? (await ensureAnonymousAuth());
    if (!user) return false;
    const ref = doc(db, 'member_activity', user.uid);
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, { [`days.${dayKey}`]: true });
    } else {
      const source = await attributableSource(user.uid, now);
      await setDoc(ref, {
        firstDay: activityDayNumber(now),
        days: { [dayKey]: true },
        ...(source ? { source } : {}),
      });
    }
    try {
      localStorage.setItem(LAST_DAY_KEY, dayKey);
    } catch {
      // Private mode: the next open simply tries again.
    }
    return true;
  } catch {
    // Not a member yet, offline, or the rules turned it down: nothing to do and nothing to show.
    return false;
  }
}

/**
 * The source is only recorded for a profile created in the last week, so a long-standing member who
 * opens the app on a new device is never given a made-up source.
 */
async function attributableSource(uid: string, now: number) {
  const source = captureAcquisitionSource();
  if (!isAcquisitionSource(source) || !db) return null;
  const profile = await getDoc(doc(db, 'users', uid, 'public', 'profile'));
  const createdAt = profile.data()?.createdAt;
  const createdMs = createdAt && typeof createdAt.toMillis === 'function' ? createdAt.toMillis() : 0;
  return createdMs && now - createdMs < WEEK_MS ? source : null;
}

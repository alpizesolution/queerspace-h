import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db, ensureAnonymousAuth, isFirebaseConfigured } from '../lib/firebase.ts';
import { Intention, PartnerProfile, UserPreferences } from '../types.ts';
import { locationsOverlap, NATIONWIDE_OPTION } from '../utils/philippines-locations.ts';
import { endCloudConversation } from './chatService.ts';
import { isValidAvatar } from '../utils/avatar.ts';

/**
 * Live 1-on-1 matchmaking backed by a Firestore waiting queue.
 *
 * Each searching user owns `match_queue/{uid}` with status 'waiting' and a heartbeat.
 * Any searcher may claim another fresh waiting entry inside a transaction that also
 * creates the conversation, so two people are only ever paired once and both clients
 * learn the same conversation ID (the claimed user via a listener on their own entry).
 */

const QUEUE = 'match_queue';
const HEARTBEAT_MS = 10_000;
const STALE_AFTER_MS = 30_000;
/** Ages people can enter; QUEERSPACE is 18+ (must match firestore.rules). */
export const MIN_AGE = 18;
export const MAX_AGE = 99;
/** Queue scans start quick and slow down while nobody else is waiting, to save reads. */
const CLAIM_INTERVAL_MS = 3_000;
const CLAIM_INTERVAL_MAX_MS = 12_000;
/** Next scan delay: grows 1.5x per empty scan, capped, with a little jitter so clients spread out. */
export function nextClaimDelay(emptyScans: number, random: number = Math.random()): number {
  const base = Math.min(CLAIM_INTERVAL_MAX_MS, CLAIM_INTERVAL_MS * 1.5 ** emptyScans);
  return Math.round(base * (0.85 + random * 0.3));
}

export interface LiveMatch {
  partner: PartnerProfile;
  convId: string;
}

export interface LiveMatchHandlers {
  onMatched: (match: LiveMatch) => void;
  onError: (message: string) => void;
}

export const isLiveMatchingAvailable = () => isFirebaseConfigured && Boolean(db) && Boolean(auth);

function toMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof (value as Timestamp).toMillis === 'function') return (value as Timestamp).toMillis();
  return 0;
}

/** Fresh = heartbeat within the stale window. Pending server timestamps count as fresh. */
export function isFreshQueueEntry(data: { heartbeatAt?: unknown }, now: number = Date.now()): boolean {
  const beat = toMillis(data.heartbeatAt);
  return beat === 0 || now - beat < STALE_AFTER_MS;
}

/** Age details a queue entry carries: the person's age and, with the age filter on, the range they want. */
export interface QueueAgePrefs {
  age?: number;
  ageMin?: number;
  ageMax?: number;
}

/**
 * Everything a queue entry carries for filtering. `areas` and `expr` describe the person (only
 * when they show them on their profile); `wantAreas` and `wantExpr` are their filters.
 */
export interface QueueMatchPrefs extends QueueAgePrefs {
  areas?: string[];
  wantAreas?: string[];
  expr?: string[];
  wantExpr?: string[];
  /** Chat topics, lowercased. People who picked topics only match people sharing one. */
  topics?: string[];
  /** What they're looking for. Only the same intention matches, so "open" meets "open". */
  intent?: Intention;
}

/** Valid intentions (must match firestore.rules). */
const INTENTIONS: Record<Intention, true> = { friendship: true, dating: true, casual: true, deep_talk: true, open: true };

/** Longest list a queue entry may carry (must match firestore.rules). */
export const MAX_QUEUE_LIST = 20;

/** Both people fit each other's age range (when either has one). A range needs a known age to match. */
export function agesCompatible(a: QueueAgePrefs, b: QueueAgePrefs): boolean {
  const fits = (range: QueueAgePrefs, age?: number) =>
    range.ageMin === undefined || range.ageMax === undefined
      ? true
      : typeof age === 'number' && age >= range.ageMin && age <= range.ageMax;
  return fits(a, b.age) && fits(b, a.age);
}

/**
 * Both people want the same thing (intention), pass each other's location and gender expression
 * filters, and share a topic when either picked any (so "open to anything" chatters don't land in
 * a topic match). Someone who didn't share a location or expression is never excluded, matching
 * the setup screen's promise.
 */
export function filtersCompatible(a: QueueMatchPrefs, b: QueueMatchPrefs): boolean {
  const fitsArea = (want?: string[], theirs?: string[]) =>
    !want?.length || !theirs?.length || theirs.some((area) => want.some((w) => locationsOverlap(w, area)));
  const fitsExpr = (want?: string[], theirs?: string[]) =>
    !want?.length || !theirs?.length || theirs.some((e) => want.includes(e));
  const sharesTopic = () =>
    (!a.topics?.length && !b.topics?.length) || (a.topics ?? []).some((t) => b.topics?.includes(t));
  return (
    agesCompatible(a, b) &&
    (a.intent ?? 'open') === (b.intent ?? 'open') &&
    sharesTopic() &&
    fitsArea(a.wantAreas, b.areas) &&
    fitsArea(b.wantAreas, a.areas) &&
    fitsExpr(a.wantExpr, b.expr) &&
    fitsExpr(b.wantExpr, a.expr)
  );
}

/** Builds the queue entry's filter fields from setup preferences. */
export function queueMatchFields(prefs: Partial<UserPreferences>): QueueMatchPrefs {
  const valid = (n?: number) => typeof n === 'number' && Number.isInteger(n) && n >= MIN_AGE && n <= MAX_AGE;
  const fields: QueueMatchPrefs = {};
  if (valid(prefs.age)) fields.age = prefs.age;
  if (prefs.applyAgeFilter && valid(prefs.ageMin) && valid(prefs.ageMax) && prefs.ageMin! <= prefs.ageMax!) {
    fields.ageMin = prefs.ageMin;
    fields.ageMax = prefs.ageMax;
  }

  const areas = (prefs.locationSelection ?? []).filter((a) => a && a !== NATIONWIDE_OPTION).slice(0, MAX_QUEUE_LIST);
  if (areas.length && prefs.showLocationOnProfile !== false) fields.areas = areas;
  if (areas.length && prefs.applyLocationFilter) fields.wantAreas = areas;

  // My Type compares against the member's explicitly chosen public My Vibe label.
  // SOGIE identity fields are never used as matching criteria.
  if (prefs.myVibe?.trim()) fields.expr = [prefs.myVibe.trim().slice(0, 24)];
  const wantExpr = prefs.preferredGenderExpressions ?? [];
  if (prefs.applyGenderExpressionFilter && wantExpr.length && !wantExpr.includes('Any / No preference')) {
    fields.wantExpr = wantExpr.slice(0, MAX_QUEUE_LIST);
  }
  if (prefs.intention && prefs.intention in INTENTIONS) fields.intent = prefs.intention;
  const topics = [...new Set((prefs.topics ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if (topics.length) fields.topics = topics.slice(0, MAX_QUEUE_LIST);
  return fields;
}

/** Oldest-first candidate order, ignoring self, blocked users, stale entries and filter mismatches. */
export function pickQueueCandidates(
  entries: { id: string; data: { status?: string; heartbeatAt?: unknown; createdAt?: unknown } & QueueMatchPrefs }[],
  selfUid: string,
  excludeIds: string[],
  now: number = Date.now(),
  mine: QueueMatchPrefs = {}
): string[] {
  const excluded = new Set([selfUid, ...excludeIds]);
  return entries
    .filter((e) => e.data.status === 'waiting' && !excluded.has(e.id) && isFreshQueueEntry(e.data, now))
    .filter((e) => filtersCompatible(mine, e.data))
    .sort((a, b) => toMillis(a.data.createdAt) - toMillis(b.data.createdAt))
    .map((e) => e.id);
}

const AVATAR_COLORS = ['#8D426B', '#7a3159', '#5a2548', '#8e547e', '#6b3a78'];

async function loadPartnerProfile(partnerId: string): Promise<PartnerProfile> {
  const fallback: PartnerProfile = {
    id: partnerId,
    displayName: 'Anonymous',
    pronouns: 'she/they',
    intention: 'open',
    topics: [],
    region: '',
    avatarColor: AVATAR_COLORS[partnerId.charCodeAt(0) % AVATAR_COLORS.length],
    showLocationOnProfile: false,
    showSogieOnProfile: false,
  };
  if (!db) return fallback;
  try {
    const snap = await getDoc(doc(db, 'users', partnerId, 'public', 'profile'));
    if (!snap.exists()) return fallback;
    const data = snap.data();
    const showLocation = Boolean(data.showLocationOnProfile);
    return {
      ...fallback,
      displayName: data.displayName ? String(data.displayName).slice(0, 30) : fallback.displayName,
      avatar: isValidAvatar(data.avatar) ? data.avatar : undefined,
      pronouns: data.pronouns ? String(data.pronouns).slice(0, 20) : fallback.pronouns,
      age: typeof data.age === 'number' && data.age >= 18 && data.age <= 99 ? Math.floor(data.age) : undefined,
      aboutMe: typeof data.aboutMe === 'string' ? data.aboutMe.slice(0, 160) : undefined,
      myVibe: typeof data.myVibe === 'string' ? data.myVibe.slice(0, 24) : undefined,
      intention: (data.intention as Intention) || 'open',
      topics: Array.isArray(data.topics) ? data.topics.slice(0, 8) : [],
      region: showLocation && data.region ? String(data.region) : '',
      location: showLocation && data.region ? String(data.region) : undefined,
      showLocationOnProfile: showLocation,
      sexualOrientation: data.showSexualOrientationOnProfile && typeof data.sexualOrientation === 'string' ? data.sexualOrientation.slice(0, 40) : undefined,
      genderIdentity: data.showGenderIdentityOnProfile && typeof data.genderIdentity === 'string' ? data.genderIdentity.slice(0, 40) : undefined,
      genderExpression: data.showGenderExpressionOnProfile && Array.isArray(data.genderExpression) ? data.genderExpression.filter((v): v is string => typeof v === 'string').slice(0, 8) as PartnerProfile['genderExpression'] : undefined,
      showSexualOrientationOnProfile: Boolean(data.showSexualOrientationOnProfile),
      showGenderIdentityOnProfile: Boolean(data.showGenderIdentityOnProfile),
      showGenderExpressionOnProfile: Boolean(data.showGenderExpressionOnProfile),
    };
  } catch {
    return fallback;
  }
}

/**
 * Joins the live queue and keeps trying to pair until matched or cancelled.
 * Returns a cancel function that leaves the queue.
 */
export function joinLiveMatchQueue(
  excludeIds: string[],
  handlers: LiveMatchHandlers,
  matchPrefs: QueueMatchPrefs = {}
): () => void {
  let cancelled = false;
  let matched = false;
  let unsubscribeSelf: (() => void) | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let claimTimer: ReturnType<typeof setTimeout> | null = null;
  let emptyScans = 0;
  // Fresh-only scans need the (status, heartbeatAt) index; until it exists, fall back to the old scan.
  let freshQueryFailed = false;
  let claiming = false;
  let uid: string | null = null;

  const stopTimers = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (claimTimer) clearTimeout(claimTimer);
    heartbeatTimer = claimTimer = null;
  };

  const leaveQueue = () => {
    stopTimers();
    unsubscribeSelf?.();
    unsubscribeSelf = null;
    if (db && uid && !matched) {
      const firestore = db;
      const myRef = doc(firestore, QUEUE, uid);
      // If someone claimed us at the last moment, end that chat so they aren't left waiting.
      runTransaction(firestore, async (tx) => {
        const snap = await tx.get(myRef);
        const data = snap.data();
        tx.delete(myRef);
        return data?.status === 'matched' && typeof data.convId === 'string' ? data.convId : null;
      })
        .then((convId) => {
          if (convId) endCloudConversation(convId, 'ended');
        })
        .catch(() => deleteDoc(myRef).catch(() => {}));
    }
    window.removeEventListener('pagehide', leaveQueue);
  };

  const finish = async (partnerId: string, convId: string) => {
    if (matched || cancelled) return;
    matched = true;
    stopTimers();
    unsubscribeSelf?.();
    unsubscribeSelf = null;
    window.removeEventListener('pagehide', leaveQueue);
    if (db && uid) deleteDoc(doc(db, QUEUE, uid)).catch(() => {});
    const partner = await loadPartnerProfile(partnerId);
    if (!cancelled) handlers.onMatched({ partner, convId });
  };

  const tryClaim = async () => {
    if (!db || !uid || claiming || matched || cancelled) return;
    claiming = true;
    const firestore = db;
    const me = uid;
    try {
      const waiting = query(collection(firestore, QUEUE), where('status', '==', 'waiting'));
      const cutoff = Timestamp.fromMillis(Date.now() - STALE_AFTER_MS);
      let snap;
      if (!freshQueryFailed) {
        try {
          // Only entries with a recent heartbeat, so abandoned ones never cost a read.
          snap = await getDocs(query(waiting, where('heartbeatAt', '>', cutoff), limit(10)));
        } catch (err) {
          freshQueryFailed = true;
          console.warn('[LiveMatch] Fresh queue scan unavailable (missing index?), falling back:', err);
        }
      }
      snap = snap ?? (await getDocs(query(waiting, limit(25))));
      const candidates = pickQueueCandidates(
        snap.docs.map((d) => ({ id: d.id, data: d.data() })),
        me,
        excludeIds,
        Date.now(),
        matchPrefs
      );
      emptyScans = candidates.length ? 0 : emptyScans + 1;

      for (const partnerId of candidates) {
        if (matched || cancelled) return;
        const convRef = doc(collection(firestore, 'conversations'));
        try {
          await runTransaction(firestore, async (tx) => {
            const myRef = doc(firestore, QUEUE, me);
            const theirRef = doc(firestore, QUEUE, partnerId);
            const [mine, theirs] = await Promise.all([tx.get(myRef), tx.get(theirRef)]);
            if (!mine.exists() || mine.data().status !== 'waiting') throw new Error('self-not-waiting');
            if (!theirs.exists() || theirs.data().status !== 'waiting' || !isFreshQueueEntry(theirs.data()) || !filtersCompatible(matchPrefs, theirs.data())) {
              throw new Error('partner-unavailable');
            }
            tx.set(convRef, {
              participants: [me, partnerId].sort(),
              status: 'active',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            tx.update(theirRef, { status: 'matched', partnerId: me, convId: convRef.id, updatedAt: serverTimestamp() });
            tx.update(myRef, { status: 'matched', partnerId, convId: convRef.id, updatedAt: serverTimestamp() });
          });
          await finish(partnerId, convRef.id);
          return;
        } catch {
          // Someone else claimed them (or us) first; try the next candidate.
        }
      }
    } catch (err) {
      console.warn('[LiveMatch] Queue scan notice:', err);
    } finally {
      claiming = false;
    }
  };

  (async () => {
    if (!isLiveMatchingAvailable() || !db) {
      handlers.onError("Live matching isn't available right now.");
      return;
    }
    const user = auth?.currentUser ?? (await ensureAnonymousAuth());
    if (cancelled) return;
    if (!user) {
      handlers.onError("Couldn't connect. Check your connection and try again.");
      return;
    }
    uid = user.uid;
    const myRef = doc(db, QUEUE, uid);

    try {
      await setDoc(myRef, {
        status: 'waiting',
        partnerId: null,
        convId: null,
        createdAt: serverTimestamp(),
        heartbeatAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...matchPrefs,
      });
    } catch (err) {
      console.warn('[LiveMatch] Could not join queue:', err);
      if (!cancelled) handlers.onError("Couldn't join matchmaking. Please try again.");
      return;
    }
    if (cancelled) {
      deleteDoc(myRef).catch(() => {});
      return;
    }

    window.addEventListener('pagehide', leaveQueue);

    // Someone else may claim us: watch our own entry.
    unsubscribeSelf = onSnapshot(
      myRef,
      (snap) => {
        const data = snap.data();
        if (!data || data.status !== 'matched' || !data.partnerId || !data.convId) return;
        if (excludeIds.includes(data.partnerId)) {
          // Matched by someone we blocked: end it quietly and keep waiting.
          endCloudConversation(data.convId, 'ended');
          updateDoc(myRef, {
            status: 'waiting',
            partnerId: null,
            convId: null,
            heartbeatAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }).catch(() => {});
          return;
        }
        finish(data.partnerId, data.convId);
      },
      (err) => console.warn('[LiveMatch] Queue listener notice:', err)
    );

    heartbeatTimer = setInterval(() => {
      if (!db || !uid || matched) return;
      updateDoc(doc(db, QUEUE, uid), { heartbeatAt: serverTimestamp() }).catch(() => {});
    }, HEARTBEAT_MS);

    const scheduleClaim = () => {
      if (matched || cancelled) return;
      // A hidden tab still gets matched by others (its heartbeat keeps it fresh), so it scans slowly.
      claimTimer = setTimeout(async () => {
        await tryClaim();
        scheduleClaim();
      }, document.visibilityState === 'hidden' ? CLAIM_INTERVAL_MAX_MS : nextClaimDelay(emptyScans));
    };
    tryClaim().then(scheduleClaim);
  })();

  return () => {
    cancelled = true;
    leaveQueue();
  };
}

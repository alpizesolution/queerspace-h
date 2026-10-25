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
import { Intention, PartnerProfile } from '../types.ts';
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

/** Oldest-first candidate order, ignoring self, blocked users and stale entries. */
export function pickQueueCandidates(
  entries: { id: string; data: { status?: string; heartbeatAt?: unknown; createdAt?: unknown } }[],
  selfUid: string,
  excludeIds: string[],
  now: number = Date.now()
): string[] {
  const excluded = new Set([selfUid, ...excludeIds]);
  return entries
    .filter((e) => e.data.status === 'waiting' && !excluded.has(e.id) && isFreshQueueEntry(e.data, now))
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
      intention: (data.intention as Intention) || 'open',
      topics: Array.isArray(data.topics) ? data.topics.slice(0, 8) : [],
      region: showLocation && data.region ? String(data.region) : '',
      location: showLocation && data.region ? String(data.region) : undefined,
      showLocationOnProfile: showLocation,
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
export function joinLiveMatchQueue(excludeIds: string[], handlers: LiveMatchHandlers): () => void {
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
        excludeIds
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
            if (!theirs.exists() || theirs.data().status !== 'waiting' || !isFreshQueueEntry(theirs.data())) {
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

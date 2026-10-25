import { collection, deleteDoc, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';
import { auth, db, ensureAnonymousAuth } from '../lib/firebase.ts';

/**
 * suspensions/{uid} pauses an account: the rules stop it from matching, chatting and posting
 * publicly, while it can still read and message support (firestore.rules section 8).
 * Underage reports from a real chat partner create one automatically; admins add and lift
 * them from the Inbox.
 */

/** The report reason that pauses the reported partner right away. */
export const UNDERAGE_REPORT_REASON = 'Underage participant (violating 18+ policy)';

export type SuspensionSource = 'admin' | 'auto-underage';

export interface Suspension {
  uid: string;
  source: SuspensionSource;
  reason: string;
  createdAt: number;
}

function toSuspension(uid: string, data: Record<string, unknown>): Suspension {
  const created = data.createdAt as Timestamp | undefined;
  return {
    uid,
    source: data.source === 'admin' ? 'admin' : 'auto-underage',
    reason: String(data.reason ?? ''),
    createdAt: typeof created?.toMillis === 'function' ? created.toMillis() : 0,
  };
}

/** One read on app open: is this device's account paused? */
export async function getMySuspension(): Promise<Suspension | null> {
  if (!db) return null;
  try {
    const user = auth?.currentUser ?? (await ensureAnonymousAuth());
    if (!user) return null;
    const snap = await getDoc(doc(db, 'suspensions', user.uid));
    return snap.exists() ? toSuspension(user.uid, snap.data()) : null;
  } catch {
    return null;
  }
}

/** Pauses a chat partner reported as underage, until an admin reviews the report. */
export async function autoSuspendPartner(partnerId: string, convId: string): Promise<boolean> {
  const me = auth?.currentUser;
  if (!db || !me) return false;
  try {
    await setDoc(doc(db, 'suspensions', partnerId), {
      source: 'auto-underage',
      reason: UNDERAGE_REPORT_REASON,
      reporterId: me.uid,
      convId,
      createdAt: serverTimestamp(),
    });
    return true;
  } catch (err) {
    // Already suspended (the doc exists) or not allowed: the report itself still went through.
    console.warn('[Suspension] Auto-suspend notice:', err);
    return false;
  }
}

// ---------------------------------------------------------------- Admin side

export async function loadSuspensions(): Promise<Record<string, Suspension>> {
  if (!db) return {};
  const snap = await getDocs(query(collection(db, 'suspensions'), limit(500)));
  return Object.fromEntries(snap.docs.map((d) => [d.id, toSuspension(d.id, d.data())]));
}

export async function suspendUser(uid: string, reason: string, reportId?: string): Promise<void> {
  if (!db) return;
  await setDoc(doc(db, 'suspensions', uid), {
    source: 'admin',
    reason: reason.slice(0, 300) || 'Suspended by the team',
    createdAt: serverTimestamp(),
    ...(reportId ? { reportId } : {}),
  });
}

export async function liftSuspension(uid: string): Promise<void> {
  if (!db) return;
  await deleteDoc(doc(db, 'suspensions', uid));
}

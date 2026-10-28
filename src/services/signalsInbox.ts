import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase.ts';

/** What signalsInbox/{uid} holds: a revision counter and pending invitation ids with their expiry. */
export interface SignalsInboxSnapshot {
  rev: number;
  /** Non-expired pending invitation ids addressed to this member, oldest id order not implied. */
  pendingIds: string[];
}

export const EMPTY_INBOX: SignalsInboxSnapshot = { rev: 0, pendingIds: [] };

const toMillis = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const fn = (value as { toMillis?: () => number } | null)?.toMillis;
  return typeof fn === 'function' ? fn.call(value) : null;
};

/** Turns the raw inbox document into a safe snapshot; expired or malformed entries never count. */
export function parseInbox(data: unknown, now: number = Date.now()): SignalsInboxSnapshot {
  const raw = (data ?? {}) as { rev?: unknown; pending?: unknown };
  const rev = typeof raw.rev === 'number' && Number.isFinite(raw.rev) ? raw.rev : 0;
  const pending = raw.pending && typeof raw.pending === 'object' ? (raw.pending as Record<string, unknown>) : {};
  const pendingIds = Object.entries(pending)
    .filter(([, expires]) => {
      const at = toMillis(expires);
      return at !== null && at > now;
    })
    .map(([id]) => id);
  return { rev, pendingIds };
}

/** Ids that have never been announced before; `seen` is updated so each request notifies once. */
export function takeNewIds(ids: string[], seen: Set<string>): string[] {
  const fresh = ids.filter((id) => !seen.has(id));
  fresh.forEach((id) => seen.add(id));
  return fresh;
}

/**
 * Live listener on the signed-in member's own inbox doc. Firestore rules allow only that member to read it,
 * and it contains no sender identity. Returns an unsubscribe function.
 */
export function subscribeSignalsInbox(
  uid: string,
  onData: (data: unknown) => void,
  onError: (error: Error) => void
): () => void {
  if (!db) return () => {};
  return onSnapshot(
    doc(db, 'signalsInbox', uid),
    (snap) => onData(snap.exists() ? snap.data() : null),
    (err) => onError(err)
  );
}

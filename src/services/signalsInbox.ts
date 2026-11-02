import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase.ts';

/** What signalsInbox/{uid} holds: a revision counter and pending invitation ids with their expiry. */
export interface SignalsInboxSnapshot {
  rev: number;
  /** Non-expired pending invitation ids addressed to this member, oldest id order not implied. */
  pendingIds: string[];
  /** Unread incoming messages per pair id; pairs with none are absent. */
  unread: Record<string, number>;
  /** Pair ids whose "your request was accepted" notification has not been opened yet. */
  acceptedUnread: string[];
  /** Connection requests waiting for this member's answer (as the author of a Looking For post). */
  requestIds: string[];
}

export const EMPTY_INBOX: SignalsInboxSnapshot = { rev: 0, pendingIds: [], unread: {}, acceptedUnread: [], requestIds: [] };

/** Badge text for an unread count: nothing at zero, the number up to 99, then "99+". */
export function formatUnread(count: number | undefined): string | null {
  if (!count || !Number.isFinite(count) || count < 1) return null;
  return count > 99 ? '99+' : String(Math.floor(count));
}

const toMillis = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const fn = (value as { toMillis?: () => number } | null)?.toMillis;
  return typeof fn === 'function' ? fn.call(value) : null;
};

/** Turns the raw inbox document into a safe snapshot; expired or malformed entries never count. */
export function parseInbox(data: unknown, now: number = Date.now()): SignalsInboxSnapshot {
  const raw = (data ?? {}) as { rev?: unknown; pending?: unknown; unread?: unknown; notifications?: unknown; requests?: unknown };
  const rev = typeof raw.rev === 'number' && Number.isFinite(raw.rev) ? raw.rev : 0;
  const pending = raw.pending && typeof raw.pending === 'object' ? (raw.pending as Record<string, unknown>) : {};
  const pendingIds = Object.entries(pending)
    .filter(([, expires]) => {
      const at = toMillis(expires);
      return at !== null && at > now;
    })
    .map(([id]) => id);
  const unread: Record<string, number> = {};
  if (raw.unread && typeof raw.unread === 'object') {
    for (const [pairId, count] of Object.entries(raw.unread as Record<string, unknown>)) {
      if (typeof count === 'number' && Number.isFinite(count) && count >= 1) unread[pairId] = Math.floor(count);
    }
  }
  const acceptedUnread: string[] = [];
  if (raw.notifications && typeof raw.notifications === 'object') {
    for (const [pairId, note] of Object.entries(raw.notifications as Record<string, unknown>)) {
      const entry = note as { type?: unknown; read?: unknown } | null;
      if (entry && entry.type === 'accepted' && entry.read !== true) acceptedUnread.push(pairId);
    }
  }
  // Waiting connection requests, like invitations, carry their expiry; an expired one no longer counts.
  const waiting = raw.requests && typeof raw.requests === 'object' ? (raw.requests as Record<string, unknown>) : {};
  const requestIds = Object.entries(waiting)
    .filter(([, expires]) => {
      const at = toMillis(expires);
      return at !== null && at > now;
    })
    .map(([id]) => id);
  return { rev, pendingIds, unread, acceptedUnread, requestIds };
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

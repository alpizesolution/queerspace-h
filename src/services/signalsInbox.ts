import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase.ts';

/** What signalsInbox/{uid} holds: a revision counter and pending invitation ids with their expiry. */
export interface SignalsInboxSnapshot {
  rev: number;
  /** Non-expired pending invitation ids addressed to this member, oldest id order not implied. */
  pendingIds: string[];
  /** Unread incoming messages per pair id; pairs with none are absent. */
  unread: Record<string, number>;
  /** The latest message of each connection, as a short line, who it is from, and when. Pairs with no messages are absent. */
  last: Record<string, InboxPreview>;
  /** Pair ids whose "your request was accepted" notification has not been opened yet. */
  acceptedUnread: string[];
  /** Connection requests waiting for this member's answer (as the author of a Looking For post). */
  requestIds: string[];
}

export interface InboxPreview {
  text: string;
  /** True when the current member wrote it. */
  mine: boolean;
  /** When it was sent (ms), or null while the server time is not known yet. */
  at: number | null;
}

export const EMPTY_INBOX: SignalsInboxSnapshot = { rev: 0, pendingIds: [], unread: {}, last: {}, acceptedUnread: [], requestIds: [] };

/**
 * Unread incoming messages across every connection, for the Signals badge. A conversation that is on screen right now is left
 * out: the reader is looking at it, and the server marks it read within moments, so it should not flash on the tab bar.
 */
export function totalUnread(unread: Record<string, number>, openPairId: string | null = null): number {
  let total = 0;
  for (const [pairId, count] of Object.entries(unread)) {
    if (pairId !== openPairId && Number.isFinite(count) && count >= 1) total += Math.floor(count);
  }
  return total;
}

/**
 * Active connections as the inbox shows them: ones with unread messages first, then by latest activity (newest first). A
 * connection with no messages yet counts from when it began. The sort is stable, so equal ones keep the order they came in.
 */
export function sortByActivity<T extends { id: string; createdAt: string | null }>(
  pairs: readonly T[],
  unread: Record<string, number>,
  last: Record<string, InboxPreview>
): T[] {
  const activity = (pair: T) => last[pair.id]?.at ?? (pair.createdAt ? Date.parse(pair.createdAt) || 0 : 0);
  const hasUnread = (pair: T) => ((unread[pair.id] ?? 0) >= 1 ? 1 : 0);
  return pairs
    .map((pair, index) => ({ pair, index }))
    .sort((a, b) => hasUnread(b.pair) - hasUnread(a.pair) || activity(b.pair) - activity(a.pair) || a.index - b.index)
    .map((item) => item.pair);
}

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
  const raw = (data ?? {}) as { rev?: unknown; pending?: unknown; unread?: unknown; last?: unknown; notifications?: unknown; requests?: unknown };
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
  const last: Record<string, InboxPreview> = {};
  if (raw.last && typeof raw.last === 'object') {
    for (const [pairId, entry] of Object.entries(raw.last as Record<string, unknown>)) {
      const item = entry as { text?: unknown; mine?: unknown; at?: unknown } | null;
      if (item && typeof item.text === 'string' && item.text) last[pairId] = { text: item.text.slice(0, 120), mine: item.mine === true, at: toMillis(item.at) };
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
  return { rev, pendingIds, unread, last, acceptedUnread, requestIds };
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

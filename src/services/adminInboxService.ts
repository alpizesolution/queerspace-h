import { Firestore, Timestamp, collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../lib/firebase.ts';

/**
 * Suggestions and reports, kept live for the admin panel.
 *
 * Each page listens to the newest INBOX_WINDOW items of one collection (one listener per collection, created when the
 * admin panel opens and removed when it closes). The initial load reads the window once; after that Firestore only sends
 * what changes, so a new submission or a status change costs one read per open admin session. Counts and the
 * toasts come from the same listener, so there are no extra writes and no notification collection.
 */
export const INBOX_WINDOW = 200;

export type SuggestionStatus = 'open' | 'reviewed' | 'in_progress' | 'implemented' | 'archived';
export type ReportStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';

export interface AdminSuggestion {
  id: string;
  category: string;
  text: string;
  createdAt: number;
  status: SuggestionStatus;
}

export interface AdminReport {
  id: string;
  reporterId: string;
  targetId: string;
  targetType: string;
  reason: string;
  createdAt: number;
  status: ReportStatus;
}

const SUGGESTION_STATUSES: readonly string[] = ['open', 'reviewed', 'in_progress', 'implemented', 'archived'];
const REPORT_STATUSES: readonly string[] = ['open', 'reviewing', 'resolved', 'dismissed'];

/** A new submission has no status and counts as New. The old single "done" is treated as Reviewed. */
export function toSuggestionStatus(value: unknown): SuggestionStatus {
  if (value === 'done') return 'reviewed';
  return typeof value === 'string' && SUGGESTION_STATUSES.includes(value) ? (value as SuggestionStatus) : 'open';
}

/** A new report has no status and counts as Open. The old single "done" is treated as Resolved. */
export function toReportStatus(value: unknown): ReportStatus {
  if (value === 'done') return 'resolved';
  return typeof value === 'string' && REPORT_STATUSES.includes(value) ? (value as ReportStatus) : 'open';
}

const millis = (value: unknown): number =>
  value && typeof (value as Timestamp).toMillis === 'function' ? (value as Timestamp).toMillis() : 0;

export function toAdminSuggestion(id: string, data: Record<string, unknown>): AdminSuggestion {
  return {
    id,
    category: String(data.category ?? 'other'),
    text: String(data.text ?? ''),
    createdAt: millis(data.createdAt),
    status: toSuggestionStatus(data.status),
  };
}

export function toAdminReport(id: string, data: Record<string, unknown>): AdminReport {
  return {
    id,
    reporterId: String(data.reporterId ?? ''),
    targetId: String(data.targetId ?? ''),
    targetType: String(data.targetType ?? ''),
    reason: String(data.reason ?? ''),
    createdAt: millis(data.timestamp),
    status: toReportStatus(data.status),
  };
}

// ---------------------------------------------------------------- Telling genuinely new submissions from old ones

export interface ArrivalTracker {
  /** Ids already accounted for: shown on load, or already announced. */
  seen: Set<string>;
  /** Newest submission time that existed when the panel opened; only something newer can be an arrival. */
  baseline: number;
  ready: boolean;
}

export const newArrivalTracker = (): ArrivalTracker => ({ seen: new Set(), baseline: 0, ready: false });

/**
 * Given the documents a snapshot added to the window, returns the ones that are genuinely new.
 * - The first snapshot is the baseline: everything in it already existed when the panel opened.
 * - After that, an item counts once (the seen set), only if it is newer than anything on screen at the start, and only
 *   while still pending. That keeps a reconnect, a re-subscribe, or an older item sliding into the window (because a
 *   newer one was deleted) from being announced.
 */
export function pickArrivals<T extends { id: string; createdAt: number }>(
  tracker: ArrivalTracker,
  added: T[],
  isPending: (item: T) => boolean
): T[] {
  if (!tracker.ready) {
    added.forEach((item) => {
      tracker.seen.add(item.id);
      tracker.baseline = Math.max(tracker.baseline, item.createdAt);
    });
    tracker.ready = true;
    return [];
  }
  const fresh: T[] = [];
  for (const item of added) {
    if (tracker.seen.has(item.id)) continue;
    tracker.seen.add(item.id);
    if (item.createdAt > tracker.baseline && isPending(item)) fresh.push(item);
  }
  return fresh;
}

// ---------------------------------------------------------------- The listener

export interface InboxHandlers<T> {
  /** The current window, newest first, after every change (including status changes made by other admins). */
  onItems: (items: T[]) => void;
  /** Items that arrived after the panel opened. */
  onArrivals: (items: T[]) => void;
  /** The listener stopped (for example, permissions). The caller decides when to try again. */
  onError: (error: unknown) => void;
}

export function subscribeInbox<T extends { id: string; createdAt: number }>(
  collectionName: 'suggestions' | 'reports',
  orderField: 'createdAt' | 'timestamp',
  map: (id: string, data: Record<string, unknown>) => T,
  isPending: (item: T) => boolean,
  tracker: ArrivalTracker,
  handlers: InboxHandlers<T>,
  firestore: Firestore | null = db
): () => void {
  if (!firestore) {
    handlers.onItems([]);
    return () => {};
  }
  const q = query(collection(firestore, collectionName), orderBy(orderField, 'desc'), limit(INBOX_WINDOW));
  return onSnapshot(
    q,
    { includeMetadataChanges: false },
    (snapshot) => {
      // A pending server timestamp reads as null until the server answers; the estimate keeps it in order meanwhile.
      const items = snapshot.docs.map((d) => map(d.id, d.data({ serverTimestamps: 'estimate' })));
      handlers.onItems(items);
      const added = snapshot
        .docChanges()
        .filter((change) => change.type === 'added')
        .map((change) => map(change.doc.id, change.doc.data({ serverTimestamps: 'estimate' })));
      const arrivals = pickArrivals(tracker, added, isPending);
      if (arrivals.length) handlers.onArrivals(arrivals);
    },
    (error) => handlers.onError(error)
  );
}

export const isNewSuggestion = (s: AdminSuggestion) => s.status === 'open';
export const isOpenReport = (r: AdminReport) => r.status === 'open';

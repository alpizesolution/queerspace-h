/**
 * Pure rules for the Signals inbox list: how pages of connections are merged, when what was loaded is still good enough to
 * show without asking again, and the page size. No React and no network, so it can be tested.
 */

/** How many connections the inbox asks for at a time. */
export const PAIR_PAGE_SIZE = 20;
/** How long a loaded inbox is trusted without being asked again, as long as nothing in the live inbox has changed. */
export const INBOX_CACHE_MS = 5 * 60 * 1000;
/** A request that has not answered in this long is treated as failed, so a loading state can never last forever. */
export const LIST_REQUEST_TIMEOUT_MS = 15_000;

export interface ListedPair {
  id: string;
  createdAt: string | null;
}

const timeOf = (value: string | null): number => (value ? Date.parse(value) || 0 : 0);

/**
 * Folds a freshly loaded first page into what is already on screen. The fresh page wins for everything it contains, and
 * connections from pages loaded further down are kept (so a refresh does not throw away what was scrolled to), but only
 * those that sit below the fresh page: anything that should have been in it and is not has gone.
 */
export function mergeFirstPage<T extends ListedPair>(current: T[], first: T[]): T[] {
  if (first.length === 0) return [];
  const ids = new Set(first.map((pair) => pair.id));
  const oldest = timeOf(first[first.length - 1].createdAt);
  const rest = current.filter((pair) => !ids.has(pair.id) && timeOf(pair.createdAt) <= oldest);
  return [...first, ...rest];
}

/** Adds a further page to the end, skipping anything already shown. */
export function appendPage<T extends { id: string }>(current: T[], next: T[]): T[] {
  const ids = new Set(current.map((pair) => pair.id));
  return [...current, ...next.filter((pair) => !ids.has(pair.id))];
}

export interface InboxCacheEntry<P, I> {
  pairs: P[];
  invitations: I[];
  nextCursor: string | null;
  /** The live inbox revision when this was loaded: while it is unchanged, nothing about the lists has changed. */
  rev: number | undefined;
  at: number;
}

/**
 * Whether a loaded inbox can be shown as it is. "fresh" needs no request at all: the live inbox says nothing has changed
 * since, and it is recent. "stale" is shown straight away and refreshed quietly behind it. "none" shows a skeleton.
 */
export function inboxFreshness(entry: { rev: number | undefined; at: number } | null, rev: number | undefined, now: number): 'fresh' | 'stale' | 'none' {
  if (!entry) return 'none';
  if (rev !== undefined && entry.rev === rev && now - entry.at < INBOX_CACHE_MS) return 'fresh';
  return 'stale';
}

/** Names of cached inboxes are per member, so one member's list can never be shown to another on the same device. */
export const inboxCacheKey = (uid: string | null | undefined): string | null => (uid ? `inbox:${uid}` : null);

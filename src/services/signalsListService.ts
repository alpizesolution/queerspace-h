import { auth } from '../lib/firebase.ts';
import { inboxCacheKey, LIST_REQUEST_TIMEOUT_MS, PAIR_PAGE_SIZE, type InboxCacheEntry } from '../utils/signalsList.ts';

/**
 * Reads of the Signals lists, shared by every screen that needs them. Two screens asking for the same list at the same
 * moment get one request, a request that never answers fails after a while instead of loading forever, and the last
 * inbox that was loaded is remembered for this session (and only for the member who loaded it) so coming back to the
 * inbox shows it straight away.
 */

export type SignalPartner = { displayName: string | null; avatar: string | null };

export type SignalInvitation = {
  id: string;
  senderId: string;
  recipientId: string;
  message: string;
  status: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';
  createdAt: string | null;
  expiresAt: string | null;
  direction: 'sent' | 'received';
  partner?: SignalPartner;
};

export type SignalPair = {
  id: string;
  invitationId: string;
  participants: string[];
  status: 'active' | 'ended';
  createdAt: string | null;
  endedAt: string | null;
  endedBy: string | null;
  partner?: SignalPartner;
};

export class ListRequestError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'ListRequestError';
  }
}

const MESSAGES: Record<string, string> = {
  unauthenticated: 'Your session needs to refresh. Please try again.',
  not_allowed: 'You are not allowed to change this connection.',
  pair_not_found: 'This connection could not be found.',
  pair_not_active: 'This connection is no longer active.',
  invitation_not_pending: 'This invitation was already answered.',
  invitation_not_found: 'This invitation is no longer available.',
  timeout: 'This is taking too long. Check your connection and try again.',
  internal_error: 'Signals is temporarily unavailable. Please try again.',
};

const inFlight = new Map<string, Promise<unknown>>();
/** Requests actually sent, by path, so a test or a measurement can see how many went out. */
export const requestCounts = new Map<string, number>();

export interface SharedDeps {
  fetchImpl?: typeof fetch;
  /** The signed-in member's token, or null when signed out. */
  getToken?: () => Promise<string | null>;
  timeoutMs?: number;
}

const currentToken = async (): Promise<string | null> => (auth?.currentUser ? auth.currentUser.getIdToken() : null);

/** One GET at a time per address: a second caller while it is out waits for the same answer. */
export function getShared<T>(path: string, deps: SharedDeps = {}): Promise<T> {
  const pending = inFlight.get(path);
  if (pending) return pending as Promise<T>;
  const { fetchImpl = fetch, getToken = currentToken, timeoutMs = LIST_REQUEST_TIMEOUT_MS } = deps;
  const request = (async (): Promise<T> => {
    const token = await getToken();
    if (!token) throw new ListRequestError('Sign in is still preparing. Please try again in a moment.', 'unauthenticated');
    requestCounts.set(path, (requestCounts.get(path) ?? 0) + 1);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(path, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new ListRequestError(MESSAGES[data.error ?? ''] || 'Something went wrong. Please try again.', data.error ?? 'failed');
      return data as T;
    } catch (error) {
      if (error instanceof ListRequestError) throw error;
      if (controller.signal.aborted) throw new ListRequestError(MESSAGES.timeout, 'timeout');
      throw new ListRequestError('Could not reach Signals. Check your connection and try again.', 'network');
    } finally {
      clearTimeout(timer);
    }
  })().finally(() => inFlight.delete(path));
  inFlight.set(path, request);
  return request;
}

export interface PairsPage { pairs: SignalPair[]; nextCursor: string | null }

/** A page of connections, newest first. An older server that ignores paging answers with everything and no cursor. */
export async function fetchPairsPage(before: string | null = null): Promise<PairsPage> {
  const query = `view=pairs&limit=${PAIR_PAGE_SIZE}${before ? `&before=${encodeURIComponent(before)}` : ''}`;
  const result = await getShared<{ pairs?: SignalPair[]; nextCursor?: string | null }>(`/api/signals?${query}`);
  return { pairs: Array.isArray(result.pairs) ? result.pairs : [], nextCursor: typeof result.nextCursor === 'string' ? result.nextCursor : null };
}

/** Invitations still waiting, which is all the inbox shows. */
export async function fetchPendingInvitations(): Promise<SignalInvitation[]> {
  const result = await getShared<{ invitations?: SignalInvitation[] }>('/api/signals?status=pending');
  return Array.isArray(result.invitations) ? result.invitations : [];
}

/** One connection, for a banner that needs a name: one read, not the whole list. */
export async function fetchPair(pairId: string): Promise<SignalPair | null> {
  const result = await getShared<{ pairs?: SignalPair[] }>(`/api/signals?view=pairs&pairId=${encodeURIComponent(pairId)}`);
  return (Array.isArray(result.pairs) ? result.pairs : []).find((pair) => pair.id === pairId) ?? null;
}

// ---------------------------------------------------------------------------------------------- the remembered inbox

type Entry = InboxCacheEntry<SignalPair, SignalInvitation>;
const remembered = new Map<string, Entry>();

export function readInboxCache(uid: string | null | undefined): Entry | null {
  const key = inboxCacheKey(uid);
  return key ? remembered.get(key) ?? null : null;
}

export function writeInboxCache(uid: string | null | undefined, entry: Entry): void {
  const key = inboxCacheKey(uid);
  if (key) remembered.set(key, entry);
}

export function clearInboxCache(uid?: string | null): void {
  const key = inboxCacheKey(uid);
  if (key) remembered.delete(key);
  else if (uid === undefined) remembered.clear();
}

/**
 * Pure helpers for connection requests: how they are ordered, named and explained. Kept free of React and the network so
 * they can be tested. The server (api/_requests.js) decides everything that matters; this only shapes what is shown.
 */
import type { LookingForIntention } from './lookingFor.ts';

export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired';
export type PostState = 'active' | 'paused' | 'removed';

export interface ConnectionRequest {
  id: string;
  status: RequestStatus;
  message: string;
  intention: LookingForIntention;
  createdAt: string | null;
  respondedAt: string | null;
  expiresAt: string | null;
  conversationId: string | null;
  /** The other member: who sent an incoming request, or who a sent one went to. */
  memberId: string;
  partner: { displayName: string | null; avatar: string | null; pronouns: string | null; about: string | null };
  post: { status: PostState; title: string | null; sensitive: boolean };
}

export interface RequestLists {
  incoming: ConnectionRequest[];
  sent: ConnectionRequest[];
}

export const EMPTY_REQUESTS: RequestLists = { incoming: [], sent: [] };

export const STATUS_LABELS: Record<RequestStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
};

/** Waiting requests first, then the rest; each group newest first. The server already sends newest first. */
export function orderRequests(list: ConnectionRequest[]): ConnectionRequest[] {
  const time = (r: ConnectionRequest) => (r.createdAt ? Date.parse(r.createdAt) : 0);
  return list.slice().sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || time(b) - time(a));
}

export const pendingCount = (list: ConnectionRequest[]): number => list.filter((r) => r.status === 'pending').length;

/** What to say about the post a request came from: its title, or why there is none. Sensitive titles are never shown. */
export function postReference(request: Pick<ConnectionRequest, 'post' | 'intention'>, intentionLabel: string): { text: string; notice: string | null } {
  const { post } = request;
  if (post.status === 'removed') return { text: `${intentionLabel} post`, notice: 'This post is no longer available.' };
  const text = post.sensitive ? `${intentionLabel} post (sensitive)` : post.title ? `“${post.title}”` : `${intentionLabel} post`;
  return { text, notice: post.status === 'paused' ? 'This post is not taking new requests right now.' : null };
}

const MESSAGES: Record<string, string> = {
  unauthenticated: 'Your session needs to refresh. Please try again.',
  not_allowed: 'You can’t send a request to this member.',
  account_unavailable: 'Requests are temporarily unavailable for this account.',
  post_unavailable: 'This post is no longer available.',
  post_paused: 'This member isn’t taking new requests right now.',
  already_pending: 'You already have a request waiting with this member.',
  already_connected: 'You are already connected with this member.',
  recently_declined: 'This member isn’t available for a new request right now.',
  rate_limited: 'You can send one request every 30 seconds. Take a breath and try again.',
  daily_limit: 'You’ve reached today’s limit for new requests. Please try again tomorrow.',
  too_many_pending: 'You have a lot of requests waiting. Wait for some answers, or withdraw a few, before sending more.',
  invalid_message: 'That message can’t be sent. Try shortening it.',
  request_not_pending: 'This request was already answered.',
  request_not_found: 'This request is no longer available.',
  internal_error: 'Requests are temporarily unavailable. Please try again.',
};

/** Words for an error code from the API. Unknown codes get a calm generic message, never raw text. */
export const requestErrorMessage = (code: unknown): string => MESSAGES[String(code)] ?? 'Something went wrong. Please try again.';

export const REQUEST_MESSAGE_MAX = 500;

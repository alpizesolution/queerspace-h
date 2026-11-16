/**
 * Pure helpers for connection requests: how they are ordered, named and explained. Kept free of React and the network so
 * they can be tested. The server (api/_requests.js) decides everything that matters; this only shapes what is shown.
 */
import { INTENTION_LABELS, type LookingForIntention, type LookingForPost } from './lookingFor.ts';
import type { CommunityPost } from '../types.ts';

export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired';
export type PostState = 'active' | 'paused' | 'removed';

export interface ConnectionRequest {
  id: string;
  status: RequestStatus;
  message: string;
  /** The Looking For intention the request is about; null when it is about a regular Cosmos post. */
  intention: LookingForIntention | null;
  createdAt: string | null;
  respondedAt: string | null;
  expiresAt: string | null;
  conversationId: string | null;
  /** The other member: who sent an incoming request, or who a sent one went to. */
  memberId: string;
  partner: { displayName: string | null; avatar: string | null; pronouns: string | null; about: string | null };
  /** `kind` is absent on answers from an older server, which only knew Looking For posts. */
  post: { kind?: 'looking_for' | 'community'; status: PostState; title: string | null; sensitive: boolean };
}

export interface RequestLists {
  incoming: ConnectionRequest[];
  sent: ConnectionRequest[];
}

export const EMPTY_REQUESTS: RequestLists = { incoming: [], sent: [] };

/** The post a new request is about, and who wrote it: all the request sheet and the API need, for either kind of post. */
export interface RequestSubject {
  id: string;
  kind: 'looking_for' | 'community';
  authorId: string;
  author: string;
  authorAvatar?: string;
  /** How the post is named in "About their … post". */
  about: string;
}

export const lookingForSubject = (post: LookingForPost): RequestSubject => ({
  id: post.id, kind: 'looking_for', authorId: post.authorId, author: post.author, authorAvatar: post.authorAvatar, about: INTENTION_LABELS[post.intention],
});

/** A regular Cosmos post as the subject of a request, or null for an old post with no known author. */
export const communitySubject = (post: CommunityPost): RequestSubject | null =>
  post.authorId ? { id: post.id, kind: 'community', authorId: post.authorId, author: post.author, authorAvatar: post.authorAvatar, about: 'Cosmos' } : null;

/** The name of the kind of post a request is about: its Looking For intention, or "Cosmos" for a regular post. */
export const requestPostLabel = (request: Pick<ConnectionRequest, 'post' | 'intention'>): string =>
  request.post.kind === 'community' ? 'Cosmos' : (request.intention && INTENTION_LABELS[request.intention]) || 'Looking For';

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
  busy: 'This is busy right now. Please try again in a moment.',
  internal_error: 'Requests are temporarily unavailable. Please try again.',
};

/** Words for an error code from the API. Unknown codes get a calm generic message, never raw text. */
export const requestErrorMessage = (code: unknown): string => MESSAGES[String(code)] ?? 'Something went wrong. Please try again.';

export const REQUEST_MESSAGE_MAX = 500;

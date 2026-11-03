/**
 * Pure rules for opening one Cosmos post from a link or from a member's profile: what counts as a post id, how a link to
 * a post is written and read, and how the outcome of loading that one post is told apart. No React and no network.
 */

/** Whether a link or saved id could be a post id (Firestore ids are 20 letters and digits); anything else is ignored. */
export const isPostId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);

/** The address that opens one post in Cosmos for someone with the app. */
export const postLink = (origin: string, postId: string): string => `${origin}/?post=${encodeURIComponent(postId)}`;

/** Reads a post id from a page address (?post=...), ignoring anything that is not a plausible id. */
export function postIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get('post');
  return isPostId(id) ? id : null;
}

export type PostLoad<T> = { status: 'ready'; post: T } | { status: 'unavailable' } | { status: 'failed' };

/**
 * How a failed read of one post is shown. A post that is gone, or that the rules no longer let this member read, is
 * "unavailable" (the same calm message, revealing nothing); only a real failure, such as being offline, can be retried.
 */
export function postLoadFromError(error: unknown): { status: 'unavailable' } | { status: 'failed' } {
  const code = String((error as { code?: unknown } | null)?.code ?? '');
  return code.includes('permission-denied') || code.includes('not-found') ? { status: 'unavailable' } : { status: 'failed' };
}

/** Whether a loaded post can be shown to this member: it is theirs to see, and its author is not someone they blocked. */
export const postVisibleTo = (post: { authorId?: string }, blockedIds: readonly string[]): boolean => !post.authorId || !blockedIds.includes(post.authorId);

import { collection, getDocs, limit, orderBy, query, QueryDocumentSnapshot, startAfter, where } from 'firebase/firestore';
import { auth, db, ensureAnonymousAuth } from '../lib/firebase.ts';
import type { CommunityPost } from '../types.ts';
import { PROFILE_CACHE_MS, PROFILE_PAGE_SIZE, parseProfileResponse, profileLink, settlePostsLoad, type PostsOutcome, type ProfileResponse } from '../utils/profileView.ts';
import type { LookingForPost } from '../utils/lookingFor.ts';
import { toCommunityPost } from './communityService.ts';
import { toLookingForPost } from './lookingForService.ts';

/**
 * Data for the member profile page. The profile itself, and whether the viewer may see it at all, come from the Signals API
 * (api/_profiles.js), so privacy choices, blocks and suspensions are enforced on the server. Posts are read straight from
 * their own collections with the rules already in place, a few at a time. Nothing is subscribed to live: a profile is a
 * page you open, so it is read once and reused for a minute when moving between profiles.
 */

export type ProfileLoad =
  | { ok: true; data: ProfileResponse }
  | { ok: false; reason: 'unavailable' | 'forbidden' | 'rate_limited' | 'unsupported' | 'failed' };

/** A request that has not answered in this long fails, so a profile can never sit on its skeleton forever. */
const REQUEST_TIMEOUT_MS = 15_000;
const cache = new Map<string, { at: number; data: ProfileResponse }>();
// A member's public posts are public to every adult member, so remembering them for a minute shows nothing new to anyone.
// The member's OWN posts are never remembered: they change as they post and delete.
const postsCache = new Map<string, { at: number; page: PostsPage }>();
const postsInFlight = new Map<string, Promise<PostsOutcome<PostsPage>>>();
const lookingForCache = new Map<string, { at: number; posts: LookingForPost[] }>();
const lookingForInFlight = new Map<string, Promise<LookingForPost[] | null>>();
const isOwn = (memberId: string): boolean => auth?.currentUser?.uid === memberId;

/** Rejects like a failed request if the work takes too long. */
function within<T>(work: Promise<T>, ms: number = REQUEST_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'deadline-exceeded' })), ms);
    work.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}
const inFlight = new Map<string, Promise<ProfileLoad>>();
const ages = new Map<string, { at: number; age: number | null }>();

export function clearProfileCache(memberId?: string): void {
  if (memberId) {
    cache.delete(memberId);
    ages.delete(memberId);
    postsCache.delete(memberId);
    lookingForCache.delete(memberId);
  } else {
    cache.clear();
    ages.clear();
    postsCache.clear();
    lookingForCache.clear();
  }
}

/** A profile viewed in the last minute, with no request at all, or null. Only ever what the server already allowed this viewer to see. */
export function peekMemberProfile(memberId: string, now: number = Date.now()): ProfileResponse | null {
  const hit = cache.get(memberId);
  return hit && now - hit.at < PROFILE_CACHE_MS ? hit.data : null;
}

/** The first page of a member's posts from the last minute, or null. */
export function peekMemberPostsFirstPage(memberId: string, now: number = Date.now()): PostsPage | null {
  if (isOwn(memberId)) return null;
  const hit = postsCache.get(memberId);
  return hit && now - hit.at < PROFILE_CACHE_MS ? hit.page : null;
}

/** Starts reading a member's first page of posts now, alongside the profile itself, so the two do not queue one behind the other. */
export function prefetchMemberPosts(memberId: string): void {
  void fetchMemberCommunityPosts(memberId, null);
}

/**
 * The signed-in member, waiting for sign-in to be restored first. A profile can be opened straight from a shared link,
 * before the app has finished signing the member back in; reading too early would fail for no real reason.
 */
async function signedIn() {
  return auth?.currentUser ?? (await ensureAnonymousAuth());
}

async function authed(path: string): Promise<Response | null> {
  const user = await signedIn();
  if (!user) return null;
  const token = await user.getIdToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(path, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function fetchMemberProfile(memberId: string, force = false, now: number = Date.now()): Promise<ProfileLoad> {
  const hit = cache.get(memberId);
  if (!force && hit && now - hit.at < PROFILE_CACHE_MS) return Promise.resolve({ ok: true, data: hit.data });
  const pending = inFlight.get(memberId);
  if (pending) return pending;
  const load = (async (): Promise<ProfileLoad> => {
    try {
      const response = await authed(`/api/signals?view=profile&memberId=${encodeURIComponent(memberId)}`);
      if (!response) return { ok: false, reason: 'failed' };
      if (response.status === 404) return { ok: false, reason: 'unavailable' };
      if (response.status === 403) return { ok: false, reason: 'forbidden' };
      if (response.status === 429) return { ok: false, reason: 'rate_limited' };
      // A server that does not know the profile view answers 400, or with another view's data: never treated as a profile.
      if (response.status === 400) return { ok: false, reason: 'unsupported' };
      if (!response.ok) return { ok: false, reason: 'failed' };
      const data = parseProfileResponse(await response.json().catch(() => null));
      if (!data) return { ok: false, reason: 'unsupported' };
      cache.set(memberId, { at: Date.now(), data });
      return { ok: true, data };
    } catch {
      return { ok: false, reason: 'failed' };
    } finally {
      inFlight.delete(memberId);
    }
  })();
  inFlight.set(memberId, load);
  return load;
}

/** A connected member's age, only if they chose to show it; null for everyone else. */
export async function fetchMemberAge(memberId: string, now: number = Date.now()): Promise<number | null> {
  const hit = ages.get(memberId);
  if (hit && now - hit.at < PROFILE_CACHE_MS) return hit.age;
  try {
    const response = await authed(`/api/age?view=profile-age&memberId=${encodeURIComponent(memberId)}`);
    if (!response?.ok) return null;
    const body = (await response.json()) as { age?: unknown };
    const age = typeof body.age === 'number' && Number.isInteger(body.age) ? body.age : null;
    ages.set(memberId, { at: Date.now(), age });
    return age;
  } catch {
    return null;
  }
}

export interface PostsPage {
  posts: CommunityPost[];
  cursor: QueryDocumentSnapshot | null;
  done: boolean;
}

/** One page of a member's public Cosmos posts, newest first. Needs the authorId + timestamp index in firestore.indexes.json. */
export function fetchMemberCommunityPosts(memberId: string, after: QueryDocumentSnapshot | null = null): Promise<PostsOutcome<PostsPage>> {
  // The first page is the one a profile opens with: reused for a minute, and asked for once even if two callers want it.
  if (after === null) {
    const hit = peekMemberPostsFirstPage(memberId);
    if (hit) return Promise.resolve({ ok: true, page: hit });
    const pending = postsInFlight.get(memberId);
    if (pending) return pending;
  }
  const load = (async (): Promise<PostsOutcome<PostsPage>> => {
    const outcome = await settlePostsLoad(() => within((async () => {
      if (!db) throw new Error('database_unavailable');
      await signedIn();
      const base = [where('authorId', '==', memberId), orderBy('timestamp', 'desc')];
      const snap = await getDocs(
        query(collection(db, 'community_posts'), ...base, ...(after ? [startAfter(after)] : []), limit(PROFILE_PAGE_SIZE + 1))
      );
      const docs = snap.docs.slice(0, PROFILE_PAGE_SIZE);
      return {
        posts: docs.map((d) => toCommunityPost(d.id, d.data())),
        cursor: docs.length > 0 ? docs[docs.length - 1] : after,
        done: snap.docs.length <= PROFILE_PAGE_SIZE,
      } satisfies PostsPage;
    })()));
    // A success with no posts is an empty profile and is not logged; only a real failure is.
    if (!outcome.ok) console.warn('[Profile] Could not load posts:', outcome.reason);
    // An empty answer is never remembered: it is the one answer that goes wrong the moment the member posts, and a profile
    // that says "No public posts yet" for a minute after that is simply false. Asking again costs one cheap read.
    else if (after === null && !isOwn(memberId) && outcome.page.posts.length > 0) postsCache.set(memberId, { at: Date.now(), page: outcome.page });
    return outcome;
  })();
  if (after !== null) return load;
  postsInFlight.set(memberId, load);
  return load.finally(() => postsInFlight.delete(memberId));
}

/** A member's Looking For posts (at most one per intention, so never many). Adult members only, enforced by the rules. */
export function fetchMemberLookingForPosts(memberId: string): Promise<LookingForPost[] | null> {
  if (!db) return Promise.resolve(null);
  const hit = isOwn(memberId) ? undefined : lookingForCache.get(memberId);
  if (hit && Date.now() - hit.at < PROFILE_CACHE_MS) return Promise.resolve(hit.posts);
  const pending = lookingForInFlight.get(memberId);
  if (pending) return pending;
  const load = (async (): Promise<LookingForPost[] | null> => {
    try {
      await signedIn();
      const snap = await within(getDocs(query(collection(db!, 'looking_for_posts'), where('authorId', '==', memberId), limit(5))));
      const posts = snap.docs.flatMap((d) => {
        const post = toLookingForPost(d.id, d.data());
        return post ? [post] : [];
      });
      if (!isOwn(memberId)) lookingForCache.set(memberId, { at: Date.now(), posts });
      return posts;
    } catch (err) {
      console.warn('[Profile] Could not load Looking For posts:', err);
      return null;
    }
  })();
  lookingForInFlight.set(memberId, load);
  return load.finally(() => lookingForInFlight.delete(memberId));
}

/** Shares a link to a profile with the share sheet, or copies it. */
export async function shareMemberProfile(memberId: string, name: string): Promise<'shared' | 'copied' | 'failed'> {
  const url = profileLink(window.location.origin, memberId);
  try {
    if (navigator.share) {
      await navigator.share({ title: `${name} on QUEERSPACE`, url });
      return 'shared';
    }
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

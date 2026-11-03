/**
 * Pure rules for the member profile page: what the server returned, which connection action to offer, how the cover is
 * coloured, and what an owner has chosen to show. No React and no network, so it can be tested. The server (api/_profiles.js)
 * decides what a viewer may see at all; this only shapes it.
 */
import type { LookingForPost } from './lookingFor.ts';
import { resolveAvatar } from './avatar.ts';
import type { UserPreferences } from '../types.ts';

export interface MemberProfile {
  id: string;
  displayName: string | null;
  pronouns: string | null;
  avatar: string | null;
  about: string | null;
  vibe: string | null;
  style: string | null;
  intention: string | null;
  interests: string[];
  /** A general area, present only when the member shows their location. */
  location: string | null;
  orientation: string | null;
  identity: string | null;
  expression: string[];
  /** Whether an age may be asked for (connected members only); the age itself is a separate, trusted request. */
  showsAge: boolean;
}

export type RelationState = 'self' | 'none' | 'request_sent' | 'request_received' | 'declined' | 'connected';

export interface ProfileResponse {
  self: boolean;
  member: MemberProfile | null;
  relation: { state: RelationState; conversationId?: string };
  blocked: 'by_me' | null;
}

/** The one connection action the page offers, always through the existing connection-request flow. */
export type ProfileAction =
  | { kind: 'none' }
  | { kind: 'blocked' }
  | { kind: 'open_conversation'; conversationId: string }
  | { kind: 'pending' }
  | { kind: 'respond' }
  | { kind: 'declined' }
  | { kind: 'request'; post: LookingForPost }
  | { kind: 'paused' }
  | { kind: 'unavailable' };

/**
 * Which action fits this member right now. A request can only be sent about one of their live Looking For posts, so a
 * profile with none offers nothing: visiting a profile never creates contact on its own.
 */
export function profileAction(response: Pick<ProfileResponse, 'self' | 'blocked' | 'relation'>, posts: LookingForPost[]): ProfileAction {
  if (response.self) return { kind: 'none' };
  if (response.blocked) return { kind: 'blocked' };
  const { state, conversationId } = response.relation;
  if (state === 'connected' && conversationId) return { kind: 'open_conversation', conversationId };
  if (state === 'request_sent') return { kind: 'pending' };
  if (state === 'request_received') return { kind: 'respond' };
  if (state === 'declined') return { kind: 'declined' };
  if (posts.length === 0) return { kind: 'unavailable' };
  const open = posts.filter((post) => !post.requestsPaused).sort((a, b) => b.timestamp - a.timestamp);
  return open.length > 0 ? { kind: 'request', post: open[0] } : { kind: 'paused' };
}

/** Looking For posts a visitor may see as live opportunities: paused ones are left out. The owner sees all of their own. */
export const visibleLookingForPosts = (posts: LookingForPost[], isSelf: boolean): LookingForPost[] =>
  (isSelf ? posts : posts.filter((post) => !post.requestsPaused)).slice().sort((a, b) => b.timestamp - a.timestamp);

/** A calm cover for a profile that has no cover image: soft colours drawn from the member's own avatar. */
export function profileCover(avatar: string | null | undefined, seed: string): string {
  const { bg, fur } = resolveAvatar(avatar ?? undefined, seed);
  return `linear-gradient(135deg, ${bg} 0%, ${fur}55 52%, #120b17 100%)`;
}

/** The line under the name: age (when shown to this viewer) and pronouns. */
export function identityLine(member: Pick<MemberProfile, 'pronouns'>, age: number | null): string {
  return [age !== null ? String(age) : '', member.pronouns ?? ''].filter(Boolean).join(' · ');
}

/** Small details for the About section, in a steady order; empty when the member shared none. */
export function aboutDetails(member: MemberProfile, intentionLabel: string | null): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (intentionLabel) rows.push({ label: 'Here for', value: intentionLabel });
  if (member.vibe) rows.push({ label: 'Vibe', value: member.vibe });
  if (member.style) rows.push({ label: 'Style', value: member.style });
  if (member.orientation) rows.push({ label: 'Orientation', value: member.orientation });
  if (member.identity) rows.push({ label: 'Gender identity', value: member.identity });
  if (member.expression.length > 0) rows.push({ label: 'Gender expression', value: member.expression.join(', ') });
  return rows;
}

/** What an owner has chosen to show, for the "visible to others" summary on their own page. */
export function ownerVisibility(prefs: Pick<UserPreferences, 'showAgeOnProfile' | 'showLocationOnProfile' | 'showSexualOrientationOnProfile' | 'showGenderIdentityOnProfile' | 'showGenderExpressionOnProfile'>): { label: string; shown: boolean; hint: string }[] {
  const identityShared = [prefs.showSexualOrientationOnProfile, prefs.showGenderIdentityOnProfile, prefs.showGenderExpressionOnProfile].filter(Boolean).length;
  return [
    { label: 'Age', shown: prefs.showAgeOnProfile === true, hint: prefs.showAgeOnProfile === true ? 'Shown to people you’re connected with' : 'Hidden' },
    { label: 'Location', shown: prefs.showLocationOnProfile !== false, hint: prefs.showLocationOnProfile !== false ? 'General area only' : 'Hidden' },
    { label: 'Identity', shown: identityShared > 0, hint: identityShared > 0 ? `${identityShared} of 3 shared` : 'Hidden' },
  ];
}

export const PROFILE_PAGE_SIZE = 5;
/** How long a fetched profile is reused when someone moves between profiles. */
export const PROFILE_CACHE_MS = 60_000;

/** Whether a link or saved id could be a member id the server would accept. */
export const isMemberId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);

/** The address that opens a member's profile for someone with the app. */
export const profileLink = (origin: string, memberId: string): string => `${origin}/?profile=${encodeURIComponent(memberId)}`;

/** Reads a profile id from a page address (?profile=...), ignoring anything that is not a plausible id. */
export function profileIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get('profile');
  return isMemberId(id) ? id : null;
}

const RELATION_STATES: readonly string[] = ['self', 'none', 'request_sent', 'request_received', 'declined', 'connected'];
const isStringOrNull = (value: unknown): boolean => value === null || typeof value === 'string';

/**
 * Checks that an answer really is a profile answer before the page trusts it. A server that does not know the profile
 * view (an older deployment) answers with something else entirely, such as the invitations list; this returns null for
 * that, and for anything malformed, so the page can show a clear error instead of an empty screen.
 */
export function parseProfileResponse(data: unknown): ProfileResponse | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  const relation = raw.relation as { state?: unknown; conversationId?: unknown } | null | undefined;
  if (typeof raw.self !== 'boolean' || !relation || typeof relation.state !== 'string' || !RELATION_STATES.includes(relation.state)) return null;
  if (relation.conversationId !== undefined && typeof relation.conversationId !== 'string') return null;
  if (raw.blocked !== null && raw.blocked !== 'by_me') return null;
  const member = raw.member as Record<string, unknown> | null | undefined;
  if (member === null) {
    // The only answer without a member is "you blocked them".
    return raw.blocked === 'by_me' ? (raw as unknown as ProfileResponse) : null;
  }
  if (!member || typeof member !== 'object' || typeof member.id !== 'string') return null;
  for (const key of ['displayName', 'pronouns', 'avatar', 'about', 'vibe', 'style', 'intention', 'location', 'orientation', 'identity']) {
    if (!isStringOrNull(member[key])) return null;
  }
  if (!Array.isArray(member.interests) || !member.interests.every((v) => typeof v === 'string')) return null;
  if (!Array.isArray(member.expression) || !member.expression.every((v) => typeof v === 'string')) return null;
  if (typeof member.showsAge !== 'boolean') return null;
  return raw as unknown as ProfileResponse;
}

export type PostsFailure = 'permission' | 'network' | 'failed';
export type PostsOutcome<T> = { ok: true; page: T } | { ok: false; reason: PostsFailure };

/** Tells a refused read from a connection problem from anything else, by the error's code. Used for wording and logs only. */
export function classifyPostsFailure(error: unknown): PostsFailure {
  const code = String((error as { code?: unknown } | null)?.code ?? '');
  if (code.includes('permission-denied')) return 'permission';
  if (code.includes('unavailable') || code.includes('deadline-exceeded') || code.includes('network')) return 'network';
  return 'failed';
}

/**
 * Runs a posts request and says how it ended. Only a request that really succeeded is `ok`, and an `ok` page may hold no
 * posts: that is an empty profile, not an error. Anything thrown is a failure, never an empty result.
 */
export async function settlePostsLoad<T>(load: () => Promise<T>): Promise<PostsOutcome<T>> {
  try {
    return { ok: true, page: await load() };
  } catch (error) {
    return { ok: false, reason: classifyPostsFailure(error) };
  }
}

export type PostsView = 'loading' | 'empty' | 'error' | 'list';

/**
 * What the Posts section shows. Empty is a successful answer with nothing in it; error means the request failed. Once some
 * posts are listed, a failed "show more" keeps them and shows the retry underneath instead.
 */
export function postsView(state: { loading: boolean; failed: boolean; count: number }): PostsView {
  if (state.count > 0) return 'list';
  if (state.failed) return 'error';
  return state.loading ? 'loading' : 'empty';
}

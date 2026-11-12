// What one member may see of another member's profile, decided on the server.
//
// The public profile document can be read by any signed-in member (firestore.rules), so showing a profile straight from it
// would leave every privacy choice to the screen. This returns only what the member chose to share, and nothing at all when
// the viewer is not allowed to see them: not an adult member, the member is not set up or is suspended, or they have blocked
// the viewer. It also says how the two are connected (so the screen can show the right action), without ever creating a
// request or a conversation: those still go through the connection-request flow in _requests.js.
// Underscore-prefixed files in api/ are not deployed as separate functions.
import { isAdultMember } from './_adult.js';
import { rateLimit } from './_lib.js';
import { createKeyedQueue } from './_requests.js';
import { vibeOnProfile } from './_vibe.js';

/** How many other members' profiles one member can open per minute. Opening your own is not counted. Well above normal browsing. */
export const PROFILE_LOOKUPS_PER_MINUTE = 60;

/**
 * The counter is one document read then written in a transaction, and two of those at once on the same document stall
 * each other for seconds (measured: four simultaneous lookups took about 7 s). Lookups by one viewer therefore take turns
 * for that one step; different viewers never wait for each other.
 */
const counting = createKeyedQueue();

const fail = (statusCode, code) => Object.assign(new Error(code), { statusCode });
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const toMs = value => (typeof value?.toMillis === 'function' ? value.toMillis() : null);

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * A sexual orientation / gender field is shown only when that exact field was opted in. Older profiles used one
 * switch for all three, so it still counts when the specific switch was never set.
 */
function optedIn(profile, flag) {
  return profile[flag] === true || (profile[flag] === undefined && profile.showSogieOnProfile === true);
}

/** The public shape of a profile: only fields the member shares, trimmed and bounded. No age, no birthday, no exact place. */
export function shapeProfile(id, profile) {
  const avatar = typeof profile.avatar === 'string' && profile.avatar.length <= 24 ? profile.avatar : null;
  const interests = Array.isArray(profile.topics) ? profile.topics.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim().slice(0, 24)).slice(0, 8) : [];
  const orientation = optedIn(profile, 'showSexualOrientationOnProfile') ? text(profile.sexualOrientation, 40) : '';
  const identity = optedIn(profile, 'showGenderIdentityOnProfile') ? text(profile.genderIdentity, 40) : '';
  const expression = optedIn(profile, 'showGenderExpressionOnProfile') && Array.isArray(profile.genderExpression)
    ? profile.genderExpression.filter(v => typeof v === 'string').map(v => v.slice(0, 40)).slice(0, 2)
    : [];
  return {
    id,
    displayName: text(profile.displayName, 30) || null,
    pronouns: text(profile.pronouns, 20) || null,
    avatar,
    about: text(profile.aboutMe, 160) || null,
    vibe: text(profile.myVibe, 24) || null,
    style: text(profile.personalStyle, 24) || null,
    intention: text(profile.intention, 40) || null,
    interests,
    // A general area only, and only when the member shows their location.
    location: profile.showLocationOnProfile !== false ? text(profile.region, 60) || null : null,
    orientation: orientation || null,
    identity: identity || null,
    expression,
    // Whether to ask for an age. The age itself never travels here: it comes from the age API, to connected members only.
    showsAge: profile.showAgeOnProfile === true,
  };
}

/**
 * When the member joined, as an ISO date, or null. It comes from creation timestamps that already exist and that clients cannot
 * change: the public profile's createdAt (stamped once by the rules) and the private account record's createdAt (also fixed by
 * the rules). The earlier of the two is the truer start, since an older profile may have been stamped when it was first edited.
 * Never the profile's last-updated time. Only this one date leaves the server; nothing else from the private record does.
 */
export function memberSinceOf(profile, settings, nowMs = Date.now()) {
  const candidates = [profile?.createdAt, settings?.createdAt]
    .map(value => (typeof value?.toMillis === 'function' ? value.toMillis() : null))
    .filter(ms => Number.isFinite(ms) && ms > 0 && ms <= nowMs + 24 * 60 * 60 * 1000);
  return candidates.length ? new Date(Math.min(...candidates)).toISOString() : null;
}

/** How the viewer and the member are connected right now, from records only the two of them can see. */
export async function relationBetween(db, uid, memberId, nowMs = Date.now()) {
  const [pair, outgoing, incoming] = await Promise.all([
    db.collection('signalsPairs').where('participants', '==', [uid, memberId].sort()).where('status', '==', 'active').limit(1).get(),
    db.doc(`connection_request_locks/${uid}_${memberId}`).get(),
    db.doc(`connection_request_locks/${memberId}_${uid}`).get(),
  ]);
  if (!pair.empty) return { state: 'connected', conversationId: pair.docs[0].id };
  const mine = outgoing.exists ? outgoing.data() : null;
  if (mine?.state === 'pending') return { state: 'request_sent' };
  if (mine?.state === 'cooling' && toMs(mine.until) > nowMs) return { state: 'declined' };
  if (incoming.exists && incoming.data()?.state === 'pending') return { state: 'request_received' };
  return { state: 'none' };
}

export async function profileView(db, uid, memberId) {
  if (!safeId(memberId)) throw fail(400, 'invalid_request');
  // Server-side and per viewer (apiRateLimits is closed to clients), before any profile data is read, so scraping ids is
  // slow and cheap to refuse. This is the same helper the age endpoints use.
  if (memberId !== uid) await counting.run(uid, () => rateLimit(db, uid, 'profile-view', PROFILE_LOOKUPS_PER_MINUTE, 60_000));
  const viewerSettings = await db.doc(`users/${uid}/private/settings`).get();
  // The profile pages are for adult members only, checked from the private account record.
  if (!isAdultMember(viewerSettings.data())) throw fail(403, 'not_allowed');

  const profileSnap = await db.doc(`users/${memberId}/public/profile`).get();
  if (memberId === uid) {
    if (!profileSnap.exists) throw fail(404, 'profile_unavailable');
    return { self: true, member: { ...shapeProfile(memberId, profileSnap.data()), memberSince: memberSinceOf(profileSnap.data(), viewerSettings.data()) }, relation: { state: 'self' }, blocked: null, currentVibe: await vibeOnProfile(db, memberId, { self: true }) };
  }

  const blockedByMe = viewerSettings.data()?.blockedPartnerIds;
  if (Array.isArray(blockedByMe) && blockedByMe.includes(memberId)) return { self: false, member: null, relation: { state: 'none' }, blocked: 'by_me' };

  const [memberSettings, suspension] = await Promise.all([
    db.doc(`users/${memberId}/private/settings`).get(),
    db.doc(`suspensions/${memberId}`).get(),
  ]);
  const blockedMe = memberSettings.data()?.blockedPartnerIds;
  // To the viewer, a member who blocked them, is suspended, or is not set up simply is not there.
  if (!profileSnap.exists || profileSnap.data().profileComplete !== true || suspension.exists
    || !isAdultMember(memberSettings.data()) || (Array.isArray(blockedMe) && blockedMe.includes(uid))) {
    throw fail(404, 'profile_unavailable');
  }
  const viewerSuspended = await db.doc(`suspensions/${uid}`).get();
  if (viewerSuspended.exists) throw fail(403, 'account_unavailable');
  // The member's Current Vibe, only if their own setting lets this viewer see it and it has not expired (decided in api/_vibe.js).
  const relation = await relationBetween(db, uid, memberId);
  const currentVibe = await vibeOnProfile(db, memberId, { self: false, connected: relation.state === 'connected' });
  return { self: false, member: { ...shapeProfile(memberId, profileSnap.data()), memberSince: memberSinceOf(profileSnap.data(), memberSettings.data()) }, relation, blocked: null, currentVibe };
}

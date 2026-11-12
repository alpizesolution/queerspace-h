// Current Vibe: a temporary custom status (one emoji and a short message of the member's own words) that expires 24 hours after it
// is saved. It shows as a small bubble beside the member's avatar.
//
// Where it lives: currentVibes/{uid}, one document per member, written ONLY here (Admin SDK). firestore.rules denies every client read
// and write, so nobody can read someone's status, hide an expiry, or extend one, whatever the screen does. Who may see it, and whether
// it has expired, are decided on every read below, from the stored `expiresAt` and `visibility`; nothing depends on a timer or on a
// cleanup job. The expiry is the source of truth: an expired record is simply not returned.
//
// Earlier records were saved with a mood (moodId, emoji, label, message up to 100 characters). They are still read, as an emoji plus
// their message (or the mood name), until they expire; nothing is migrated.
//
// Keep the limits and visibility names in step with src/utils/currentVibe.ts (a test checks that the two agree).
// Underscore-prefixed files in api/ are not deployed as separate functions.
import { Timestamp } from 'firebase-admin/firestore';
import { isAdultMember } from './_adult.js';
import { rateLimit } from './_lib.js';
import { createKeyedQueue } from './_requests.js';

export const VIBE_TTL_MS = 24 * 60 * 60 * 1000;
/** The longest message, in characters (an emoji counts as one). */
export const VIBE_MESSAGE_MAX = 60;
/** Who can see it: everyone who can view the member's profile, only their approved (Signals) connections, or nobody but them. */
export const VIBE_VISIBILITIES = ['everyone', 'connections', 'nobody'];
/** Publishing is limited so the status cannot be used to spam; well above anything a person does by hand. */
export const VIBE_PUBLISHES_PER_HOUR = 30;
/** Looking at other members' statuses (Seek, Signals header, profiles) per viewer per minute. */
export const VIBE_LOOKUPS_PER_MINUTE = 120;

const counting = createKeyedQueue();

const fail = (statusCode, code) => Object.assign(new Error(code), { statusCode });
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const toMs = value => (typeof value?.toMillis === 'function' ? value.toMillis() : null);
// Control characters (including line breaks): a status is one short line.
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f' + String.fromCharCode(0x2028, 0x2029) + ']');
const PICTOGRAPH = /\p{Extended_Pictographic}|^\p{Regional_Indicator}{2}$|^[0-9#*]️?⃣$/u;

/** True when `value` is exactly one emoji (a single grapheme such as a face, a flag or a joined sequence), and nothing else. */
export function isSingleEmoji(value) {
  if (typeof value !== 'string' || !value || value.length > 32) return false;
  const parts = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(value)];
  return parts.length === 1 && PICTOGRAPH.test(value);
}

/** Counts characters the way a person does (an emoji is one), not UTF-16 units. */
export const charLength = text => [...text].length;

/** True when the two members have an active Signals connection (the only meaning of "approved connection"). */
export async function areConnected(db, a, b) {
  const pair = await db.collection('signalsPairs').where('participants', '==', [a, b].sort()).where('status', '==', 'active').limit(1).get();
  return !pair.empty;
}

/**
 * Checks what the app sends when saving: an optional emoji, an optional message and who can see it. At least one of the emoji and the
 * message is needed. The emoji must be exactly one emoji and the message at most 60 characters on one line. Anything else is refused,
 * so nobody can store a different shape. Returns { ok: true, emoji, message, visibility } or { ok: false, error }.
 */
export function parseVibeInput(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid_vibe' };
  if (Object.keys(body).some(key => !['action', 'emoji', 'message', 'visibility'].includes(key))) return { ok: false, error: 'invalid_vibe' };
  let emoji = '';
  if (body.emoji !== undefined && body.emoji !== null && body.emoji !== '') {
    if (!isSingleEmoji(body.emoji)) return { ok: false, error: 'invalid_emoji' };
    emoji = body.emoji;
  }
  let message = '';
  if (body.message !== undefined && body.message !== null) {
    if (typeof body.message !== 'string' || CONTROL.test(body.message)) return { ok: false, error: 'invalid_message' };
    message = body.message.replace(/\s+/g, ' ').trim();
    if (charLength(message) > VIBE_MESSAGE_MAX) return { ok: false, error: 'invalid_message' };
  }
  if (!emoji && !message) return { ok: false, error: 'empty_status' };
  const visibility = body.visibility === undefined ? 'everyone' : body.visibility;
  if (!VIBE_VISIBILITIES.includes(visibility)) return { ok: false, error: 'invalid_visibility' };
  return { ok: true, emoji, message, visibility };
}

/**
 * A stored record as a viewer sees it, or null when it is expired, empty or not a well-formed record. Expiry is decided here, against
 * the time the server is asked, from the stored `expiresAt`: an expired status is gone the moment its time passes, with no job needed.
 * `visibility` is included only for the owner.
 */
export function shapeVibe(stored, nowMs, { self = false } = {}) {
  const expiresAt = toMs(stored?.expiresAt);
  const updatedAt = toMs(stored?.updatedAt);
  if (expiresAt === null || updatedAt === null || expiresAt <= nowMs) return null;
  const emoji = isSingleEmoji(stored.emoji) ? stored.emoji : '';
  // A record from the mood era may have no message: its mood name is the text. A message over the limit is cut, never shown in full.
  const raw = typeof stored.message === 'string' && stored.message.trim() ? stored.message : typeof stored.label === 'string' ? stored.label : '';
  const message = CONTROL.test(raw) ? '' : [...raw.replace(/\s+/g, ' ').trim()].slice(0, VIBE_MESSAGE_MAX).join('');
  if (!emoji && !message) return null;
  return {
    emoji,
    message: message || null,
    updatedAt: new Date(updatedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    ...(self ? { visibility: VIBE_VISIBILITIES.includes(stored.visibility) ? stored.visibility : 'everyone' } : {}),
  };
}

/**
 * What one viewer may see of a stored record, given how they relate to its owner. `connected` is true only for an active Signals
 * connection. The owner always sees their own (with the setting that governs it).
 */
export function vibeFor(stored, nowMs, { self = false, connected = false } = {}) {
  if (self) return shapeVibe(stored, nowMs, { self: true });
  const visibility = stored?.visibility;
  if (visibility === 'nobody') return null;
  if (visibility === 'connections' && !connected) return null;
  // Anything else that is not exactly 'everyone' or 'connections' is treated as private.
  if (visibility !== 'everyone' && visibility !== 'connections') return null;
  return shapeVibe(stored, nowMs);
}

/** Saves (or replaces) the member's one status. Expiry is exactly 24 hours after this moment, by the server's clock. */
export async function setCurrentVibe(db, uid, body, nowMs = Date.now()) {
  const input = parseVibeInput(body);
  if (!input.ok) throw fail(400, input.error);
  const [settings, profile, suspension] = await Promise.all([
    db.doc(`users/${uid}/private/settings`).get(),
    db.doc(`users/${uid}/public/profile`).get(),
    db.doc(`suspensions/${uid}`).get(),
  ]);
  if (!isAdultMember(settings.data()) || !profile.exists || profile.data().profileComplete !== true) throw fail(403, 'not_allowed');
  if (suspension.exists) throw fail(403, 'account_unavailable');
  await rateLimit(db, uid, 'vibe-set', VIBE_PUBLISHES_PER_HOUR, 60 * 60_000);
  const ref = db.doc(`currentVibes/${uid}`);
  const now = Timestamp.fromMillis(nowMs);
  const stored = await db.runTransaction(async tx => {
    const earlier = await tx.get(ref);
    // The first save of a run keeps its start time while the status stays live; one that had expired starts afresh.
    const earlierStart = earlier.exists && toMs(earlier.data().expiresAt) > nowMs ? earlier.data().createdAt : null;
    const record = {
      emoji: input.emoji,
      message: input.message,
      visibility: input.visibility,
      createdAt: earlierStart ?? now,
      updatedAt: now,
      expiresAt: Timestamp.fromMillis(nowMs + VIBE_TTL_MS),
    };
    // A full replace, so nothing from an earlier mood-era record (moodId, label) is left behind.
    tx.set(ref, record);
    return record;
  });
  return { vibe: shapeVibe(stored, nowMs, { self: true }) };
}

/** Removes the member's status before it expires. Safe to repeat. */
export async function clearCurrentVibe(db, uid) {
  await db.doc(`currentVibes/${uid}`).delete();
  return { vibe: null };
}

/**
 * Another member's (or one's own) status, for places that show a small indicator (Seek, the Signals header). It applies the same
 * rules as opening their profile: an adult viewer who is not suspended, a member who is set up, not suspended and an adult, and no
 * block in either direction; then the member's own setting; then expiry. Whatever the reason it is not shown, the answer is the same
 * `{ vibe: null }`, so it never reveals why.
 */
export async function vibeView(db, viewerId, memberId, nowMs = Date.now()) {
  if (!safeId(memberId)) throw fail(400, 'invalid_request');
  if (memberId === viewerId) {
    const own = await db.doc(`currentVibes/${viewerId}`).get();
    return { vibe: own.exists ? shapeVibe(own.data(), nowMs, { self: true }) : null };
  }
  await counting.run(viewerId, () => rateLimit(db, viewerId, 'vibe-view', VIBE_LOOKUPS_PER_MINUTE, 60_000));
  const viewerSettings = await db.doc(`users/${viewerId}/private/settings`).get();
  if (!isAdultMember(viewerSettings.data())) throw fail(403, 'not_allowed');
  const [vibe, profile, memberSettings, suspension, viewerSuspension] = await Promise.all([
    db.doc(`currentVibes/${memberId}`).get(),
    db.doc(`users/${memberId}/public/profile`).get(),
    db.doc(`users/${memberId}/private/settings`).get(),
    db.doc(`suspensions/${memberId}`).get(),
    db.doc(`suspensions/${viewerId}`).get(),
  ]);
  if (viewerSuspension.exists) throw fail(403, 'account_unavailable');
  const none = { vibe: null };
  if (!vibe.exists) return none;
  const iBlocked = viewerSettings.data()?.blockedPartnerIds;
  const theyBlocked = memberSettings.data()?.blockedPartnerIds;
  if (!profile.exists || profile.data().profileComplete !== true || suspension.exists || !isAdultMember(memberSettings.data())
    || (Array.isArray(iBlocked) && iBlocked.includes(memberId)) || (Array.isArray(theyBlocked) && theyBlocked.includes(viewerId))) return none;
  // Only when the member limits it to connections is the relationship looked up.
  const connected = vibe.data().visibility === 'connections' && toMs(vibe.data().expiresAt) > nowMs
    ? await areConnected(db, viewerId, memberId)
    : false;
  return { vibe: vibeFor(vibe.data(), nowMs, { connected }) };
}

/** For a profile that has already passed every profile check: what this viewer may see of the member's status. */
export async function vibeOnProfile(db, memberId, { self, connected }, nowMs = Date.now()) {
  const snap = await db.doc(`currentVibes/${memberId}`).get();
  return snap.exists ? vibeFor(snap.data(), nowMs, { self, connected }) : null;
}

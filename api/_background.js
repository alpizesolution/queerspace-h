// Profile backgrounds: what the server checks and keeps for a member's animated galaxy or their own static image.
//
// The setting itself (a preset id, or an image id, plus position, darkness and the animation switch) is a small map on the member's
// public profile, written by their own device under firestore.rules. Nothing else about it is trusted: whatever a viewer is sent is
// re-validated here (shapeBackground), so a bad record can only ever mean "the default profile look".
//
// A member's OWN picture is the only thing stored outside Firestore. The bytes go to the same private Cloudflare R2 bucket the timed
// photos use, under the member's own prefix (bg/{uid}/{id}), after the real bytes have been inspected (a still JPEG, PNG or WebP, nothing
// else) and the camera metadata removed. Viewers never get a link: the app asks this server, which checks that the viewer may see that
// profile, and only ever serves the image the member has actually SAVED on their profile (never an upload they have not saved).
// Presets need no storage at all: they are drawn by the app.
//
// Keep the preset ids and limits in step with src/utils/profileBackground.ts and firestore.rules (a test checks that they agree).
// Underscore-prefixed files in api/ are not deployed as separate functions.
import { randomBytes } from 'node:crypto';
import { isAdultMember } from './_adult.js';
import { rateLimit } from './_lib.js';
import { createKeyedQueue } from './_requests.js';
import { currentMediaStore, inspectImage, stripMetadata } from './_media.js';

export const BACKGROUND_PRESETS = [
  'nebula-dreams', 'midnight-universe', 'stardust-bloom', 'aurora-galaxy', 'celestial-ocean', 'solar-eclipse', 'cosmic-dust', 'moonlight',
];
export const DIM_MAX = 80;
export const DEFAULT_DIM_PRESET = 15;
export const DEFAULT_DIM_IMAGE = 40;
export const IMAGE_ID = /^[a-f0-9]{16}$/;
/** The largest picture accepted, in bytes. The app shrinks a picture to well under this before sending (about 1600 pixels wide). */
export const MAX_BACKGROUND_BYTES = 1_800_000;
/** The longest side accepted, in pixels. */
export const MAX_BACKGROUND_SIDE = 3000;
export const BACKGROUND_UPLOADS_PER_HOUR = 12;
export const BACKGROUND_VIEWS_PER_MINUTE = 60;

const queue = createKeyedQueue();
const fail = (statusCode, code) => Object.assign(new Error(code), { statusCode });
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const keyOf = (uid, id) => `bg/${uid}/${id}`;

const whole = (value, min, max, fallback) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

/**
 * A stored background as a viewer is sent it, or null for "the default look". Anything that is not exactly a valid preset or image
 * (an unknown preset, a malformed image id, an extra field, both at once) gives null, and the numbers are brought inside their limits.
 */
export function shapeBackground(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (Object.keys(raw).some(key => !['kind', 'preset', 'image', 'x', 'y', 'dim', 'animate'].includes(key))) return null;
  const common = { x: whole(raw.x, 0, 100, 50), y: whole(raw.y, 0, 100, 50), animate: raw.animate !== false };
  if (raw.kind === 'preset') {
    if (!BACKGROUND_PRESETS.includes(raw.preset) || 'image' in raw) return null;
    return { kind: 'preset', preset: raw.preset, ...common, dim: whole(raw.dim, 0, DIM_MAX, DEFAULT_DIM_PRESET) };
  }
  if (raw.kind === 'image') {
    if (typeof raw.image !== 'string' || !IMAGE_ID.test(raw.image) || 'preset' in raw) return null;
    return { kind: 'image', image: raw.image, ...common, dim: whole(raw.dim, 0, DIM_MAX, DEFAULT_DIM_IMAGE) };
  }
  return null;
}

/** The id of the picture the member has saved on their profile, or null. */
const savedImageId = profile => {
  const shaped = shapeBackground(profile?.background);
  return shaped?.kind === 'image' ? shaped.image : null;
};

async function requireMember(db, uid) {
  const [settings, profile, suspension] = await Promise.all([
    db.doc(`users/${uid}/private/settings`).get(),
    db.doc(`users/${uid}/public/profile`).get(),
    db.doc(`suspensions/${uid}`).get(),
  ]);
  if (!isAdultMember(settings.data()) || !profile.exists || profile.data().profileComplete !== true) throw fail(403, 'not_allowed');
  if (suspension.exists) throw fail(403, 'account_unavailable');
  return profile.data();
}

/** Deletes these pictures from storage, one by one, never failing the caller (an object that is already gone is fine). */
async function removeObjects(store, uid, ids) {
  for (const id of ids) {
    try { await store.delete(keyOf(uid, id)); } catch { /* the next prune tries again */ }
  }
}

/**
 * Keeps only the picture saved on the profile (and, optionally, one `keep` that was just uploaded and is waiting to be saved); every
 * other uploaded picture of this member is deleted from storage. The ids are tracked in a server-only record.
 */
async function prune(db, store, uid, saved, keep = null) {
  const ref = db.doc(`profileBackgroundImages/${uid}`);
  const snap = await ref.get();
  const known = Array.isArray(snap.data()?.ids) ? snap.data().ids.filter(id => IMAGE_ID.test(id)) : [];
  const wanted = [...new Set([saved, keep].filter(Boolean))];
  const stale = known.filter(id => !wanted.includes(id));
  await removeObjects(store, uid, stale);
  if (wanted.length) await ref.set({ ids: wanted }); else if (snap.exists) await ref.delete();
}

/**
 * Stores a new picture for the member. The request is the picture only (base64); the id is made here. The picture is not part of the
 * profile until the member saves their profile with that id, and until then nobody else can see it.
 */
export async function setBackgroundImage(db, uid, body, getStore = currentMediaStore) {
  if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['action', 'image'].includes(key))) throw fail(400, 'invalid_image');
  const encoded = body.image;
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw fail(400, 'invalid_image');
  if (encoded.length > Math.ceil(MAX_BACKGROUND_BYTES / 3) * 4 + 4) throw fail(413, 'image_too_large');
  const raw = Buffer.from(encoded, 'base64');
  if (raw.length > MAX_BACKGROUND_BYTES) throw fail(413, 'image_too_large');
  const profile = await requireMember(db, uid);
  const image = inspectImage(raw);
  if (image.width > MAX_BACKGROUND_SIDE || image.height > MAX_BACKGROUND_SIDE) throw fail(413, 'image_too_large');
  const store = getStore();
  if (!store) throw fail(503, 'storage_not_configured');
  return queue.run(`bg:${uid}`, async () => {
    await rateLimit(db, uid, 'bg-set', BACKGROUND_UPLOADS_PER_HOUR, 60 * 60_000);
    const id = randomBytes(8).toString('hex');
    await store.put(keyOf(uid, id), stripMetadata(raw, image.type), image.type);
    await prune(db, store, uid, savedImageId(profile), id);
    return { image: id };
  });
}

/** After a profile is saved (or reset): deletes every uploaded picture except the one the profile now uses. Safe to repeat. */
export async function pruneBackgroundImages(db, uid, getStore = currentMediaStore) {
  const store = getStore();
  if (!store) return { ok: true };
  const profile = await db.doc(`users/${uid}/public/profile`).get();
  await queue.run(`bg:${uid}`, () => prune(db, store, uid, savedImageId(profile.data())));
  return { ok: true };
}

/**
 * The picture a member has saved on their profile, for a viewer who may see that profile: an adult viewer who is not suspended, a member
 * who is set up, not suspended and an adult, and no block in either direction. For every other case the answer is the same "not found",
 * so it never says why. Served as base64 in the response (never as a link), and never an upload the member has not saved.
 */
export async function backgroundImageView(db, viewerId, memberId, getStore = currentMediaStore) {
  if (!safeId(memberId)) throw fail(400, 'invalid_request');
  const notFound = () => fail(404, 'not_found');
  await queue.run(`bg-view:${viewerId}`, () => rateLimit(db, viewerId, 'bg-view', BACKGROUND_VIEWS_PER_MINUTE, 60_000));
  const viewerSettings = await db.doc(`users/${viewerId}/private/settings`).get();
  if (!isAdultMember(viewerSettings.data())) throw fail(403, 'not_allowed');
  const [profile, memberSettings, suspension, viewerSuspension] = await Promise.all([
    db.doc(`users/${memberId}/public/profile`).get(),
    db.doc(`users/${memberId}/private/settings`).get(),
    db.doc(`suspensions/${memberId}`).get(),
    db.doc(`suspensions/${viewerId}`).get(),
  ]);
  if (viewerSuspension.exists) throw fail(403, 'account_unavailable');
  if (memberId !== viewerId) {
    const iBlocked = viewerSettings.data()?.blockedPartnerIds;
    const theyBlocked = memberSettings.data()?.blockedPartnerIds;
    if (!profile.exists || profile.data().profileComplete !== true || suspension.exists || !isAdultMember(memberSettings.data())
      || (Array.isArray(iBlocked) && iBlocked.includes(memberId)) || (Array.isArray(theyBlocked) && theyBlocked.includes(viewerId))) throw notFound();
  }
  const id = savedImageId(profile.data());
  if (!id) throw notFound();
  const store = getStore();
  if (!store) throw fail(503, 'storage_not_configured');
  let bytes;
  try { bytes = await store.get(keyOf(memberId, id)); } catch { throw notFound(); }
  const type = inspectImage(bytes).type;
  return { image: bytes.toString('base64'), contentType: type, id };
}

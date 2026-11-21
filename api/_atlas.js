// ATLAS: a shared map of memories. Members pin a memory (a title, a few words, a date, an optional photo) to a place, and it
// appears as a star on the map for whoever may see it.
//
// Everything goes through the server. `atlasMemories` has NO client rule (clients are denied everything), so who may see a memory
// is decided here from the data, never by the screen.
//
// Every memory is PUBLIC to QUEERSPACE members: the server sets that itself when a memory is created, and refuses any request that asks
// for another visibility (it never quietly publishes something the sender believed was private), on create and on edit. A memory is
// seen by any adult member, except when the author or the viewer has blocked the other, or the author is suspended. Records written
// by earlier versions as "private" or "friends" keep their old, narrower audience (nothing is ever widened behind anyone's back):
//   - private: only the member who wrote it;
//   - friends: the author and members who are connected to them (an active Signals connection).
//
// Who the author appears as is the member's choice between two things only: their own pseudonym (the QUEERSPACE display name, read from
// their profile at the time it is shown) or Anonymous. An anonymous memory is shown under a RANDOM COSMIC NAME (Nova, Polaris, Little
// Comet...) that the server picks when the memory is published and stores on that memory alone: it is not tied to the member, so a
// member's anonymous memories do not share a name any more than the pool allows, and nothing links one to another. The server never
// accepts a name from the request, so nobody can choose a name, take another member's, or pose as the team. "Anonymous" changes only
// what other members are shown: ownerId is always kept for ownership, edits, deletion, reporting and moderation.
//
// Location privacy: the app sends a point, the server SNAPS it to a ~1 km grid before anything is stored. The exact point is never
// written, never returned and never logged, so it cannot leak through a response, an export or a bug. Nobody's live location is ever
// involved: a memory is a place the member chose, on a date they chose.
//
// Photos live in the private R2 bucket under `atlas/{memoryId}` and are served only through `memoryPhoto`, which applies the same
// visibility check. There is no public link.
//
// Views and reactions: opening a memory counts ONE view per member, and a member may leave ONE reaction on it (a hug or a heart; they can
// switch or take it back). Both live in server-only subcollections whose document id IS the member (`views/{uid}`, `reactions/{uid}`), so a
// second view or a second reaction by the same member cannot exist, and the memory document keeps only the totals (viewCount, hugCount,
// heartCount). Nobody is ever told who viewed or reacted; the author's own opens are not counted and they cannot react to their own memory.
// Only members who may see the memory can view or react to it (the same check as everything else: anyone else gets the same "not found").
// Underscore-prefixed files in api/ are not deployed as separate functions.
import { createHash, randomInt } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpError, rateLimit, requireAdmin, safeId } from './_lib.js';
import { isAdultMember, isEligibleMember } from './_adult.js';
import { withContentionRetry } from './_requests.js';
import { currentMediaStore, inspectImage, stripMetadata } from './_media.js';

export const TITLE_MAX = 80;
export const TEXT_MAX = 1000;
export const PLACE_MAX = 80;
/** Coordinates are rounded to this many degrees (0.01 is about 1.1 km north-south). Mirrors src/utils/atlas.ts. */
export const GRID_DEGREES = 0.01;
export const VISIBILITIES = ['private', 'friends', 'public'];
/** How a memory shows its author: the member's own pseudonym ("profile") or Anonymous (a random cosmic name). The real account id is
 *  always kept privately (ownerId) for ownership, edits, deletion, reporting and moderation, and is never sent with an anonymous memory. */
export const IDENTITY_MODES = ['profile', 'anonymous'];
/** The names an anonymous memory can be given. Picked at random by the server, once per memory, and stored on it (anonymousAlias). */
export const COSMIC_NAMES = ['Stardust', 'Star', 'Little Comet', 'Moonbeam', 'Nebula', 'Shooting Star', 'Supernova', 'Cosmic Dust', 'Galaxy', 'Aurora', 'Meteor', 'Luna', 'Celestial', 'Polaris', 'Eclipse', 'Nova'];
/** Every memory is public to members. The only value ever written for a new memory. */
export const MEMORY_VISIBILITY = 'public';
/** Recent Memories: the rolling window the preview looks back over, how many it shows, and the most it will read for it. */
export const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECENT_PREVIEW = 3;
const RECENT_QUERY_LIMIT = 20;
export const MAX_PHOTO_BYTES = 3_000_000;
export const MEMORIES_PER_HOUR = 20;
export const PHOTO_VIEWS_PER_MINUTE = 240;
export const REACTION_KINDS = ['hug', 'heart'];
/** Views and reactions a member can send per minute, across all memories: well above reading and tapping, low enough to stop a script. */
export const ENGAGEMENT_PER_MINUTE = 120;
export const LIST_LIMIT = 200;
const PUBLIC_QUERY_LIMIT = 300;
const FRIENDS_QUERY_LIMIT = 100;
const FRIEND_CHUNK = 30;
const MAX_PARTNERS = 500;
const MAX_OWNERS_PER_LIST = 120;

/** Mirrors BLOCKED_PATTERNS in src/utils/matching-logic.ts (a test fails if they drift). Applied to what other members will read. */
export const BLOCKED_PATTERNS = [
  /\b(kill yourself|kys)\b/i,
  /\b(nazi|hitler|faggot|dyke bitch)\b/i,
  /\b(send nudes|selling content|telegram @)\b/i,
];

const fail = (status, code) => new HttpError(status, code);
const isBlockedText = value => BLOCKED_PATTERNS.some(pattern => pattern.test(value));
const toMs = value => (typeof value?.toMillis === 'function' ? value.toMillis() : null);

/** Rounds one coordinate to the privacy grid. Never returns -0. */
export function snapCoordinate(value) {
  const snapped = Math.round(value / GRID_DEGREES) * GRID_DEGREES;
  return Number(snapped.toFixed(2)) || 0;
}

const isLat = value => typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;
const isLng = value => typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;

/** A real calendar date as YYYY-MM-DD, not more than a day in the future (time zones), not before 1900. */
export function isMemoryDate(value, nowMs = Date.now()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== value) return false;
  return at >= Date.parse('1900-01-01T00:00:00Z') && at <= nowMs + 24 * 60 * 60 * 1000;
}

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
/** A stored counter as a safe whole number (never negative, never fractional), whatever an older or damaged record holds. */
const total = value => (Number.isInteger(value) && value > 0 ? value : 0);

const FIELDS = ['title', 'text', 'date', 'lat', 'lng', 'placeLabel', 'visibility', 'displayIdentity'];

/**
 * Checks what a member sent. `required` (a new memory) needs a title, a date, a place and a visibility; an edit may send any of them.
 * Anything unexpected is refused, so a request cannot smuggle in an owner, a timestamp or exact coordinates under another name.
 */
export function parseMemoryInput(body, { required, allowed = [], nowMs = Date.now() } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'invalid_memory');
  const known = new Set([...FIELDS, ...allowed]);
  if (Object.keys(body).some(key => !known.has(key))) throw fail(400, 'invalid_memory');
  const out = {};
  const has = key => body[key] !== undefined;
  if (required || has('title')) {
    const title = text(body.title, TITLE_MAX + 1);
    if (!title || title.length > TITLE_MAX) throw fail(400, 'invalid_title');
    out.title = title;
  }
  if (has('text')) {
    if (typeof body.text !== 'string' || body.text.trim().length > TEXT_MAX) throw fail(400, 'invalid_text');
    out.text = body.text.trim();
  } else if (required) out.text = '';
  if (required || has('date')) {
    if (!isMemoryDate(body.date, nowMs)) throw fail(400, 'invalid_date');
    out.date = body.date;
  }
  if (required || has('lat') || has('lng')) {
    if (!isLat(body.lat) || !isLng(body.lng)) throw fail(400, 'invalid_location');
    out.lat = snapCoordinate(body.lat);
    out.lng = snapCoordinate(body.lng);
  }
  if (has('placeLabel')) {
    if (typeof body.placeLabel !== 'string' || body.placeLabel.trim().length > PLACE_MAX) throw fail(400, 'invalid_place');
    out.placeLabel = body.placeLabel.trim();
  } else if (required) out.placeLabel = '';
  // Visibility is not a choice. A request that asks for anything but "public" is refused (never quietly widened), and a new memory is
  // always stored as public by the server itself, whatever the request says.
  if (has('visibility') && body.visibility !== MEMORY_VISIBILITY) throw fail(400, 'invalid_visibility');
  if (required) out.visibility = MEMORY_VISIBILITY;
  // How the author appears: "profile" (their own pseudonym) or "anonymous". Only the choice is accepted, never a name. Memories written
  // before this existed read as the profile (see storedIdentity).
  if (has('displayIdentity')) out.displayIdentity = parseDisplayIdentity(body.displayIdentity);
  else if (required) out.displayIdentity = { mode: 'profile' };
  // What other members can read is held to the same community rules as the rest of QUEERSPACE.
  if (out.visibility !== 'private' && ['title', 'text', 'placeLabel'].some(key => typeof out[key] === 'string' && isBlockedText(out[key]))) {
    throw fail(400, 'content_not_allowed');
  }
  return out;
}

/** The image, if one was sent: base64 of a JPEG, PNG or WebP, inspected here (never trusted from the app). */
export function parsePhoto(encoded) {
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw fail(400, 'invalid_image');
  if (encoded.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4 + 4) throw fail(413, 'image_too_large');
  const raw = Buffer.from(encoded, 'base64');
  if (raw.length > MAX_PHOTO_BYTES) throw fail(413, 'image_too_large');
  return { raw, image: inspectImage(raw) };
}

const photoKey = id => `atlas/${id}`;

/** The author choice: exactly { mode: 'profile' } or { mode: 'anonymous' }. Anything else (another key, a name, another mode) is refused. */
export function parseDisplayIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, 'invalid_identity');
  if (Object.keys(value).some(key => key !== 'mode')) throw fail(400, 'invalid_identity');
  if (!IDENTITY_MODES.includes(value.mode)) throw fail(400, 'invalid_identity');
  return { mode: value.mode };
}

/**
 * The identity stored on a memory. Only a memory that says "profile" (or has no choice recorded at all) names its author. Anything else,
 * including records from earlier versions (the old "anonymous" flag, cosmic aliases, chosen names), reads as anonymous, so a stored
 * value can never reveal more than the author chose.
 */
export function storedIdentity(data) {
  const stored = data?.displayIdentity;
  if (stored && typeof stored === 'object') return { mode: stored.mode === 'profile' ? 'profile' : 'anonymous' };
  return { mode: data?.anonymous === true ? 'anonymous' : 'profile' };
}

/** A cosmic name worked out from the memory's own id, for an anonymous record that was saved before names were stored. The same id always
 *  gives the same name, so every screen agrees, and it depends on nothing about the author. */
export function derivedAlias(id) {
  return COSMIC_NAMES[createHash('sha256').update(String(id)).digest().readUInt32BE(0) % COSMIC_NAMES.length];
}

/** The cosmic name an anonymous memory shows: the one stored on it, or (for an older record) the one its id gives. */
export function aliasOf(id, data) {
  return COSMIC_NAMES.includes(data?.anonymousAlias) ? data.anonymousAlias : derivedAlias(id);
}

/** A random cosmic name, preferring ones the member has not already used on another memory of theirs (as far as the pool allows). */
export function pickAlias(taken = new Set(), random = randomInt) {
  const free = COSMIC_NAMES.filter(name => !taken.has(name));
  const pool = free.length ? free : COSMIC_NAMES;
  return pool[random(pool.length)];
}

/** The cosmic names this member already has on their own memories, so a new one can be a different name. */
async function usedAliases(db, uid, exceptId = null) {
  const snap = await db.collection('atlasMemories').where('ownerId', '==', uid).orderBy('createdAt', 'desc').limit(LIST_LIMIT).get();
  const taken = new Set();
  for (const doc of snap.docs) if (doc.id !== exceptId && storedIdentity(doc.data()).mode === 'anonymous') taken.add(aliasOf(doc.id, doc.data()));
  return taken;
}

/** The name shown for a memory: its cosmic name when anonymous, or the author's own QUEERSPACE pseudonym ("You" on their own memory). */
export function displayNameFor(id, data, author, viewerUid) {
  if (storedIdentity(data).mode === 'anonymous') return aliasOf(id, data);
  if (data.ownerId === viewerUid) return author?.displayName ?? 'You';
  return author?.displayName ?? null;
}

// ------------------------------------------------------------------------------------------------------------ who can see what

/** The member's own gate: an adult member whose account is not suspended. Returns their private settings. */
export async function requireMember(db, uid) {
  const [settings, suspension] = await Promise.all([db.doc(`users/${uid}/private/settings`).get(), db.doc(`suspensions/${uid}`).get()]);
  if (suspension.exists) throw fail(403, 'account_unavailable');
  if (!isAdultMember(settings.data())) throw fail(403, 'not_allowed');
  return settings.data() ?? {};
}

/** For actions that put something on the map: also requires a saved profile (the same bar as posting in Cosmos). Browsing keeps requireMember. */
export async function requireCompleteMember(db, uid) {
  const [settings, profile, suspension] = await Promise.all([
    db.doc(`users/${uid}/private/settings`).get(), db.doc(`users/${uid}/public/profile`).get(), db.doc(`suspensions/${uid}`).get(),
  ]);
  if (suspension.exists) throw fail(403, 'account_unavailable');
  if (!isEligibleMember(settings.data(), profile.data())) throw fail(403, 'profile_required');
  return settings.data() ?? {};
}

/** Who the viewer has blocked and who they are connected to. Connections are read once per request. */
export async function viewerContext(db, uid, settings) {
  const blocked = new Set(Array.isArray(settings?.blockedPartnerIds) ? settings.blockedPartnerIds.filter(id => typeof id === 'string') : []);
  const pairs = await db.collection('signalsPairs').where('participants', 'array-contains', uid).limit(MAX_PARTNERS).get();
  const partners = new Set();
  for (const snap of pairs.docs) {
    const data = snap.data();
    if (data?.status !== 'active' || !Array.isArray(data.participants)) continue;
    const other = data.participants.find(id => id !== uid);
    if (typeof other === 'string') partners.add(other);
  }
  return { uid, blocked, partners };
}

/**
 * For each author: whether they are suspended or have blocked the viewer, and the profile fields they share. Three batched reads for
 * the whole list, never one per memory.
 */
export async function loadAuthors(db, viewerUid, ownerIds) {
  const ids = [...new Set(ownerIds)].filter(id => id !== viewerUid).slice(0, MAX_OWNERS_PER_LIST);
  const authors = new Map();
  if (!ids.length) return authors;
  const [settings, suspensions, profiles] = await Promise.all([
    db.getAll(...ids.map(id => db.doc(`users/${id}/private/settings`))),
    db.getAll(...ids.map(id => db.doc(`suspensions/${id}`))),
    db.getAll(...ids.map(id => db.doc(`users/${id}/public/profile`))),
  ]);
  ids.forEach((id, index) => {
    const blocklist = settings[index].data()?.blockedPartnerIds;
    const profile = profiles[index].data() ?? {};
    authors.set(id, {
      hidden: suspensions[index].exists || (Array.isArray(blocklist) && blocklist.includes(viewerUid)),
      displayName: text(profile.displayName, 30) || null,
      avatar: typeof profile.avatar === 'string' && profile.avatar.length <= 24 ? profile.avatar : null,
      pronouns: text(profile.pronouns, 20) || null,
    });
  });
  return authors;
}

/** The one place visibility is decided. `author` comes from loadAuthors (absent for the viewer's own memories). */
export function canView(memory, ctx, author) {
  if (memory.ownerId === ctx.uid) return true;
  if (ctx.blocked.has(memory.ownerId) || !author || author.hidden) return false;
  if (memory.visibility === 'public') return true;
  if (memory.visibility === 'friends') return ctx.partners.has(memory.ownerId);
  return false;
}

/** What a viewer receives. Coordinates are re-snapped on the way out as a second guard; a profile memory names its author (never the
 *  account id), an anonymous one shows only "Anonymous" and carries nothing about who wrote it. */
export function shapeMemory(id, data, viewerUid, author) {
  const mine = data.ownerId === viewerUid;
  const identity = storedIdentity(data);
  return {
    id,
    mine,
    title: text(data.title, TITLE_MAX),
    text: text(data.text, TEXT_MAX),
    date: typeof data.date === 'string' ? data.date : null,
    lat: snapCoordinate(Number(data.lat)),
    lng: snapCoordinate(Number(data.lng)),
    placeLabel: text(data.placeLabel, PLACE_MAX),
    visibility: VISIBILITIES.includes(data.visibility) ? data.visibility : 'private',
    displayIdentity: identity.mode,
    displayName: displayNameFor(id, data, mine ? null : author, viewerUid),
    // The author's own choice, so an edit can start from it. Other members never receive this.
    identity: mine ? identity : null,
    hasPhoto: Boolean(data.photo?.type),
    // Totals only (see the note on views and reactions above): never who. The viewer's own reaction comes from openMemory / reactToMemory.
    views: total(data.viewCount),
    hugs: total(data.hugCount),
    hearts: total(data.heartCount),
    createdAt: toMs(data.createdAt),
    // A profile memory shows the member's own choices (never their account id, and only what the profile already shares); an anonymous one has no author at all.
    author: mine || !author || identity.mode !== 'profile' ? null : { id: data.ownerId, displayName: author.displayName, avatar: author.avatar, pronouns: author.pronouns },
  };
}

// ------------------------------------------------------------------------------------------------------------------- listing

/** Map bounds from the app, or null for "anywhere". West greater than east means the view crosses the date line. */
export function parseBounds(value) {
  if (value === undefined || value === null) return null;
  const { south, west, north, east } = value;
  if (![south, north].every(isLat) || ![west, east].every(isLng) || south > north) throw fail(400, 'invalid_bounds');
  return { south, west, north, east };
}

export const inBounds = (data, bounds) => {
  if (!bounds) return true;
  if (data.lat < bounds.south || data.lat > bounds.north) return false;
  return bounds.west <= bounds.east ? data.lng >= bounds.west && data.lng <= bounds.east : data.lng >= bounds.west || data.lng <= bounds.east;
};

const newestFirst = (a, b) => (b.data.createdAt?.toMillis?.() ?? 0) - (a.data.createdAt?.toMillis?.() ?? 0) || (a.id < b.id ? 1 : -1);

/**
 * `mine`: only the member's own memories, whatever their visibility (older private and connections-only records included). `community`:
 * every public memory in view from every member, INCLUDING the member's own, plus older friends-only records from their connections.
 * `recent`: the newest few community memories from the last 24 hours, wherever they are (the preview only: the map still shows every
 * memory in view). Every memory is checked with canView before it is returned.
 */
export async function listMemories(db, uid, body) {
  if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['action', 'scope', 'bounds'].includes(key))) throw fail(400, 'invalid_request');
  if (!['mine', 'community', 'recent'].includes(body.scope)) throw fail(400, 'invalid_scope');
  if (body.scope === 'recent' && body.bounds !== undefined) throw fail(400, 'invalid_request');
  const bounds = parseBounds(body.bounds);
  const settings = await requireMember(db, uid);
  const collection = db.collection('atlasMemories');
  let found = [];
  if (body.scope === 'mine') {
    const snap = await collection.where('ownerId', '==', uid).orderBy('createdAt', 'desc').limit(LIST_LIMIT).get();
    found = snap.docs.map(doc => ({ id: doc.id, data: doc.data() }));
  } else {
    const ctx = await viewerContext(db, uid, settings);
    const queries = [];
    const since = Date.now() - RECENT_WINDOW_MS;
    let publicQuery = collection.where('visibility', '==', 'public');
    if (body.scope === 'recent') publicQuery = publicQuery.where('createdAt', '>=', Timestamp.fromMillis(since)).orderBy('createdAt', 'desc').limit(RECENT_QUERY_LIMIT);
    else {
      if (bounds) publicQuery = publicQuery.where('lat', '>=', bounds.south).where('lat', '<=', bounds.north);
      publicQuery = publicQuery.limit(PUBLIC_QUERY_LIMIT);
    }
    queries.push(publicQuery.get());
    const partners = [...ctx.partners].filter(id => !ctx.blocked.has(id));
    for (let at = 0; at < partners.length && at < FRIEND_CHUNK * 4; at += FRIEND_CHUNK) {
      queries.push(collection.where('ownerId', 'in', partners.slice(at, at + FRIEND_CHUNK)).where('visibility', '==', 'friends').limit(FRIENDS_QUERY_LIMIT).get());
    }
    const seen = new Set();
    for (const snap of await Promise.all(queries)) {
      for (const doc of snap.docs) {
        if (seen.has(doc.id)) continue;
        seen.add(doc.id);
        const data = doc.data();
        // The viewer's own PUBLIC memories belong in Community like everyone else's (they were published to the community). Only public records
        // and the connections' older friends-only records are ever fetched here, so the viewer's own older private or friends-only ones still
        // appear under "My memories" alone.
        if (!inBounds(data, bounds)) continue;
        if (body.scope === 'recent' && (toMs(data.createdAt) ?? 0) < since) continue;
        found.push({ id: doc.id, data });
      }
    }
    const authors = await loadAuthors(db, uid, found.map(item => item.data.ownerId));
    found = found.filter(item => canView(item.data, ctx, authors.get(item.data.ownerId)));
    found.sort(newestFirst);
    if (body.scope === 'recent') return { memories: found.slice(0, RECENT_PREVIEW).map(item => shapeMemory(item.id, item.data, uid, authors.get(item.data.ownerId))), truncated: false };
    const truncated = found.length > LIST_LIMIT;
    return { memories: found.slice(0, LIST_LIMIT).map(item => shapeMemory(item.id, item.data, uid, authors.get(item.data.ownerId))), truncated };
  }
  return { memories: found.map(item => shapeMemory(item.id, item.data, uid, null)), truncated: false };
}

// -------------------------------------------------------------------------------------------------------------- write paths

/** Creates a memory. Safe to repeat: the same `id` is one memory. */
export async function createMemory(db, uid, body, getStore = currentMediaStore) {
  const fields = parseMemoryInput(body, { required: true, allowed: ['action', 'id', 'photo'] });
  if (body.id !== undefined && !safeId(body.id)) throw fail(400, 'invalid_memory');
  await requireCompleteMember(db, uid);
  const ref = body.id ? db.doc(`atlasMemories/${body.id}`) : db.collection('atlasMemories').doc();
  const existing = await ref.get();
  if (existing.exists) {
    if (existing.data().ownerId !== uid) throw fail(409, 'invalid_memory');
    return { memory: shapeMemory(ref.id, existing.data(), uid, null), replayed: true };
  }
  const photo = body.photo !== undefined ? parsePhoto(body.photo) : null;
  await withContentionRetry(() => rateLimit(db, uid, 'atlas-create', MEMORIES_PER_HOUR, 60 * 60_000));
  const data = { ownerId: uid, ...fields, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
  // An anonymous memory gets its own random cosmic name now, stored on it. It is never read from the request.
  if (fields.displayIdentity.mode === 'anonymous') data.anonymousAlias = pickAlias(await usedAliases(db, uid));
  if (photo) {
    const store = getStore();
    if (!store) throw fail(503, 'storage_not_configured');
    await store.put(photoKey(ref.id), stripMetadata(photo.raw, photo.image.type), photo.image.type);
    data.photo = { type: photo.image.type, width: photo.image.width, height: photo.image.height };
  }
  try {
    await ref.create(data);
  } catch (error) {
    if (photo) await getStore()?.delete(photoKey(ref.id)).catch(() => {});
    if (error?.code !== 6) throw error;
  }
  return { memory: shapeMemory(ref.id, (await ref.get()).data(), uid, null), replayed: false };
}

async function ownMemory(db, uid, id) {
  if (!safeId(id)) throw fail(400, 'invalid_request');
  const ref = db.doc(`atlasMemories/${id}`);
  const snap = await ref.get();
  // The same answer for "no such memory" and "somebody else's", so a private memory's existence is never confirmed.
  if (!snap.exists || snap.data().ownerId !== uid) throw fail(404, 'not_found');
  return { ref, data: snap.data() };
}

/** Edits the member's own memory: its words, date, place, author choice, and photo (replace or remove). Its audience cannot be changed here. */
export async function updateMemory(db, uid, body, getStore = currentMediaStore) {
  const fields = parseMemoryInput(body, { required: false, allowed: ['action', 'id', 'photo', 'removePhoto'] });
  if (body.removePhoto !== undefined && typeof body.removePhoto !== 'boolean') throw fail(400, 'invalid_memory');
  if (body.photo !== undefined && body.removePhoto === true) throw fail(400, 'invalid_memory');
  if (('lat' in fields) !== ('lng' in fields)) throw fail(400, 'invalid_location');
  await requireCompleteMember(db, uid);
  const { ref, data: before } = await ownMemory(db, uid, body.id);
  // What other members will read is checked against the community rules, as when it was first written.
  const merged = { ...before, ...fields };
  if (merged.visibility !== 'private' && ['title', 'text', 'placeLabel'].some(key => typeof merged[key] === 'string' && isBlockedText(merged[key]))) throw fail(400, 'content_not_allowed');
  const patch = { ...fields, updatedAt: FieldValue.serverTimestamp() };
  if (fields.displayIdentity) {
    if (fields.displayIdentity.mode === 'anonymous') {
      // Already anonymous: keep the name it has (an older record with none keeps the one its id gives). Newly anonymous: a new random name.
      patch.anonymousAlias = storedIdentity(before).mode === 'anonymous' ? aliasOf(ref.id, before) : pickAlias(await usedAliases(db, uid, ref.id));
    } else {
      // Back to the member's own pseudonym: the cosmic name is dropped, so choosing Anonymous again gives a fresh one.
      patch.anonymousAlias = FieldValue.delete();
    }
  }
  const store = getStore();
  if (body.photo !== undefined) {
    const photo = parsePhoto(body.photo);
    if (!store) throw fail(503, 'storage_not_configured');
    await store.put(photoKey(ref.id), stripMetadata(photo.raw, photo.image.type), photo.image.type);
    patch.photo = { type: photo.image.type, width: photo.image.width, height: photo.image.height };
  } else if (body.removePhoto === true && before.photo) {
    patch.photo = FieldValue.delete();
  }
  await ref.update(patch);
  if (body.removePhoto === true && before.photo && store) await store.delete(photoKey(ref.id)).catch(() => {});
  return { memory: shapeMemory(ref.id, (await ref.get()).data(), uid, null) };
}

/**
 * Deletes a memory and its photo: the author's own, or (moderation) any memory when the caller is an administrator (a Google sign-in with
 * an admins/{uid} document, the same rule as the rest of QUEERSPACE). An administrator's removal is written to an audit record that keeps
 * the real owner id, which is never shown to anyone. Everyone else gets "not found" for memories that are not theirs.
 */
export async function deleteMemory(db, uid, body, getStore = currentMediaStore, decoded = null) {
  if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['action', 'id'].includes(key))) throw fail(400, 'invalid_request');
  let target;
  try {
    target = await ownMemory(db, uid, body.id);
  } catch (error) {
    if (error?.statusCode !== 404 || !decoded) throw error;
    try { await requireAdmin(db, decoded); } catch { throw error; }
    const snap = await db.doc(`atlasMemories/${body.id}`).get();
    if (!snap.exists) throw error;
    target = { ref: snap.ref, data: snap.data() };
    await db.collection('atlasModerationLog').add({ action: 'delete', memoryId: snap.id, ownerId: snap.data().ownerId, adminId: uid, at: FieldValue.serverTimestamp() });
  }
  const { ref, data } = target;
  // The reaction and view records are subcollections, which a plain delete would leave behind.
  await db.recursiveDelete(ref);
  if (data.photo) await getStore()?.delete(photoKey(ref.id)).catch(() => {});
  return { deleted: true };
}

/** The photo of one memory, for anyone who may see that memory. Everyone else gets the same "not found". */
export async function memoryPhoto(db, uid, id, getStore = currentMediaStore) {
  if (!safeId(id)) throw fail(400, 'invalid_request');
  // Several pictures are asked for at once (the Recent strip, a star with a few memories); their counters share one document, so a
  // transaction that loses the race to a sibling is simply tried again.
  await withContentionRetry(() => rateLimit(db, uid, 'atlas-photo', PHOTO_VIEWS_PER_MINUTE, 60_000));
  const settings = await requireMember(db, uid);
  const snap = await db.doc(`atlasMemories/${id}`).get();
  if (!snap.exists || !snap.data().photo) throw fail(404, 'not_found');
  const data = snap.data();
  if (data.ownerId !== uid) {
    const ctx = await viewerContext(db, uid, settings);
    const authors = await loadAuthors(db, uid, [data.ownerId]);
    if (!canView(data, ctx, authors.get(data.ownerId))) throw fail(404, 'not_found');
  }
  const store = getStore();
  if (!store) throw fail(503, 'storage_not_configured');
  let bytes;
  try { bytes = await store.get(photoKey(id)); } catch { throw fail(404, 'not_found'); }
  return { image: bytes.toString('base64'), contentType: inspectImage(bytes).type };
}

// ------------------------------------------------------------------------------------------------------- views and reactions

/** What everyone sees under a memory, plus the asking member's own reaction (null if none). */
export const engagementOf = (data, mine = null) => ({ views: total(data.viewCount), hugs: total(data.hugCount), hearts: total(data.heartCount), mine });

const reactionKind = snap => (snap.exists && REACTION_KINDS.includes(snap.data().kind) ? snap.data().kind : null);

/** A memory the member may see (their own, or one the usual visibility rules allow), or the same "not found" for everything else. */
async function viewableMemory(db, uid, id) {
  if (!safeId(id)) throw fail(400, 'invalid_request');
  await withContentionRetry(() => rateLimit(db, uid, 'atlas-engage', ENGAGEMENT_PER_MINUTE, 60_000));
  const settings = await requireMember(db, uid);
  const ref = db.doc(`atlasMemories/${id}`);
  const snap = await ref.get();
  if (!snap.exists) throw fail(404, 'not_found');
  const data = snap.data();
  if (data.ownerId !== uid) {
    const ctx = await viewerContext(db, uid, settings);
    const authors = await loadAuthors(db, uid, [data.ownerId]);
    if (!canView(data, ctx, authors.get(data.ownerId))) throw fail(404, 'not_found');
  }
  return { ref, data };
}

/**
 * A member opened a memory's card: counts their FIRST open as one view (the record is `views/{uid}`, so opening it again, from another
 * device or in a loop, changes nothing) and returns the totals with the member's own reaction. The author's own opens are not counted.
 */
export async function openMemory(db, uid, body) {
  if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['action', 'id'].includes(key))) throw fail(400, 'invalid_request');
  const { ref, data } = await viewableMemory(db, uid, body.id);
  if (data.ownerId === uid) return { engagement: engagementOf(data) };
  const viewRef = ref.collection('views').doc(uid);
  const reactionRef = ref.collection('reactions').doc(uid);
  const engagement = await db.runTransaction(async tx => {
    const [memorySnap, viewSnap, reactionSnap] = await tx.getAll(ref, viewRef, reactionRef);
    if (!memorySnap.exists) throw fail(404, 'not_found');
    let current = memorySnap.data();
    if (!viewSnap.exists) {
      const viewCount = total(current.viewCount) + 1;
      tx.set(viewRef, { at: FieldValue.serverTimestamp() });
      tx.update(ref, { viewCount });
      current = { ...current, viewCount };
    }
    return engagementOf(current, reactionKind(reactionSnap));
  });
  return { engagement };
}

/**
 * Sets the member's one reaction to a memory: `kind` is 'hug', 'heart' or null (take it back). Sending the same thing twice changes
 * nothing, and choosing the other kind switches. The reaction record and the totals change together or not at all. Not on your own memory.
 */
export async function reactToMemory(db, uid, body) {
  if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['action', 'id', 'kind'].includes(key))) throw fail(400, 'invalid_request');
  if (body.kind !== null && !REACTION_KINDS.includes(body.kind)) throw fail(400, 'invalid_reaction');
  const { ref, data } = await viewableMemory(db, uid, body.id);
  if (data.ownerId === uid) throw fail(403, 'own_memory');
  const reactionRef = ref.collection('reactions').doc(uid);
  const after = body.kind;
  const engagement = await db.runTransaction(async tx => {
    const [memorySnap, reactionSnap] = await tx.getAll(ref, reactionRef);
    if (!memorySnap.exists) throw fail(404, 'not_found');
    const current = memorySnap.data();
    const before = reactionKind(reactionSnap);
    const totals = { hug: total(current.hugCount), heart: total(current.heartCount) };
    if (before !== after) {
      if (before) totals[before] = Math.max(0, totals[before] - 1);
      if (after) totals[after] += 1;
      if (after) tx.set(reactionRef, { kind: after, at: FieldValue.serverTimestamp() }); else tx.delete(reactionRef);
      tx.update(ref, { hugCount: totals.hug, heartCount: totals.heart });
    }
    return engagementOf({ ...current, hugCount: totals.hug, heartCount: totals.heart }, after);
  });
  return { engagement };
}


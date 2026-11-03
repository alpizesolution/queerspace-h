// What the Signals inbox reads, kept cheap: connections a page at a time (newest first), one connection on request, and the
// other person's pseudonym and avatar from a short-lived memory of what was just read. Used by api/signals.js.
//
// Everything here is opt-in from the client (a page size, a pair id, a status), so a client that asks for none of it gets the
// same full list as before. Underscore-prefixed files in api/ are not deployed as separate functions.
import { FieldPath, Timestamp } from 'firebase-admin/firestore';

export const PAIR_PAGE_DEFAULT = 20;
export const PAIR_PAGE_MAX = 50;
/** The most a full (un-paged) list ever returns, as before. */
export const PAIR_LEGACY_LIMIT = 100;
export const PARTNER_CACHE_MS = 60_000;
export const PARTNER_CACHE_MAX = 500;

/** A page size from a request, or null when none was asked for (the full list). Clamped so a request can never ask for more. */
export function parsePageLimit(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return PAIR_PAGE_DEFAULT;
  return Math.min(n, PAIR_PAGE_MAX);
}

const SAFE_ID = /^[A-Za-z0-9_-]{8,128}$/;

/** "<createdAtMillis>.<pairId>": where the next page starts. Opaque to the app, checked here before it is used. */
export const encodeCursor = (millis, id) => `${millis}.${id}`;
export function decodeCursor(value) {
  if (typeof value !== 'string') return null;
  const dot = value.indexOf('.');
  if (dot < 1) return null;
  const millis = Number(value.slice(0, dot));
  const id = value.slice(dot + 1);
  return Number.isInteger(millis) && millis >= 0 && SAFE_ID.test(id) ? { millis, id } : null;
}

/**
 * A small time-limited memory of other members' public summaries (pseudonym and avatar only), so the same few people are not
 * read again on every refresh. It holds nothing private, and it is only ever asked about people in the caller's own connections.
 */
export function createPartnerCache({ ttlMs = PARTNER_CACHE_MS, max = PARTNER_CACHE_MAX, now = Date.now } = {}) {
  const entries = new Map();
  return {
    get(id) {
      const hit = entries.get(id);
      if (!hit) return undefined;
      if (now() - hit.at >= ttlMs) { entries.delete(id); return undefined; }
      return hit.value;
    },
    set(id, value) {
      if (entries.size >= max) entries.delete(entries.keys().next().value);
      entries.set(id, { value, at: now() });
    },
    get size() { return entries.size; },
    clear() { entries.clear(); },
  };
}

/** Summaries for these members: from memory when fresh, and the rest in one batched read. */
export async function partnerSummaries(db, ids, summarize, cache) {
  const wanted = [...new Set(ids.filter(Boolean))];
  const result = new Map();
  const missing = [];
  for (const id of wanted) {
    const hit = cache?.get(id);
    if (hit !== undefined) result.set(id, hit);
    else missing.push(id);
  }
  if (missing.length) {
    const snaps = await db.getAll(...missing.map(id => db.doc(`users/${id}/public/profile`)));
    snaps.forEach((snap, i) => {
      const value = summarize(snap.exists ? snap.data() : null);
      cache?.set(missing[i], value);
      result.set(missing[i], value);
    });
  }
  return result;
}

const createdMs = data => data?.createdAt?.toMillis?.() || 0;
const newestFirst = (a, b) => createdMs(b.data) - createdMs(a.data) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
const isVisiblePair = (data, uid) => Array.isArray(data?.participants) && data.participants.includes(uid) && ['active', 'ended'].includes(data.status);

/**
 * One page of the member's connections, newest first, with where the next page starts. Reads one page (plus one, to know
 * whether there is more) when the ordered query is available. If its index has not been created yet, it falls back to
 * reading the member's connections once and slicing in memory, so paging works either way.
 */
export async function listPairsPage(db, uid, { limit, before }) {
  const cursor = decodeCursor(before);
  const base = db.collection('signalsPairs').where('participants', 'array-contains', uid);
  let docs;
  let ordered = true;
  try {
    let query = base.orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
    if (cursor) query = query.startAfter(Timestamp.fromMillis(cursor.millis), cursor.id);
    docs = (await query.limit(limit + 1).get()).docs.map(snap => ({ id: snap.id, data: snap.data() }));
  } catch (error) {
    if (error?.code !== 9) throw error;
    ordered = false;
    const all = (await base.limit(PAIR_LEGACY_LIMIT).get()).docs.map(snap => ({ id: snap.id, data: snap.data() })).sort(newestFirst);
    const start = cursor ? all.findIndex(item => createdMs(item.data) < cursor.millis || (createdMs(item.data) === cursor.millis && item.id < cursor.id)) : 0;
    docs = start < 0 ? [] : all.slice(start, start + limit + 1);
  }
  const hasMore = docs.length > limit;
  const page = docs.slice(0, limit);
  const last = page[page.length - 1];
  return {
    ordered,
    nextCursor: hasMore && last ? encodeCursor(createdMs(last.data), last.id) : null,
    pairs: page.filter(item => isVisiblePair(item.data, uid)),
  };
}

/** The member's full list, as before: up to 100, newest first. */
export async function listPairsLegacy(db, uid) {
  const snap = await db.collection('signalsPairs').where('participants', 'array-contains', uid).limit(PAIR_LEGACY_LIMIT).get();
  return snap.docs.map(item => ({ id: item.id, data: item.data() })).filter(item => isVisiblePair(item.data, uid)).sort(newestFirst);
}

/** One connection of the member's, or null: a stranger's, a missing one and an unusable one all look the same. */
export async function getOnePair(db, uid, pairId) {
  if (!SAFE_ID.test(String(pairId))) return null;
  const snap = await db.doc(`signalsPairs/${pairId}`).get();
  if (!snap.exists) return null;
  return isVisiblePair(snap.data(), uid) ? { id: snap.id, data: snap.data() } : null;
}

/** The shape the app receives for a connection, without the other person's summary. */
export function shapePair({ id, data }, uid) {
  return {
    partnerId: data.participants.find(participant => participant !== uid),
    id,
    invitationId: data.invitationId || id,
    participants: data.participants,
    status: data.status,
    createdAt: data.createdAt?.toDate?.().toISOString?.() || null,
    endedAt: data.endedAt?.toDate?.().toISOString?.() || null,
    endedBy: data.endedBy || null,
  };
}

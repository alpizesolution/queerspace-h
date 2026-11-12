// What the Signals inbox reads, kept cheap: connections a page at a time (newest first), one connection on request, and the
// other person's pseudonym and avatar from a short-lived memory of what was just read. Used by api/signals.js.
//
// Everything here is opt-in from the client (a page size, a pair id, a status), so a client that asks for none of it gets the
// same full list as before. Underscore-prefixed files in api/ are not deployed as separate functions.
import { FieldPath, Timestamp } from 'firebase-admin/firestore';

/** How much of a message the inbox keeps as its one-line preview. */
export const PREVIEW_MAX = 80;

/**
 * The one-line preview of a message for the inbox rows: a GIF and a card say what they are, everything else is the text, on one
 * line and cut to PREVIEW_MAX. Kept on the member's own inbox document (only they can read it), so the list shows the latest
 * message without reading any messages.
 */
export function previewText(text, kind) {
  if (kind === 'gif') return 'GIF';
  if (kind === 'guess') return '✨ Someone guessed your Two Truths and a Lie!';
  if (kind === 'game') return '✨ Sent you a Two Truths and a Lie challenge.';
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  const body = flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1).trimEnd()}…` : flat;
  return kind === 'card' ? `Comfort Card: ${body}` : body;
}

/** The two inbox writes that go with a new message: the latest-message line for both people, and one more unread for the other. */
export function inboxWritesForMessage({ pairId, preview, senderPreview = preview, stamp, increment }) {
  return {
    recipient: { unread: { [pairId]: increment(1) }, last: { [pairId]: { text: preview, mine: false, at: stamp } } },
    sender: { last: { [pairId]: { text: senderPreview, mine: true, at: stamp } } },
  };
}

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

/** What a missing composite index looks like (Firestore FAILED_PRECONDITION): a clear, specific error instead of a quietly shorter list. */
export function inboxIndexError(error) {
  return Object.assign(new Error('inbox_index_missing'), {
    statusCode: 503,
    cause: error,
    detail: 'The signalsPairs index (participants array-contains, createdAt desc) is not deployed. Run: firebase deploy --only firestore:indexes',
  });
}

const orderedPairs = (db, uid) => db.collection('signalsPairs').where('participants', 'array-contains', uid)
  .orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc');

/**
 * One page of the member's connections, newest first, with where the next page starts. It reads one page (plus one, to know
 * whether there is more). There is deliberately NO fallback for a missing index: an unordered read capped at some number would
 * quietly leave connections out. A missing index is reported as a clear error (503 inbox_index_missing) so it gets fixed.
 */
export async function listPairsPage(db, uid, { limit, before }) {
  const cursor = decodeCursor(before);
  let query = orderedPairs(db, uid);
  if (cursor) query = query.startAfter(Timestamp.fromMillis(cursor.millis), cursor.id);
  let docs;
  try {
    docs = (await query.limit(limit + 1).get()).docs.map(snap => ({ id: snap.id, data: snap.data() }));
  } catch (error) {
    if (error?.code === 9) {
      console.error('[Signals API] inbox_index_missing: deploy the signalsPairs index (firebase deploy --only firestore:indexes).');
      throw inboxIndexError(error);
    }
    throw error;
  }
  const hasMore = docs.length > limit;
  const page = docs.slice(0, limit);
  const last = page[page.length - 1];
  return {
    ordered: true,
    nextCursor: hasMore && last ? encodeCursor(createdMs(last.data), last.id) : null,
    pairs: page.filter(item => isVisiblePair(item.data, uid)),
  };
}

/** The member's list for a client that asks for no page: the newest PAIR_LEGACY_LIMIT, newest first (never an arbitrary subset). */
export async function listPairsLegacy(db, uid) {
  try {
    const snap = await orderedPairs(db, uid).limit(PAIR_LEGACY_LIMIT).get();
    return snap.docs.map(item => ({ id: item.id, data: item.data() })).filter(item => isVisiblePair(item.data, uid)).sort(newestFirst);
  } catch (error) {
    if (error?.code === 9) {
      console.error('[Signals API] inbox_index_missing: deploy the signalsPairs index (firebase deploy --only firestore:indexes).');
      throw inboxIndexError(error);
    }
    throw error;
  }
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

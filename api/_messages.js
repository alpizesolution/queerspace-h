// How a Signals conversation's history is read, a page at a time and newest first. Used by api/signals.js (view=messages).
//
// Opening a conversation always loads the NEWEST page. Older messages are fetched on request with a cursor (`before`), so a long
// conversation never has to be read in one go and its most recent messages can never be the ones left out. The cursor is the
// position of the oldest message already shown (its createdAt at full precision, then its id), checked here before it is used.
// Underscore-prefixed files in api/ are not deployed as separate functions.
import { FieldPath, Timestamp } from 'firebase-admin/firestore';

/** Messages per page when the app asks for a page without saying how many. */
export const MESSAGE_PAGE_DEFAULT = 50;
/** The most a page ever holds. Also what a client that sends no page size at all gets: the newest 100, never the oldest 100. */
export const MESSAGE_PAGE_MAX = 100;

/** A page size from a request. A request that names none gets the largest page, so older apps still see the newest messages. */
export function parseMessageLimit(value) {
  if (value === undefined || value === null || value === '') return MESSAGE_PAGE_MAX;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return MESSAGE_PAGE_DEFAULT;
  return Math.min(n, MESSAGE_PAGE_MAX);
}

const SAFE_ID = /^[A-Za-z0-9_-]{8,128}$/;

/** "<seconds>.<nanoseconds>.<messageId>": where the next, older page starts. Opaque to the app. */
export const encodeMessageCursor = (createdAt, id) => `${createdAt.seconds}.${createdAt.nanoseconds}.${id}`;

export function decodeMessageCursor(value) {
  if (typeof value !== 'string') return null;
  const [seconds, nanos, ...rest] = value.split('.');
  const id = rest.join('.');
  const s = Number(seconds);
  const n = Number(nanos);
  return Number.isInteger(s) && s >= 0 && Number.isInteger(n) && n >= 0 && n < 1e9 && SAFE_ID.test(id) ? { seconds: s, nanos: n, id } : null;
}

/**
 * One page of a conversation's messages: the newest page when `before` is absent, otherwise the page just older than the cursor.
 * The documents come back oldest first (the order the thread is shown in), with `olderCursor` set only when there are more.
 */
export async function listMessagesPage(messagesRef, { limit, before }) {
  const cursor = before === undefined || before === null || before === '' ? null : decodeMessageCursor(before);
  if (before !== undefined && before !== null && before !== '' && !cursor) return { invalid: true, docs: [], olderCursor: null };
  let query = messagesRef.orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
  if (cursor) query = query.startAfter(new Timestamp(cursor.seconds, cursor.nanos), cursor.id);
  const snap = await query.limit(limit + 1).get();
  const hasMore = snap.docs.length > limit;
  const page = snap.docs.slice(0, limit);
  const oldest = page[page.length - 1];
  const stamp = oldest?.data()?.createdAt;
  return {
    invalid: false,
    docs: page.slice().reverse(),
    olderCursor: hasMore && oldest && stamp instanceof Timestamp ? encodeMessageCursor(stamp, oldest.id) : null,
  };
}

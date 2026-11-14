// Images in Support Chat: a member (or the team) attaches a picture to the support conversation. Unlike timed Signals photos these have
// NO timer and never expire: they stay in the conversation, in the same private Cloudflare R2 bucket, under their own prefix
// (support/{threadId}/{messageId}).
//
// The browser never writes the message: the real bytes are inspected here (a still JPEG, PNG or WebP), camera metadata is removed, the
// picture is stored, and then the message and the thread summary are written with the Admin SDK. Support chat keeps its existing access
// rules: only that member and admins can see a thread, and the picture is served only by the permission-checked view below (never a
// public link). A suspended member can still use support, exactly like text.
// Underscore-prefixed files in api/ are not deployed as separate functions.
import { FieldValue } from 'firebase-admin/firestore';
import { HttpError, rateLimit, requireAdmin } from './_lib.js';
import { currentMediaStore, inspectImage, stripMetadata } from './_media.js';

/** The largest picture accepted, in bytes (after the app has shrunk it). */
export const MAX_SUPPORT_IMAGE_BYTES = 3_000_000;
export const SUPPORT_IMAGES_PER_HOUR = 20;
export const SUPPORT_IMAGE_VIEWS_PER_MINUTE = 120;
/** What the message, the thread summary and the admin list say in place of text. */
export const SUPPORT_IMAGE_TEXT = '📷 Photo';

const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const keyOf = (threadId, messageId) => `support/${threadId}/${messageId}`;
const fail = (status, code) => new HttpError(status, code);

async function isAdmin(db, decoded) {
  try { await requireAdmin(db, decoded); return true; } catch { return false; }
}

/** Who may use a thread: its own member, or an admin. Returns { threadId, from }. */
async function resolveThread(db, uid, decoded, requested) {
  const threadId = requested === undefined || requested === null ? uid : requested;
  if (!safeId(threadId)) throw fail(400, 'invalid_request');
  if (threadId === uid) return { threadId, from: 'user' };
  if (!(await isAdmin(db, decoded))) throw fail(403, 'not_allowed');
  return { threadId, from: 'team' };
}

/** Sends one picture into a support thread. Safe to repeat: the same messageId is one message. */
export async function sendSupportImage(db, uid, decoded, body, getStore = currentMediaStore) {
  if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['action', 'image', 'messageId', 'threadId'].includes(key))) throw fail(400, 'invalid_image');
  if (!safeId(body.messageId)) throw fail(400, 'invalid_image');
  const encoded = body.image;
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw fail(400, 'invalid_image');
  if (encoded.length > Math.ceil(MAX_SUPPORT_IMAGE_BYTES / 3) * 4 + 4) throw fail(413, 'image_too_large');
  const raw = Buffer.from(encoded, 'base64');
  if (raw.length > MAX_SUPPORT_IMAGE_BYTES) throw fail(413, 'image_too_large');
  const { threadId, from } = await resolveThread(db, uid, decoded, body.threadId);
  const messageRef = db.doc(`support_threads/${threadId}/messages/${body.messageId}`);
  const existing = await messageRef.get();
  if (existing.exists) {
    // A repeat of a send that already went through: answer with what is stored, never a second message.
    if (existing.data().from !== from || !existing.data().image) throw fail(409, 'invalid_image');
    return { id: messageRef.id, from, replayed: true };
  }
  const image = inspectImage(raw);
  const store = getStore();
  if (!store) throw fail(503, 'storage_not_configured');
  await rateLimit(db, uid, 'support-image', SUPPORT_IMAGES_PER_HOUR, 60 * 60_000);
  await store.put(keyOf(threadId, messageRef.id), stripMetadata(raw, image.type), image.type);
  const threadRef = db.doc(`support_threads/${threadId}`);
  const batch = db.batch();
  batch.create(messageRef, { from, text: SUPPORT_IMAGE_TEXT, image: { type: image.type, width: image.width, height: image.height }, timestamp: FieldValue.serverTimestamp() });
  if (from === 'user') {
    const profile = (await db.doc(`users/${uid}/public/profile`).get()).data() ?? {};
    const name = typeof profile.displayName === 'string' && profile.displayName.trim() ? profile.displayName.trim().slice(0, 30) : 'Sapphic Guest';
    batch.set(threadRef, {
      displayName: name,
      ...(typeof profile.avatar === 'string' && profile.avatar.length <= 24 ? { avatar: profile.avatar } : {}),
      lastMessage: SUPPORT_IMAGE_TEXT, lastFrom: 'user', updatedAt: FieldValue.serverTimestamp(), unreadForTeam: true,
    }, { merge: true });
  } else {
    batch.set(threadRef, { lastMessage: SUPPORT_IMAGE_TEXT, lastFrom: 'team', updatedAt: FieldValue.serverTimestamp(), unreadForUser: true, unreadForTeam: false }, { merge: true });
  }
  try {
    await batch.commit();
  } catch (error) {
    // ALREADY_EXISTS: a simultaneous repeat won the race; the picture is the same one.
    if (error?.code !== 6) throw error;
  }
  return { id: messageRef.id, from, replayed: false };
}

/** The picture of one support message, for that thread's member or an admin. Anything else is the same "not found". */
export async function supportImageView(db, uid, decoded, query, getStore = currentMediaStore) {
  const { threadId: requested, messageId } = query;
  if (!safeId(messageId) || !safeId(requested)) throw fail(400, 'invalid_request');
  await rateLimit(db, uid, 'support-image-view', SUPPORT_IMAGE_VIEWS_PER_MINUTE, 60_000);
  if (requested !== uid && !(await isAdmin(db, decoded))) throw fail(404, 'not_found');
  const message = await db.doc(`support_threads/${requested}/messages/${messageId}`).get();
  if (!message.exists || !message.data().image) throw fail(404, 'not_found');
  const store = getStore();
  if (!store) throw fail(503, 'storage_not_configured');
  let bytes;
  try { bytes = await store.get(keyOf(requested, messageId)); } catch { throw fail(404, 'not_found'); }
  return { image: bytes.toString('base64'), contentType: inspectImage(bytes).type };
}

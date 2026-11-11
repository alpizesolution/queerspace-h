// Timed photos for Signals: images that exist only for a few seconds after the recipient opens them.
//
// The photo never becomes a normal attachment. The bytes live in a PRIVATE Cloudflare R2 object under a random key; the
// key, the timer and the viewing state live in `signalsMedia/{mediaId}`, a server-only collection (no client rule, so
// clients are denied). The conversation holds only a message with the media id and the timer. There is no URL anywhere:
// the recipient asks the server to open the photo, and the server (a) checks they may still message the sender,
// (b) starts the one and only viewing window, and (c) returns the image in that single response, which is never cached.
// After the window the server refuses every request for it, whatever the app says, and the object is deleted.
//
// Underscore-prefixed files in api/ are not deployed as separate functions.
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { rateLimit } from './_lib.js';
import { inboxWritesForMessage, previewText } from './_inbox.js';
import { createKeyedQueue, withContentionRetry } from './_requests.js';

/** The only viewing times a photo can have, in seconds. Anything else is refused on the client and here. */
export const PHOTO_TIMERS = [3, 5, 8];
export const DEFAULT_PHOTO_TIMER = 3;
export const isPhotoTimer = value => Number.isInteger(value) && PHOTO_TIMERS.includes(value);

/** Raw image bytes after the app has already shrunk the photo; the request is base64 JSON, which must stay under 4.5 MB. */
export const MAX_PHOTO_BYTES = 2_500_000;
export const MAX_PHOTO_SIDE = 6000;
export const MAX_PHOTO_PIXELS = 24_000_000;
/** A photo nobody opens does not last forever: it expires this long after it was sent. */
export const UNOPENED_TTL_MS = 24 * 60 * 60 * 1000;
/** An upload that never completed (the app died, the database write failed) is cleaned up after this long. */
export const PENDING_TTL_MS = 60 * 60 * 1000;
export const PHOTOS_PER_MINUTE = 10;
const PHOTO_TEXT = '📷 Photo';

const fail = (statusCode, code) => Object.assign(new Error(code), { statusCode });
/** Server-side log of why storage failed: the step and an error code only, so it can be diagnosed without leaking anything. */
const logMedia = (step, detail) => console.error(`[Media] ${step}${detail ? `: ${detail}` : ''}`);
const notConfigured = () => {
  logMedia('R2 is not configured', `missing ${r2Config().missing.join(', ') || 'nothing (store unavailable)'}`);
  return fail(503, 'media_not_configured');
};
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const toMs = value => (typeof value?.toMillis === 'function' ? value.toMillis() : null);

/** Headers for any response that carries a photo: it must never be stored by the browser, a proxy or a CDN. */
export function setNoStoreHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

// ------------------------------------------------------------------------------------------------ the image itself

/**
 * Looks at the real bytes, never at a file name or a claimed type, and accepts only a still JPEG, PNG or WebP of a sane
 * size. Everything else (SVG, GIF, HTML, scripts, executables, animated or truncated images) is refused.
 * Returns the type and size, or throws invalid_image.
 */
export function inspectImage(buffer) {
  const bad = () => fail(400, 'invalid_image');
  if (!Buffer.isBuffer(buffer) || buffer.length < 32) throw bad();
  let type;
  let width;
  let height;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    type = 'image/jpeg';
    let at = 2;
    while (at + 4 <= buffer.length) {
      if (buffer[at] !== 0xff) throw bad();
      const marker = buffer[at + 1];
      if (marker === 0xff) { at += 1; continue; }
      if (marker === 0xd9) break;
      const length = buffer.readUInt16BE(at + 2);
      if (length < 2 || at + 2 + length > buffer.length) throw bad();
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) {
        if (length < 8) throw bad();
        height = buffer.readUInt16BE(at + 5);
        width = buffer.readUInt16BE(at + 7);
        break;
      }
      if (marker === 0xda) throw bad();
      at += 2 + length;
    }
    if (!width || !height || buffer[buffer.length - 2] !== 0xff || buffer[buffer.length - 1] !== 0xd9) throw bad();
  } else if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    type = 'image/png';
    if (buffer.readUInt32BE(8) !== 13 || buffer.toString('latin1', 12, 16) !== 'IHDR') throw bad();
    width = buffer.readUInt32BE(16);
    height = buffer.readUInt32BE(20);
    const chunks = pngChunks(buffer);
    if (!chunks.some(chunk => chunk.type === 'IDAT') || chunks[chunks.length - 1].type !== 'IEND') throw bad();
  } else if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') {
    type = 'image/webp';
    if (buffer.readUInt32LE(4) + 8 !== buffer.length) throw bad();
    const chunks = webpChunks(buffer);
    if (chunks.some(chunk => ['ANIM', 'ANMF'].includes(chunk.type))) throw bad();
    const first = chunks[0];
    if (!first) throw bad();
    const data = buffer.subarray(first.start, first.start + first.size);
    if (first.type === 'VP8X' && data.length >= 10) {
      width = 1 + (data[4] | (data[5] << 8) | (data[6] << 16));
      height = 1 + (data[7] | (data[8] << 8) | (data[9] << 16));
    } else if (first.type === 'VP8 ' && data.length >= 10 && data[3] === 0x9d && data[4] === 0x01 && data[5] === 0x2a) {
      width = data.readUInt16LE(6) & 0x3fff;
      height = data.readUInt16LE(8) & 0x3fff;
    } else if (first.type === 'VP8L' && data.length >= 5 && data[0] === 0x2f) {
      const bits = data.readUInt32LE(1);
      width = 1 + (bits & 0x3fff);
      height = 1 + ((bits >> 14) & 0x3fff);
    } else throw bad();
  } else {
    throw bad();
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > MAX_PHOTO_SIDE || height > MAX_PHOTO_SIDE || width * height > MAX_PHOTO_PIXELS) throw bad();
  return { type, width, height };
}

/** The chunks of a PNG, each with its type and where it sits; throws on a chunk that runs past the end. */
function pngChunks(buffer) {
  const chunks = [];
  let at = 8;
  while (at < buffer.length) {
    if (at + 12 > buffer.length) throw fail(400, 'invalid_image');
    const length = buffer.readUInt32BE(at);
    const end = at + 12 + length;
    if (end > buffer.length) throw fail(400, 'invalid_image');
    chunks.push({ type: buffer.toString('latin1', at + 4, at + 8), start: at, end });
    at = end;
  }
  return chunks;
}

/** The chunks of a WebP file, each with its type, data start and data size. */
function webpChunks(buffer) {
  const chunks = [];
  let at = 12;
  while (at + 8 <= buffer.length) {
    const size = buffer.readUInt32LE(at + 4);
    const dataEnd = at + 8 + size;
    if (dataEnd > buffer.length) throw fail(400, 'invalid_image');
    chunks.push({ type: buffer.toString('latin1', at, at + 4), start: at + 8, size, at, end: dataEnd + (size % 2) });
    at = dataEnd + (size % 2);
  }
  return chunks;
}

/**
 * Removes what a photo can carry besides the picture: EXIF (including GPS position), XMP, text comments, timestamps and
 * other metadata. The picture's pixels are copied byte for byte, so nothing is re-encoded. Input must already have passed
 * inspectImage.
 */
export function stripMetadata(buffer, type) {
  if (type === 'image/jpeg') {
    const parts = [buffer.subarray(0, 2)];
    let at = 2;
    while (at + 4 <= buffer.length) {
      const marker = buffer[at + 1];
      if (marker === 0xff) { at += 1; continue; }
      if (marker === 0xd9) { parts.push(buffer.subarray(at)); at = buffer.length; break; }
      const length = buffer.readUInt16BE(at + 2);
      const segment = buffer.subarray(at, at + 2 + length);
      if (marker === 0xda) { parts.push(buffer.subarray(at)); at = buffer.length; break; }
      const isIcc = marker === 0xe2 && segment.toString('latin1', 4, 15) === 'ICC_PROFILE';
      const drop = (marker >= 0xe1 && marker <= 0xef && !isIcc) || marker === 0xfe;
      if (!drop) parts.push(segment);
      at += 2 + length;
    }
    return Buffer.concat(parts);
  }
  if (type === 'image/png') {
    const keep = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD']);
    return Buffer.concat([buffer.subarray(0, 8), ...pngChunks(buffer).filter(chunk => keep.has(chunk.type)).map(chunk => buffer.subarray(chunk.start, chunk.end))]);
  }
  const kept = webpChunks(buffer).filter(chunk => !['EXIF', 'XMP '].includes(chunk.type)).map(chunk => {
    const piece = Buffer.from(buffer.subarray(chunk.at, chunk.end));
    if (chunk.type === 'VP8X') piece[8] &= ~(0x08 | 0x04);
    return piece;
  });
  const body = Buffer.concat([Buffer.from('WEBP'), ...kept]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

// ------------------------------------------------------------------------------------------------ Cloudflare R2

const sha256 = data => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const encodeSegment = value => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * AWS Signature Version 4, which R2's S3 API accepts. Returns the Authorization header value for one request.
 * `headers` are the lower-cased headers to sign (at least host and x-amz-date).
 */
export function signV4({ method, path, query = '', headers, payloadHash, accessKeyId, secretAccessKey, region, service, amzDate }) {
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map(name => `${name}:${String(headers[name]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const canonical = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

/**
 * A private R2 bucket reached over its S3 API with server-side credentials. Nothing here is ever sent to a browser, and
 * objects are never made public. `endpoint` is the account endpoint, such as https://<account>.r2.cloudflarestorage.com.
 */
export function createR2Store({ endpoint, bucket, accessKeyId, secretAccessKey, fetchImpl = fetch, now = () => new Date() }) {
  const base = new URL(endpoint);
  const call = async (method, key, body, contentType) => {
    const path = `/${encodeSegment(bucket)}/${key.split('/').map(encodeSegment).join('/')}`;
    const amzDate = now().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const payloadHash = sha256(body ?? '');
    const headers = { host: base.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...(contentType ? { 'content-type': contentType } : {}) };
    const authorization = signV4({ method, path, headers, payloadHash, accessKeyId, secretAccessKey, region: 'auto', service: 's3', amzDate });
    const { host, ...sent } = headers;
    return fetchImpl(`${base.origin}${path}`, { method, headers: { ...sent, authorization }, ...(body ? { body } : {}) });
  };
  return {
    async put(key, body, contentType) {
      const response = await call('PUT', key, body, contentType);
      if (!response.ok) throw Object.assign(new Error('r2_put_failed'), { code: `r2_${response.status}` });
    },
    async get(key) {
      const response = await call('GET', key);
      if (response.status === 404) throw Object.assign(new Error('r2_not_found'), { code: 'not_found' });
      if (!response.ok) throw Object.assign(new Error('r2_get_failed'), { code: `r2_${response.status}` });
      return Buffer.from(await response.arrayBuffer());
    },
    /** Deleting an object that is already gone is a success, so a retry is always safe. */
    async delete(key) {
      const response = await call('DELETE', key);
      if (!response.ok && response.status !== 404) throw Object.assign(new Error('r2_delete_failed'), { code: `r2_${response.status}` });
    },
  };
}

/**
 * What the server's environment gives R2: the account endpoint, the bucket, and the two access keys. Cloudflare shows the
 * endpoint with the bucket on the end (https://<account>.r2.cloudflarestorage.com/<bucket>), so when R2_BUCKET is not set
 * the bucket is read from there. Reports only the NAMES of what is missing, never any value.
 */
export function r2Config(env = process.env) {
  const clean = value => (typeof value === 'string' ? value.trim() : '');
  let endpoint = clean(env.R2_ENDPOINT);
  let bucket = clean(env.R2_BUCKET);
  const missing = [];
  let origin = '';
  if (endpoint) {
    try {
      const url = new URL(/^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`);
      origin = url.origin;
      const first = url.pathname.split('/').filter(Boolean)[0];
      if (!bucket && first) bucket = decodeURIComponent(first);
    } catch {
      endpoint = '';
    }
  }
  if (!origin) missing.push('R2_ENDPOINT');
  if (!bucket) missing.push('R2_BUCKET');
  if (!clean(env.R2_ACCESS_KEY_ID)) missing.push('R2_ACCESS_KEY_ID');
  if (!clean(env.R2_SECRET_ACCESS_KEY)) missing.push('R2_SECRET_ACCESS_KEY');
  return { configured: missing.length === 0, missing, endpoint: origin, bucket, accessKeyId: clean(env.R2_ACCESS_KEY_ID), secretAccessKey: clean(env.R2_SECRET_ACCESS_KEY) };
}

/** The store from the server's environment, or null when R2 is not configured (the feature then says it is not set up). */
export function storeFromEnv(env = process.env) {
  const config = r2Config(env);
  if (!config.configured) return null;
  return createR2Store({ endpoint: config.endpoint, bucket: config.bucket, accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey });
}

/**
 * Tries the storage the way a photo would use it: write a tiny random object, read it back, delete it. Reports which step
 * failed and with what code, never a credential or a URL. Used by the protected check on the cleanup endpoint.
 */
export async function checkStorage(store, env = process.env) {
  const config = r2Config(env);
  if (!store) return { configured: false, missing: config.missing };
  const key = `check/${randomBytes(12).toString('base64url')}`;
  const body = Buffer.from('queerspace-storage-check');
  const steps = { put: 'skipped', get: 'skipped', delete: 'skipped' };
  const codeOf = error => String(error?.code ?? error?.message ?? 'failed').slice(0, 40);
  try { await store.put(key, body, 'text/plain'); steps.put = 'ok'; } catch (error) { steps.put = codeOf(error); }
  if (steps.put === 'ok') {
    try { steps.get = (await store.get(key)).equals(body) ? 'ok' : 'different'; } catch (error) { steps.get = codeOf(error); }
    try { await store.delete(key); steps.delete = 'ok'; } catch (error) { steps.delete = codeOf(error); }
  }
  return { configured: true, bucketFrom: env.R2_BUCKET ? 'R2_BUCKET' : 'R2_ENDPOINT', ...steps, ok: steps.put === 'ok' && steps.get === 'ok' && steps.delete === 'ok' };
}

let storeOverride = null;
/** Test seam: lets a test supply an in-memory store. Pass null to go back to the environment. */
export const setMediaStoreForTests = store => { storeOverride = store; };
const currentStore = () => storeOverride ?? storeFromEnv();

// -------------------------------------------------------------------------------------------- state of one photo

/**
 * Where a photo stands right now, judged by the server clock: unopened, viewing (inside its one window) or expired. A
 * missing or deleted record is expired. This is the only judge of expiry; the app's own countdown is just a display.
 */
export function photoState(meta, nowMs) {
  if (!meta) return { status: 'expired' };
  if (meta.state === 'viewing') {
    const expiresAt = toMs(meta.expiresAt);
    return expiresAt !== null && nowMs < expiresAt ? { status: 'viewing', expiresAt } : { status: 'expired' };
  }
  if (meta.state === 'unopened') {
    const until = toMs(meta.unopenedUntil);
    return until !== null && nowMs < until ? { status: 'unopened', until } : { status: 'expired' };
  }
  return { status: 'expired' };
}

/** What a member sees of a photo message: never the key, the media id or any location of the image. */
export function photoView(message, meta, uid, nowMs) {
  const state = photoState(meta, nowMs);
  const mine = message.senderId === uid;
  const status = state.status === 'expired' ? 'expired' : mine ? (state.status === 'viewing' ? 'opened' : 'sent') : state.status;
  return { durationSec: message.durationSec, status, mine, ...(state.status === 'viewing' ? { expiresAt: state.expiresAt } : {}), ...(state.status === 'unopened' ? { until: state.until } : {}) };
}

// ---------------------------------------------------------------------------------------------------- handlers

export function createMediaHandlers({ getStore = currentStore, now = Date.now } = {}) {
  const queue = createKeyedQueue();

  /** Who may touch photos in this conversation right now: an active pair, both members free of blocks and suspensions. */
  async function pairAccess(db, uid, pairId) {
    const pairRef = db.doc(`signalsPairs/${pairId}`);
    const pairSnap = await pairRef.get();
    if (!pairSnap.exists) throw fail(404, 'pair_not_found');
    const pair = pairSnap.data();
    if (!Array.isArray(pair.participants) || !pair.participants.includes(uid)) throw fail(403, 'not_allowed');
    if (pair.status !== 'active') throw fail(409, 'pair_not_active');
    const otherUid = pair.participants.find(participant => participant !== uid);
    if (!otherUid) throw fail(403, 'not_allowed');
    const [ownSettings, otherSettings, ownSuspension, otherSuspension] = await Promise.all([
      db.doc(`users/${uid}/private/settings`).get(),
      db.doc(`users/${otherUid}/private/settings`).get(),
      db.doc(`suspensions/${uid}`).get(),
      db.doc(`suspensions/${otherUid}`).get(),
    ]);
    if (ownSuspension.exists || otherSuspension.exists) throw fail(403, 'account_unavailable');
    const ownBlocked = ownSettings.data()?.blockedPartnerIds;
    const otherBlocked = otherSettings.data()?.blockedPartnerIds;
    if ((Array.isArray(ownBlocked) && ownBlocked.includes(otherUid)) || (Array.isArray(otherBlocked) && otherBlocked.includes(uid))) throw fail(403, 'not_allowed');
    return { pairRef, otherUid };
  }

  /** Best effort, and always safe to repeat: makes a photo's record due for deletion now and tries to remove its object. */
  async function retire(db, ref, meta) {
    try {
      await ref.update({ state: 'expired', deleteAfter: Timestamp.fromMillis(now()) });
      const store = getStore();
      if (store && meta?.key) {
        await store.delete(meta.key);
        await ref.delete();
      }
    } catch {
      // The daily cleanup picks it up; the photo is already unreachable because its state says expired.
    }
  }

  async function sendPhoto(db, uid, body) {
    const pairId = body?.pairId;
    const requestedId = body?.messageId;
    if (!safeId(pairId) || (requestedId !== undefined && !safeId(requestedId))) throw fail(400, 'invalid_message');
    if (!isPhotoTimer(body?.timerSeconds)) throw fail(400, 'invalid_timer');
    const encoded = body?.image;
    if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw fail(400, 'invalid_image');
    if (encoded.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4 + 4) throw fail(413, 'image_too_large');
    const raw = Buffer.from(encoded, 'base64');
    if (raw.length > MAX_PHOTO_BYTES) throw fail(413, 'image_too_large');

    // Permission is checked before anything is stored, and the content is checked before anything is uploaded.
    const { pairRef, otherUid } = await pairAccess(db, uid, pairId);
    const image = inspectImage(raw);
    const clean = stripMetadata(raw, image.type);
    const messageRef = pairRef.collection('messages').doc(requestedId ?? randomUUID());
    const existing = await messageRef.get();
    if (existing.exists) {
      const stored = existing.data();
      if (stored.senderId !== uid || stored.kind !== 'photo') throw fail(409, 'invalid_message');
      return { status: 200, body: shapeSent(messageRef.id, uid, stored, stored.createdAt?.toDate?.().toISOString?.()) };
    }
    const store = getStore();
    if (!store) throw notConfigured();
    await queue.run(`photo-rate:${uid}`, () => rateLimit(db, uid, 'signals-photo', PHOTOS_PER_MINUTE, 60_000));

    const mediaId = randomUUID();
    const key = `m/${randomBytes(24).toString('base64url')}`;
    const metaRef = db.doc(`signalsMedia/${mediaId}`);
    const sentAt = now();
    // The record is written first, due for deletion in an hour: if anything below fails, the cleanup removes the object.
    await metaRef.create({
      pairId, messageId: messageRef.id, senderId: uid, recipientId: otherUid, key, contentType: image.type, bytes: clean.length,
      durationSec: body.timerSeconds, state: 'pending', createdAt: Timestamp.fromMillis(sentAt), deleteAfter: Timestamp.fromMillis(sentAt + PENDING_TTL_MS), attempts: 0,
    });
    try {
      await store.put(key, clean, image.type);
    } catch (error) {
      logMedia('R2 upload failed', String(error?.code ?? error?.message ?? 'unknown').slice(0, 60));
      throw fail(502, 'media_storage_failed');
    }
    const stamp = FieldValue.serverTimestamp();
    try {
      const batch = db.batch();
      batch.update(metaRef, { state: 'unopened', unopenedUntil: Timestamp.fromMillis(sentAt + UNOPENED_TTL_MS), deleteAfter: Timestamp.fromMillis(sentAt + UNOPENED_TTL_MS) });
      batch.create(messageRef, { senderId: uid, kind: 'photo', text: PHOTO_TEXT, mediaId, durationSec: body.timerSeconds, createdAt: stamp, updatedAt: stamp });
      const writes = inboxWritesForMessage({ pairId, preview: previewText(PHOTO_TEXT, 'photo'), stamp, increment: FieldValue.increment });
      batch.set(db.doc(`signalsInbox/${otherUid}`), writes.recipient, { merge: true });
      batch.set(db.doc(`signalsInbox/${uid}`), writes.sender, { merge: true });
      await batch.commit();
    } catch (error) {
      // Either a concurrent copy of this same send won, or the message could not be saved. Either way this copy's object is
      // removed now (and by the cleanup if that fails), so nothing is left behind.
      await retire(db, metaRef, { key });
      if (error?.code !== 6) {
        logMedia('message could not be saved after upload', String(error?.code ?? error?.message ?? 'unknown').slice(0, 60));
        throw fail(503, 'photo_not_saved');
      }
      const stored = (await messageRef.get()).data();
      if (stored?.senderId !== uid || stored.kind !== 'photo') throw fail(409, 'invalid_message');
      return { status: 200, body: shapeSent(messageRef.id, uid, stored, stored.createdAt?.toDate?.().toISOString?.()) };
    }
    return { status: 201, body: shapeSent(messageRef.id, uid, { durationSec: body.timerSeconds }, new Date(sentAt).toISOString(), 'sent') };
  }

  const shapeSent = (id, uid, stored, createdAt, status = 'sent') => ({
    id, senderId: uid, kind: 'photo', text: PHOTO_TEXT, replyTo: null, reactions: [], createdAt: createdAt || new Date(now()).toISOString(),
    photo: { durationSec: stored.durationSec, status, mine: true },
  });

  async function openPhoto(db, uid, body) {
    const { pairId, messageId } = body ?? {};
    if (!safeId(pairId) || !safeId(messageId)) throw fail(400, 'invalid_request');
    const { pairRef } = await pairAccess(db, uid, pairId);
    const messageRef = pairRef.collection('messages').doc(messageId);
    const messageSnap = await messageRef.get();
    const message = messageSnap.exists ? messageSnap.data() : null;
    if (!message || message.kind !== 'photo' || !safeId(message.mediaId)) throw fail(404, 'photo_not_found');
    // Only the member the photo was sent to can open it. The sender never can, and nobody outside the conversation.
    if (message.senderId === uid) throw fail(403, 'not_allowed');
    const metaRef = db.doc(`signalsMedia/${message.mediaId}`);
    const metaSnap = await metaRef.get();
    const meta = metaSnap.exists ? metaSnap.data() : null;
    if (!meta) throw fail(410, 'photo_expired');
    if (meta.recipientId !== uid || meta.pairId !== pairId || meta.messageId !== messageId) throw fail(403, 'not_allowed');
    if (photoState(meta, now()).status === 'expired') {
      await retire(db, metaRef, meta);
      throw fail(410, 'photo_expired');
    }
    const store = getStore();
    if (!store) throw notConfigured();
    // Fetch before starting the clock, so a storage failure never uses up the one viewing.
    let bytes;
    try {
      bytes = await store.get(meta.key);
    } catch (error) {
      if (error?.code === 'not_found') throw fail(410, 'photo_expired');
      logMedia('R2 read failed', String(error?.code ?? error?.message ?? 'unknown').slice(0, 60));
      throw fail(502, 'media_storage_failed');
    }
    // One viewing window per photo. The first request to get here starts it; any other request, however many and however
    // simultaneous, gets the same end time and can never move it.
    const claim = await queue.run(`photo:${message.mediaId}`, () => withContentionRetry(() => db.runTransaction(async tx => {
      const snap = await tx.get(metaRef);
      const current = snap.exists ? snap.data() : null;
      const state = photoState(current, now());
      if (state.status === 'expired') return { expired: true };
      if (state.status === 'viewing') return { expiresAt: state.expiresAt, firstOpen: false };
      const startedAt = now();
      const expiresAt = startedAt + current.durationSec * 1000;
      tx.update(metaRef, { state: 'viewing', openedAt: Timestamp.fromMillis(startedAt), expiresAt: Timestamp.fromMillis(expiresAt), deleteAfter: Timestamp.fromMillis(expiresAt) });
      tx.update(messageRef, { updatedAt: FieldValue.serverTimestamp() });
      return { expiresAt, firstOpen: true };
    }, { maxAttempts: 1 }), { budgetMs: 6000, now }));
    if (claim.expired) throw fail(410, 'photo_expired');
    return {
      status: 200,
      body: { image: bytes.toString('base64'), contentType: meta.contentType, durationSec: meta.durationSec, expiresAt: claim.expiresAt, remainingMs: Math.max(0, claim.expiresAt - now()) },
    };
  }

  /** Photo details for a page of messages, from the records, with no key or media id in them. */
  async function photoViews(db, uid, docs) {
    const photos = docs.filter(snap => snap.data().kind === 'photo' && safeId(snap.data().mediaId));
    if (!photos.length) return new Map();
    const metas = await db.getAll(...photos.map(snap => db.doc(`signalsMedia/${snap.data().mediaId}`)));
    const at = now();
    return new Map(photos.map((snap, i) => [snap.id, photoView(snap.data(), metas[i].exists ? metas[i].data() : null, uid, at)]));
  }

  /**
   * Deletes the objects and records of photos that are due: expired, never opened for a day, or an upload that never
   * finished. A failed deletion is retried later with a growing pause, never dropped, and deleting twice is harmless.
   */
  async function sweep(db, { limit = 50 } = {}) {
    const store = getStore();
    if (!store) throw notConfigured();
    const due = await db.collection('signalsMedia').where('deleteAfter', '<=', Timestamp.fromMillis(now())).limit(limit).get();
    let deleted = 0;
    let failed = 0;
    for (const snap of due.docs) {
      const meta = snap.data();
      try {
        await store.delete(meta.key);
        await snap.ref.delete();
        deleted += 1;
      } catch (error) {
        failed += 1;
        const attempts = (Number(meta.attempts) || 0) + 1;
        const pause = Math.min(15 * 60_000 * 2 ** Math.min(attempts, 5), 6 * 60 * 60_000);
        await snap.ref.update({ attempts, lastError: String(error?.code ?? 'delete_failed').slice(0, 40), deleteAfter: Timestamp.fromMillis(now() + pause) }).catch(() => {});
      }
    }
    return { due: due.size, deleted, failed };
  }

  return { sendPhoto, openPhoto, photoViews, sweep, currentStore: getStore };
}

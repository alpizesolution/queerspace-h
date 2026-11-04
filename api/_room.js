// Galaxy Room GIFs. Room text messages are written by the app straight to Firestore under firestore.rules, but a GIF needs
// a trusted step (GIPHY must be asked who this GIF really is, and its addresses checked), so a GIF message is written here
// by the server instead. The rules do not let a client create a message with GIF fields, so this is the only way to make one.
//
// The same safeguards as a text message apply, mirrored from firestore.rules: an adult member with a completed profile, not
// suspended, and the room's slow mode (shared with text through rate_limits/{uid}.publicRoom). On top of that, a per-minute
// cap on GIFs. The author's name, pronouns and avatar come from the member's own profile, never from the request.
//
// Underscore-prefixed files in api/ are not deployed as separate functions.
import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { isAdultMember } from './_adult.js';
import { rateLimit, safeId } from './_lib.js';
import { GIF_TEXT, isGifId, sharedGiphy, shapeStoredGif } from './_giphy.js';

export const ROOM_GIFS_PER_MINUTE = 10;
/** Seconds between room messages. Must match slowMode('publicRoom', 2) in firestore.rules. */
export const ROOM_SLOW_MODE_MS = 2000;

const fail = (statusCode, code) => Object.assign(new Error(code), { statusCode });
const clean = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const toMs = value => (typeof value?.toMillis === 'function' ? value.toMillis() : null);

const shapeSent = (id, gif) => ({ id, kind: 'gif', gif });

/**
 * Sends one GIF to the room. The request carries only the GIPHY id (and an optional message id so a retry cannot make a
 * second copy). Throws an error with a statusCode and a short code for every refusal.
 */
export async function sendRoomGif(db, uid, body, { giphy = sharedGiphy, now = Date.now } = {}) {
  const input = body && typeof body === 'object' ? body : {};
  // Nothing but the id: a link, a whole GIF object, or text cannot ride along.
  const allowed = new Set(['action', 'gifId', 'messageId']);
  if (!isGifId(input.gifId) || Object.keys(input).some(key => !allowed.has(key))) throw fail(400, 'invalid_gif');
  if (input.messageId !== undefined && !safeId(input.messageId)) throw fail(400, 'invalid_message');

  const messageRef = db.collection('public_room_messages').doc(input.messageId ?? randomUUID());
  const limitsRef = db.doc(`rate_limits/${uid}`);
  const [settings, profile, suspension, limits, earlier] = await Promise.all([
    db.doc(`users/${uid}/private/settings`).get(),
    db.doc(`users/${uid}/public/profile`).get(),
    db.doc(`suspensions/${uid}`).get(),
    limitsRef.get(),
    input.messageId ? messageRef.get() : Promise.resolve(null),
  ]);
  if (!isAdultMember(settings.data()) || profile.data()?.profileComplete !== true) throw fail(403, 'not_allowed');
  if (suspension.exists) throw fail(403, 'account_unavailable');

  if (earlier?.exists) {
    // A retry of a send that already went through: answer with what was stored, never a copy.
    const stored = earlier.data();
    const gif = shapeStoredGif(stored.gif);
    if (stored.authorId !== uid || stored.kind !== 'gif' || !gif) throw fail(409, 'invalid_message');
    return shapeSent(messageRef.id, gif);
  }

  const tooFast = snapshot => {
    const last = toMs(snapshot.data()?.publicRoom);
    return last !== null && last + ROOM_SLOW_MODE_MS > now();
  };
  if (tooFast(limits)) throw fail(429, 'too_fast');
  await rateLimit(db, uid, 'room-gif', ROOM_GIFS_PER_MINUTE, 60_000);

  const gif = await giphy.byId(input.gifId);
  const profileData = profile.data();
  const avatar = typeof profileData?.avatar === 'string' && profileData.avatar.length > 0 && profileData.avatar.length <= 24 ? profileData.avatar : null;
  try {
    await db.runTransaction(async tx => {
      if (tooFast(await tx.get(limitsRef))) throw fail(429, 'too_fast');
      tx.create(messageRef, {
        authorId: uid,
        authorName: clean(profileData?.displayName, 30) || 'Sapphic Guest',
        authorPronouns: clean(profileData?.pronouns, 20) || 'she/her',
        ...(avatar ? { authorAvatar: avatar } : {}),
        text: GIF_TEXT,
        kind: 'gif',
        gif,
        timestamp: FieldValue.serverTimestamp(),
      });
      tx.set(limitsRef, { publicRoom: FieldValue.serverTimestamp() }, { merge: true });
    });
  } catch (error) {
    if (error?.code !== 6) throw error; // ALREADY_EXISTS: the same send raced with itself
    const stored = (await messageRef.get()).data();
    const storedGif = shapeStoredGif(stored?.gif);
    if (stored?.authorId !== uid || stored.kind !== 'gif' || !storedGif) throw fail(409, 'invalid_message');
    return shapeSent(messageRef.id, storedGif);
  }
  return shapeSent(messageRef.id, gif);
}

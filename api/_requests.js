// Connection requests for the Cosmos "Looking For" board. A member who is interested in someone's post asks to connect;
// the post's author decides. Accepting opens a private Signals conversation (a signalsPairs doc), nothing more.
//
// Everything here runs on the server with the Admin SDK. Clients can read none of these collections (firestore.rules),
// so status changes only ever come from this file:
//   connection_requests        the requests themselves
//   connection_request_locks   one doc per sender+recipient: stops duplicate pending requests, even when two arrive at once,
//                              and holds the short cool-down after a decline
//   connection_request_events  the audit trail of every status change (admins only, never shown to members)
// Underscore-prefixed files in api/ are not deployed as separate functions.
import { randomUUID, createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { isAdultMember } from './_adult.js';

export const REQUEST_MAX_MESSAGE = 500;
export const REQUEST_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Anti-spam applies to the SENDER only. How many requests an author can receive is not limited. */
export const REQUEST_COOLDOWN_MS = 30 * 1000;
export const REQUEST_DAILY_LIMIT = 20;
export const REQUEST_DAY_MS = 24 * 60 * 60 * 1000;
export const REQUEST_PENDING_SENT_LIMIT = 30;
/** After a decline, the same member cannot ask the same person again for this long. */
export const DECLINE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
export const REQUEST_LIST_LIMIT = 100;

const fail = (statusCode, code) => Object.assign(new Error(code), { statusCode });
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const toMs = value => (typeof value?.toMillis === 'function' ? value.toMillis() : null);
const iso = value => value?.toDate?.().toISOString?.() || null;

/** What a sender may do right now, from their own recent history. Pure, so it can be tested without a database. */
export function checkSenderLimits({ nowMs, lastRequestAtMs = null, windowStartMs = null, windowCount = 0, pendingSent = 0 }) {
  if (lastRequestAtMs !== null && nowMs - lastRequestAtMs < REQUEST_COOLDOWN_MS) return { ok: false, status: 429, error: 'rate_limited' };
  if (pendingSent >= REQUEST_PENDING_SENT_LIMIT) return { ok: false, status: 429, error: 'too_many_pending' };
  let start = windowStartMs;
  let count = windowCount ?? 0;
  if (start === null || nowMs - start >= REQUEST_DAY_MS) {
    start = nowMs;
    count = 0;
  }
  if (count >= REQUEST_DAILY_LIMIT) return { ok: false, status: 429, error: 'daily_limit' };
  return { ok: true, next: { windowStartMs: start, windowCount: count + 1 } };
}

/** A pending request past its expiry is shown, and treated, as expired. */
export function effectiveStatus(data, nowMs) {
  const expires = toMs(data?.expiresAt);
  return data?.status === 'pending' && expires !== null && expires <= nowMs ? 'expired' : data?.status;
}

/** Whether a post can take new requests: it must exist and not be paused. */
export function postAvailability(post) {
  if (!post) return 'removed';
  return post.requestsPaused === true ? 'paused' : 'active';
}

const idemId = (uid, key) => createHash('sha256').update(`${uid}:request:${key}`).digest('hex');
const lockPath = (senderId, recipientId) => `connection_request_locks/${senderId}_${recipientId}`;

function blockedEither(ownSettings, otherSettings, ownId, otherId) {
  const own = ownSettings?.blockedPartnerIds;
  const other = otherSettings?.blockedPartnerIds;
  return (Array.isArray(own) && own.includes(otherId)) || (Array.isArray(other) && other.includes(ownId));
}

/** Public-safe preview of the other member: pseudonym, avatar, pronouns and the about-me they chose to publish. */
function profilePreview(profile) {
  const name = typeof profile?.displayName === 'string' ? profile.displayName.trim().slice(0, 30) : '';
  const avatar = typeof profile?.avatar === 'string' && profile.avatar.length <= 24 ? profile.avatar : null;
  const pronouns = typeof profile?.pronouns === 'string' ? profile.pronouns.trim().slice(0, 20) : '';
  const about = typeof profile?.aboutMe === 'string' ? profile.aboutMe.trim().slice(0, 160) : '';
  return { displayName: name || null, avatar, pronouns: pronouns || null, about: about || null };
}

export function createRequestHandlers({ touchInbox, acceptedNotification }) {
  const event = (tx, db, request, actorId, action, from, to) =>
    tx.create(db.collection('connection_request_events').doc(), {
      requestId: request, actorId, action, from, to, at: FieldValue.serverTimestamp(),
    });

  async function create(db, uid, body) {
    const { recipientId, lookingForPostId, message, idempotencyKey } = body;
    if (!safeId(recipientId) || recipientId === uid) throw fail(400, 'invalid_recipient');
    if (!safeId(lookingForPostId)) throw fail(400, 'invalid_post');
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 128) throw fail(400, 'invalid_idempotency_key');
    if (message !== undefined && (typeof message !== 'string' || message.trim().length > REQUEST_MAX_MESSAGE)) throw fail(400, 'invalid_message');

    const idemRef = db.doc(`signalsIdempotency/${idemId(uid, idempotencyKey)}`);
    const rateRef = db.doc(`signalsRateLimits/${uid}`);
    const lockRef = db.doc(lockPath(uid, recipientId));
    const requestRef = db.collection('connection_requests').doc(randomUUID());
    const now = Timestamp.now();
    const nowMs = now.toMillis();

    return db.runTransaction(async tx => {
      const [prior, rateSnap, senderSettings, recipientSettings, senderSuspension, recipientSuspension, postSnap, lockSnap, pendingSent, existingPair] = await Promise.all([
        tx.get(idemRef),
        tx.get(rateRef),
        tx.get(db.doc(`users/${uid}/private/settings`)),
        tx.get(db.doc(`users/${recipientId}/private/settings`)),
        tx.get(db.doc(`suspensions/${uid}`)),
        tx.get(db.doc(`suspensions/${recipientId}`)),
        tx.get(db.doc(`looking_for_posts/${lookingForPostId}`)),
        tx.get(lockRef),
        tx.get(db.collection('connection_requests').where('senderId', '==', uid).where('status', '==', 'pending').limit(REQUEST_PENDING_SENT_LIMIT + 1)),
        tx.get(db.collection('signalsPairs').where('participants', '==', [uid, recipientId].sort()).where('status', '==', 'active').limit(1)),
      ]);
      if (prior.exists) {
        const p = prior.data();
        if (p?.action !== 'request-create' || p?.recipientId !== recipientId) throw fail(409, 'idempotency_conflict');
        return { requestId: p.requestId, status: 'pending', replayed: true };
      }
      // Eligibility comes from the private account records, never from the request.
      if (!isAdultMember(senderSettings.data()) || !isAdultMember(recipientSettings.data())) throw fail(403, 'not_allowed');
      if (senderSuspension.exists || recipientSuspension.exists) throw fail(403, 'account_unavailable');
      if (blockedEither(senderSettings.data(), recipientSettings.data(), uid, recipientId)) throw fail(403, 'not_allowed');
      const post = postSnap.exists ? postSnap.data() : null;
      if (!post || post.authorId !== recipientId) throw fail(404, 'post_unavailable');
      if (postAvailability(post) === 'paused') throw fail(409, 'post_paused');
      const lock = lockSnap.exists ? lockSnap.data() : null;
      if (lock?.state === 'pending') throw fail(409, 'already_pending');
      if (lock?.state === 'cooling' && toMs(lock.until) > nowMs) throw fail(429, 'recently_declined');
      if (!existingPair.empty) throw fail(409, 'already_connected');
      const rate = rateSnap.data() ?? {};
      const limits = checkSenderLimits({
        nowMs,
        lastRequestAtMs: toMs(rate.lastRequestAt),
        windowStartMs: toMs(rate.requestWindowStart),
        windowCount: rate.requestWindowCount ?? 0,
        pendingSent: pendingSent.size,
      });
      if (!limits.ok) throw fail(limits.status, limits.error);

      const expiresAt = Timestamp.fromMillis(nowMs + REQUEST_TTL_MS);
      tx.create(requestRef, {
        senderId: uid,
        recipientId,
        lookingForPostId,
        intention: post.intention,
        message: typeof message === 'string' ? message.trim() : '',
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt,
      });
      tx.set(lockRef, { requestId: requestRef.id, state: 'pending', senderId: uid, recipientId, updatedAt: FieldValue.serverTimestamp() });
      tx.set(rateRef, {
        lastRequestAt: now,
        requestWindowStart: Timestamp.fromMillis(limits.next.windowStartMs),
        requestWindowCount: limits.next.windowCount,
      }, { merge: true });
      tx.create(idemRef, { action: 'request-create', recipientId, requestId: requestRef.id, createdAt: FieldValue.serverTimestamp() });
      event(tx, db, requestRef.id, uid, 'create', null, 'pending');
      touchInbox(tx, db, recipientId, undefined, { requests: { [requestRef.id]: expiresAt } });
      touchInbox(tx, db, uid);
      return { requestId: requestRef.id, status: 'pending', replayed: false };
    });
  }

  /** Loads a request and checks who is asking. Anyone who is not a participant is told it does not exist. */
  function mine(snap, uid, role) {
    if (!snap.exists) throw fail(404, 'request_not_found');
    const data = snap.data();
    if (data.senderId !== uid && data.recipientId !== uid) throw fail(404, 'request_not_found');
    if (role === 'recipient' && data.recipientId !== uid) throw fail(403, 'not_allowed');
    if (role === 'sender' && data.senderId !== uid) throw fail(403, 'not_allowed');
    return data;
  }

  /** Marks a pending request as expired, tidying everything that pointed at it. */
  function expire(tx, db, ref, data) {
    tx.update(ref, { status: 'expired', updatedAt: FieldValue.serverTimestamp(), respondedAt: FieldValue.serverTimestamp() });
    tx.delete(db.doc(lockPath(data.senderId, data.recipientId)));
    event(tx, db, ref.id, 'system', 'expire', 'pending', 'expired');
    touchInbox(tx, db, data.recipientId, undefined, { requests: { [ref.id]: FieldValue.delete() } });
    touchInbox(tx, db, data.senderId);
  }

  async function accept(db, uid, body) {
    if (!safeId(body.requestId)) throw fail(400, 'invalid_request');
    const ref = db.doc(`connection_requests/${body.requestId}`);
    return db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const data = mine(snap, uid, 'recipient');
      const nowMs = Date.now();
      // Repeating an accept is safe: it answers with the same conversation.
      if (data.status === 'accepted') return { status: 'accepted', conversationId: data.conversationId, replayed: true };
      if (data.status !== 'pending') throw fail(409, 'request_not_pending');
      if (effectiveStatus(data, nowMs) === 'expired') {
        expire(tx, db, ref, data);
        return { status: 'expired' };
      }
      const pairRef = db.doc(`signalsPairs/${ref.id}`);
      const [senderSettings, recipientSettings, senderSuspension, recipientSuspension, existingPair, ownPair] = await Promise.all([
        tx.get(db.doc(`users/${data.senderId}/private/settings`)),
        tx.get(db.doc(`users/${uid}/private/settings`)),
        tx.get(db.doc(`suspensions/${data.senderId}`)),
        tx.get(db.doc(`suspensions/${uid}`)),
        tx.get(db.collection('signalsPairs').where('participants', '==', [data.senderId, uid].sort()).where('status', '==', 'active').limit(1)),
        tx.get(pairRef),
      ]);
      // Everything is checked again at the moment of acceptance: blocks, suspensions and age can change after a request.
      if (!isAdultMember(senderSettings.data()) || !isAdultMember(recipientSettings.data())) throw fail(403, 'not_allowed');
      if (senderSuspension.exists || recipientSuspension.exists) throw fail(403, 'account_unavailable');
      if (blockedEither(senderSettings.data(), recipientSettings.data(), data.senderId, uid)) throw fail(403, 'not_allowed');

      // Reuse a conversation the two already have; otherwise open one whose id is the request id, so it can only exist once.
      let conversationId;
      if (!existingPair.empty) {
        conversationId = existingPair.docs[0].id;
      } else {
        conversationId = ref.id;
        if (ownPair.exists) throw fail(409, 'pair_already_exists');
        tx.create(pairRef, {
          invitationId: ref.id,
          requestId: ref.id,
          source: 'connection_request',
          participants: [data.senderId, uid].sort(),
          status: 'active',
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      tx.update(ref, { status: 'accepted', conversationId, respondedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      tx.delete(db.doc(lockPath(data.senderId, uid)));
      event(tx, db, ref.id, uid, 'accept', 'pending', 'accepted');
      // The author's list updates at once; the sender is told with the same "request accepted" notification as invitations.
      touchInbox(tx, db, uid, undefined, { requests: { [ref.id]: FieldValue.delete() } });
      touchInbox(tx, db, data.senderId, undefined, acceptedNotification(conversationId));
      return { status: 'accepted', conversationId, replayed: false };
    });
  }

  async function decline(db, uid, body) {
    if (!safeId(body.requestId)) throw fail(400, 'invalid_request');
    const ref = db.doc(`connection_requests/${body.requestId}`);
    return db.runTransaction(async tx => {
      const data = mine(await tx.get(ref), uid, 'recipient');
      if (data.status === 'declined') return { status: 'declined', replayed: true };
      if (data.status !== 'pending') throw fail(409, 'request_not_pending');
      if (effectiveStatus(data, Date.now()) === 'expired') {
        expire(tx, db, ref, data);
        return { status: 'expired' };
      }
      tx.update(ref, { status: 'declined', respondedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      // No conversation, and no notification to the sender: they see the status in their Sent list.
      tx.set(db.doc(lockPath(data.senderId, uid)), { state: 'cooling', senderId: data.senderId, recipientId: uid, until: Timestamp.fromMillis(Date.now() + DECLINE_COOLDOWN_MS), updatedAt: FieldValue.serverTimestamp() });
      event(tx, db, ref.id, uid, 'decline', 'pending', 'declined');
      touchInbox(tx, db, uid, undefined, { requests: { [ref.id]: FieldValue.delete() } });
      touchInbox(tx, db, data.senderId);
      return { status: 'declined', replayed: false };
    });
  }

  async function withdraw(db, uid, body) {
    if (!safeId(body.requestId)) throw fail(400, 'invalid_request');
    const ref = db.doc(`connection_requests/${body.requestId}`);
    return db.runTransaction(async tx => {
      const data = mine(await tx.get(ref), uid, 'sender');
      if (data.status === 'withdrawn') return { status: 'withdrawn', replayed: true };
      if (data.status !== 'pending') throw fail(409, 'request_not_pending');
      if (effectiveStatus(data, Date.now()) === 'expired') {
        expire(tx, db, ref, data);
        return { status: 'expired' };
      }
      tx.update(ref, { status: 'withdrawn', respondedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      tx.delete(db.doc(lockPath(uid, data.recipientId)));
      event(tx, db, ref.id, uid, 'withdraw', 'pending', 'withdrawn');
      touchInbox(tx, db, data.recipientId, undefined, { requests: { [ref.id]: FieldValue.delete() } });
      touchInbox(tx, db, uid);
      return { status: 'withdrawn', replayed: false };
    });
  }

  const actions = { 'request-create': create, 'request-accept': accept, 'request-decline': decline, 'request-withdraw': withdraw };

  /** Runs one lifecycle action. Unknown names are refused. */
  async function handle(action, body, uid, db) {
    const run = actions[action];
    if (!run) throw fail(400, 'invalid_request');
    const result = await run(db, uid, body);
    return { status: action === 'request-create' && !result.replayed ? 201 : 200, body: result };
  }

  /** Both lists for one member, with the other person's public preview and the state of the original post. */
  async function list(db, uid) {
    const requests = db.collection('connection_requests');
    const [incoming, sent] = await Promise.all([
      requests.where('recipientId', '==', uid).orderBy('createdAt', 'desc').limit(REQUEST_LIST_LIMIT).get(),
      requests.where('senderId', '==', uid).orderBy('createdAt', 'desc').limit(REQUEST_LIST_LIMIT).get(),
    ]);
    const rows = [
      ...incoming.docs.map(snap => ({ snap, direction: 'incoming' })),
      ...sent.docs.map(snap => ({ snap, direction: 'sent' })),
    ];
    const memberIds = [...new Set(rows.map(({ snap, direction }) => (direction === 'incoming' ? snap.data().senderId : snap.data().recipientId)))];
    const postIds = [...new Set(rows.map(({ snap }) => snap.data().lookingForPostId))];
    const [profiles, posts] = await Promise.all([
      Promise.all(memberIds.map(async id => [id, profilePreview((await db.doc(`users/${id}/public/profile`).get()).data())])),
      Promise.all(postIds.map(async id => [id, (await db.doc(`looking_for_posts/${id}`).get()).data() ?? null])),
    ]);
    const profileById = new Map(profiles);
    const postById = new Map(posts);
    const nowMs = Date.now();
    const shape = ({ snap, direction }) => {
      const data = snap.data();
      const other = direction === 'incoming' ? data.senderId : data.recipientId;
      const post = postById.get(data.lookingForPostId);
      return {
        id: snap.id,
        status: effectiveStatus(data, nowMs),
        message: data.message || '',
        intention: data.intention,
        createdAt: iso(data.createdAt),
        respondedAt: iso(data.respondedAt),
        expiresAt: iso(data.expiresAt),
        conversationId: data.conversationId || null,
        memberId: other,
        partner: profileById.get(other) ?? profilePreview(null),
        // A sensitive post's title is never repeated here.
        post: { status: postAvailability(post), title: post && post.isNsfw !== true && typeof post.title === 'string' ? post.title.slice(0, 90) : null, sensitive: post?.isNsfw === true },
      };
    };
    return {
      incoming: rows.filter(r => r.direction === 'incoming').map(shape),
      sent: rows.filter(r => r.direction === 'sent').map(shape),
    };
  }

  return { handle, list };
}

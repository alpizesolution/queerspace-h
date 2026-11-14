import { randomUUID, createHash } from 'node:crypto';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { createRequestHandlers } from './_requests.js';
import { profileView } from './_profiles.js';
import { createMediaHandlers, setNoStoreHeaders } from './_media.js';
import { cardById, shapeStoredCard } from './_cards.js';
import { NSFW_CARD_TEXT, nsfwCardById, shapeStoredNsfwCard } from './_nsfwCards.js';
import { shapeStoredTest, testById, testInviteText } from './_tests.js';
import { inboxWritesForMessage, previewText } from './_inbox.js';
import { clearCurrentVibe, setCurrentVibe, vibeView } from './_vibe.js';
import { sendSupportImage, supportImageView } from './_supportImages.js';
import { backgroundImageView, pruneBackgroundImages, setBackgroundImage } from './_background.js';
import { GAME_TEXT, isGuess, parseChallenge, shapeStoredGame } from './_game.js';
import { GIF_TEXT, sharedGiphy, isGifId, limitGifSearches, limitGifSends, parseGifQuery, shapeStoredGif } from './_giphy.js';
import { decodeMessageCursor, encodeMessageCursor, listChangesAfterPosition, listMessagesPage, parseMessageLimit } from './_messages.js';
import { createPartnerCache, getOnePair, listPairsLegacy, listPairsPage, parsePageLimit, partnerSummaries, shapePair } from './_inbox.js';

const giphy = sharedGiphy;

const MAX_MESSAGE_LENGTH = 240;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CREATE_COOLDOWN_MS = 30 * 1000;

function getAdminApp() {
  if (getApps().length) return getApps()[0];
  // Emulator mode is deliberately opt-in and requires both emulator hosts.
  // Production continues to require the server-only service-account secret.
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-queerspace-test' });
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON');
  const credentials = JSON.parse(raw);
  return initializeApp({ credential: cert(credentials), projectId: credentials.project_id });
}

function send(res, status, body) {
  return res.status(status).json(body);
}

function safeId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

/**
 * How far back a delta poll looks past the client's cursor, so a write that lands just behind it (clock differences,
 * a commit that finished a moment after the read) is never missed. Kept under the 4-second poll interval, so a change
 * is sent at most twice and a quiet conversation costs nothing.
 */
export const DELTA_OVERLAP_MS = 3000;

/** The most changes one catch-up poll returns. When it returns this many, `more` is set and the app asks again. */
export const DELTA_PAGE_LIMIT = 100;

/** Cat-themed reactions shared with the MATCHING chat (src/utils/reactions.ts), plus the earlier set so old reactions still show and can be removed. */
export const ALLOWED_REACTIONS = ['😻', '😹', '😽', '🙀', '😿', '❤️', '💜', '🥹', '😂', '✨'];

/** The cursor handed back with a poll: the moment the server read the messages, as an ISO string. */
export function deltaCursor(startedAtMs) {
  return new Date(startedAtMs).toISOString();
}

/**
 * One reaction per member per message: choosing another emoji replaces it, choosing the same one removes it.
 * Works on the stored map { emoji: [uid, ...] } and also tidies up any older multiple reactions by the same member.
 */
export function toggleReaction(reactions, uid, emoji) {
  const next = {};
  let previous = null;
  for (const [key, users] of Object.entries(reactions && typeof reactions === 'object' ? reactions : {})) {
    const list = Array.isArray(users) ? users : [];
    if (list.includes(uid)) previous = previous ?? key;
    const kept = list.filter(user => user !== uid);
    if (kept.length) next[key] = kept;
  }
  const selected = previous === emoji ? null : emoji;
  if (selected) next[selected] = [...(next[selected] || []), uid];
  return { reactions: next, selected };
}

/**
 * Public-safe view of the other person in a connection: their pseudonym and avatar only.
 * Anything missing or malformed becomes null so the client shows a deliberate fallback.
 */
export function partnerSummary(profile) {
  const name = typeof profile?.displayName === 'string' ? profile.displayName.trim().slice(0, 30) : '';
  const avatar = typeof profile?.avatar === 'string' && profile.avatar.length <= 24 ? profile.avatar : null;
  return { displayName: name || null, avatar };
}

/**
 * Bumps signalsInbox/{uid}, a server-written doc the owner can listen to for live updates.
 * It holds no sender identity: only a revision counter and the ids/expiry of pending
 * invitations. Keyed by invitation id, so repeated writes can never double-count.
 */
export function touchInbox(tx, db, uid, pending, extra) {
  tx.set(db.doc(`signalsInbox/${uid}`), {
    rev: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
    ...(pending ? { pending } : {}),
    ...(extra ?? {}),
  }, { merge: true });
}

/**
 * The note left for the original sender when their invitation is accepted. It is keyed by the pair id, which is the
 * invitation id and exists only once, and it is written in the same transaction that creates the pair. It carries no
 * identity: the app resolves the other member's pseudonym from the pair, like everywhere else in Signals.
 */
export function acceptedNotification(pairId) {
  return { notifications: { [pairId]: { type: 'accepted', read: false, createdAt: FieldValue.serverTimestamp() } } };
}

/** True when `conversation` is an active chat between exactly these two members. */
export function isActiveMatch(conversation, uid, otherId) {
  const participants = conversation?.participants;
  return conversation?.status === 'active'
    && Array.isArray(participants)
    && participants.length === 2
    && participants.includes(uid)
    && participants.includes(otherId)
    && uid !== otherId;
}

/**
 * Unread messages for a member: only what the other person wrote, never their own, and never a deleted message.
 * Reactions are fields on a message, not messages, so they cannot reach this count.
 */
export function countUnread(messages, otherUid) {
  return messages.filter(message => message?.senderId === otherUid && message.deleted !== true && !message.deletedAt).length;
}

/** How far a recount looks past the last message the reader saw; a longer backlog simply shows as 99+. */
export const UNREAD_RECOUNT_LIMIT = 100;

const connectionRequests = createRequestHandlers({ touchInbox, acceptedNotification });
const media = createMediaHandlers();
/** Other members' pseudonyms and avatars, remembered briefly so a refresh does not read the same profiles again. */
const partnerCache = createPartnerCache();

function idempotencyDocId(uid, key) {
  return createHash('sha256').update(uid + ':' + key).digest('hex');
}


export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }

  try {
    const header = req.headers.authorization || '';
    const match = /^Bearer (.+)$/.exec(header);
    if (!match) return send(res, 401, { error: 'unauthenticated' });

    const app = getAdminApp();
    const decoded = await getAuth(app).verifyIdToken(match[1], true);
    const uid = decoded.uid;
    const db = getFirestore(app);
    if (req.method === 'GET') {
      const view = req.query?.view || new URL(req.url || '/api/signals', 'http://localhost').searchParams.get('view');
      // No view means the invitations list, as always. A view this server does not know is an error, never that list, so a
      // newer app talking to an older server (or a typo) cannot be mistaken for a real answer.
      if (view && !['messages', 'pairs', 'requests', 'profile', 'gifs', 'vibe', 'background-image', 'support-image'].includes(view)) return send(res, 400, { error: 'invalid_view' });
      if (view === 'gifs') {
        // GIF search and trending for the picker. The key stays here; a suspended member gets nothing.
        if ((await db.doc(`suspensions/${uid}`).get()).exists) return send(res, 403, { error: 'account_unavailable' });
        const param = name => req.query?.[name] ?? new URL(req.url || '/api/signals', 'http://localhost').searchParams.get(name);
        const query = parseGifQuery({ q: param('q'), limit: param('limit'), offset: param('offset') });
        await limitGifSearches(db, uid);
        res.setHeader('Cache-Control', 'private, no-store');
        return send(res, 200, await giphy.browse(query));
      }
      if (view === 'messages') {
        const pairId = req.query?.pairId || new URL(req.url || '/api/signals', 'http://localhost').searchParams.get('pairId');
        if (!safeId(pairId)) return send(res, 400, { error: 'invalid_request' });
        const pairSnap = await db.doc(`signalsPairs/${pairId}`).get();
        if (!pairSnap.exists) return send(res, 404, { error: 'pair_not_found' });
        const pair = pairSnap.data();
        if (!Array.isArray(pair.participants) || !pair.participants.includes(uid)) return send(res, 403, { error: 'not_allowed' });
        if (pair.status !== 'active') return send(res, 409, { error: 'pair_not_active' });
        const otherUid = pair.participants.find(participant => participant !== uid);
        if (!otherUid) return send(res, 403, { error: 'not_allowed' });
        const [ownSettings, otherSettings, ownSuspension, otherSuspension] = await Promise.all([
          db.doc(`users/${uid}/private/settings`).get(),
          db.doc(`users/${otherUid}/private/settings`).get(),
          db.doc(`suspensions/${uid}`).get(),
          db.doc(`suspensions/${otherUid}`).get(),
        ]);
        const ownBlocked = ownSettings.data()?.blockedPartnerIds;
        const otherBlocked = otherSettings.data()?.blockedPartnerIds;
        if ((Array.isArray(ownBlocked) && ownBlocked.includes(otherUid))
          || (Array.isArray(otherBlocked) && otherBlocked.includes(uid))
          || ownSuspension.exists || otherSuspension.exists) {
          // One answer for a block (either way) and for a suspension, so the app can say "not available" without telling the member
          // which it is or who did it. The record is untouched; nothing is deleted.
          return send(res, 403, { error: 'conversation_unavailable' });
        }
        // After the first load the client sends `after` (the cursor it was given) and only gets messages that are new or
        // changed (a reaction) since then, instead of the whole history every few seconds.
        const afterParam = req.query?.after || new URL(req.url || '/api/signals', 'http://localhost').searchParams.get('after');
        // `after` is either a time (an ordinary poll) or an exact position "seconds.nanos.id" (the continuation of a catch-up that was cut).
        const afterPosition = typeof afterParam === 'string' && decodeMessageCursor(afterParam) ? afterParam : null;
        const afterMs = afterPosition === null && typeof afterParam === 'string' ? Date.parse(afterParam) : Number.NaN;
        const pollStartedAt = Date.now();
        const messagesRef = db.collection('signalsPairs').doc(pairId).collection('messages');
        // A poll asks only for what changed since its cursor. Opening a conversation (or asking for earlier messages with `before`)
        // reads a page of the NEWEST messages, newest page first, so a long conversation can never hide its latest messages.
        const messageParam = name => req.query?.[name] || new URL(req.url || '/api/signals', 'http://localhost').searchParams.get(name);
        let olderCursor = null;
        let messageSnap;
        if (afterPosition !== null) {
          messageSnap = await listChangesAfterPosition(messagesRef, afterPosition, DELTA_PAGE_LIMIT);
        } else if (Number.isFinite(afterMs)) {
          messageSnap = await messagesRef.where('updatedAt', '>', Timestamp.fromMillis(afterMs - DELTA_OVERLAP_MS)).orderBy('updatedAt', 'asc').limit(DELTA_PAGE_LIMIT).get();
        } else {
          const page = await listMessagesPage(messagesRef, { limit: parseMessageLimit(messageParam('limit')), before: messageParam('before') });
          if (page.invalid) return send(res, 400, { error: 'invalid_request' });
          messageSnap = { docs: page.docs };
          olderCursor = page.olderCursor;
        }
        // A catch-up that hit the 100 limit must not move its cursor past what it did not return (a tab that was away while a long run of
        // messages arrived would otherwise lose the newest ones for good). The cursor then stops at the last change returned, and
        // `more` tells the app to ask again straight away.
        const isDelta = afterPosition !== null || Number.isFinite(afterMs);
        const truncated = isDelta && messageSnap.docs.length >= DELTA_PAGE_LIMIT;
        // Where to continue: the exact position (full-precision time and id) of the last change returned.
        const lastDoc = truncated ? messageSnap.docs[messageSnap.docs.length - 1] : null;
        const lastStamp = lastDoc?.data().updatedAt;
        const continuation = lastDoc && lastStamp instanceof Timestamp ? encodeMessageCursor(lastStamp, lastDoc.id) : null;
        const photos = await media.photoViews(db, uid, messageSnap.docs);
        const messages = messageSnap.docs.map(snap => {
          const data = snap.data();
          const reactions = data.reactions && typeof data.reactions === 'object' ? data.reactions : {};
          // A Comfort Card: the question always comes from the approved list, never from what is stored on the message.
          // An NSFW Card carries only its id and category: its question is never sent (the app shows it only if the member's own setting allows).
          // A Test Invitation: the name and description always come from the catalog, never from what is stored on the message.
          const testInvite = data.kind === 'test' ? shapeStoredTest(data.test) : null;
          const card = data.kind === 'card' ? (shapeStoredCard(data.card) ?? shapeStoredNsfwCard(data.card)) : null;
          // Two Truths and a Lie: the answer is part of this only once the recipient's guess has been recorded.
          const game = data.kind === 'game' ? shapeStoredGame(data.game, uid, data.senderId) : null;
          return {
            id: snap.id,
            senderId: data.senderId,
            text: card ? (card.deck === 'nsfw' ? NSFW_CARD_TEXT : card.question) : game ? GAME_TEXT : testInvite ? testInviteText(testById(testInvite.id)) : data.text,
            // A timed photo: its timer and state only, never where the image is kept.
            ...(data.kind === 'photo' ? { kind: 'photo', photo: photos.get(snap.id) ?? { durationSec: data.durationSec, status: 'expired', mine: data.senderId === uid } } : {}),
            // A GIF: only the approved GIPHY addresses saved with it. A record that fails the check is shown as plain text.
            ...(data.kind === 'gif' && shapeStoredGif(data.gif) ? { kind: 'gif', gif: shapeStoredGif(data.gif) } : {}),
            ...(card ? { kind: 'card', card: { id: card.id, category: card.category, ...(card.deck ? { deck: card.deck } : {}) } } : {}),
            ...(testInvite ? { kind: 'test', test: testInvite } : {}),
            ...(game ? { kind: 'game', game } : {}),
            createdAt: data.createdAt?.toDate?.().toISOString?.() || null,
            replyTo: data.replyTo && typeof data.replyTo === 'object' ? {
              messageId: data.replyTo.messageId,
              senderId: data.replyTo.sender === 'self' ? data.senderId : otherUid,
              text: data.replyTo.text,
            } : null,
            reactions: Object.entries(reactions).flatMap(([emoji, users]) =>
              Array.isArray(users) && users.length
                ? [{ emoji, count: users.length, userReacted: users.includes(uid) }]
                : []
            ),
          };
        });
        const cursor = continuation ?? deltaCursor(pollStartedAt);
        return send(res, 200, { messages, cursor, ...(continuation ? { more: true } : {}), ...(isDelta ? {} : { olderCursor }) });
      }
      if (view === 'requests') return send(res, 200, await connectionRequests.list(db, uid));
      if (view === 'support-image') {
        // A picture in a support conversation, for that thread's member or an admin only (never a public link).
        const param = name => req.query?.[name] || new URL(req.url || '/api/signals', 'http://localhost').searchParams.get(name);
        const found = await supportImageView(db, uid, decoded, { threadId: param('threadId'), messageId: param('messageId') });
        setNoStoreHeaders(res);
        return send(res, 200, found);
      }
      if (view === 'background-image') {
        // A member's saved profile background picture, for a viewer who may see that profile (same rules as opening the profile).
        const memberId = req.query?.memberId || new URL(req.url || '/api/signals', 'http://localhost').searchParams.get('memberId');
        const found = await backgroundImageView(db, uid, memberId);
        setNoStoreHeaders(res);
        return send(res, 200, found);
      }
      if (view === 'vibe') {
        // Current Vibe (a 24-hour mood status): the same viewing rules as a profile, then the member's own setting, then expiry.
        const memberId = req.query?.memberId || new URL(req.url || '/api/signals', 'http://localhost').searchParams.get('memberId');
        res.setHeader('Cache-Control', 'private, no-store');
        return send(res, 200, await vibeView(db, uid, memberId));
      }
      if (view === 'profile') {
        const memberId = req.query?.memberId || new URL(req.url || '/api/signals', 'http://localhost').searchParams.get('memberId');
        return send(res, 200, await profileView(db, uid, memberId));
      }
      if (view === 'pairs') {
        const param = name => req.query?.[name] || new URL(req.url || '/api/signals', 'http://localhost').searchParams.get(name);
        // With nothing asked for, the full list, exactly as before. A client that asks for one connection, or for a page
        // (newest first, `before` being where the last page ended), reads only that.
        const pairId = param('pairId');
        const pageLimit = parsePageLimit(param('limit'));
        let found;
        let nextCursor;
        if (pairId) {
          const one = await getOnePair(db, uid, pairId);
          found = one ? [one] : [];
        } else if (pageLimit !== null) {
          const page = await listPairsPage(db, uid, { limit: pageLimit, before: param('before') });
          found = page.pairs;
          nextCursor = page.nextCursor;
        } else {
          found = await listPairsLegacy(db, uid);
        }
        const shaped = found.map(item => shapePair(item, uid));
        const profiles = await partnerSummaries(db, shaped.map(pair => pair.partnerId), partnerSummary, partnerCache);
        return send(res, 200, {
          pairs: shaped.map(({ partnerId, ...pair }) => ({ ...pair, partner: profiles.get(partnerId) || partnerSummary(null) })),
          ...(nextCursor !== undefined ? { nextCursor } : {}),
        });
      }
      // `status=pending` asks for only the invitations still waiting (what the inbox shows), instead of the whole history.
      const onlyPending = (req.query?.status || new URL(req.url || '/api/signals', 'http://localhost').searchParams.get('status')) === 'pending';
      const invitationsOf = field => {
        const base = db.collection('signalsInvitations').where(field, '==', uid);
        return (onlyPending ? base.where('status', '==', 'pending') : base).limit(50).get();
      };
      const [received, sent] = await Promise.all([invitationsOf('recipientId'), invitationsOf('senderId')]);
      const byId = new Map();
      for (const snap of [...received.docs, ...sent.docs]) {
        const data = snap.data();
        const expired = data.status === 'pending' && data.expiresAt instanceof Timestamp && data.expiresAt.toMillis() <= Date.now();
        byId.set(snap.id, {
          id: snap.id,
          senderId: data.senderId,
          recipientId: data.recipientId,
          message: data.message || '',
          status: expired ? 'expired' : data.status,
          createdAt: data.createdAt?.toDate?.().toISOString?.() || null,
          expiresAt: data.expiresAt?.toDate?.().toISOString?.() || null,
          direction: data.senderId === uid ? 'sent' : 'received',
        });
      }
      const sorted = [...byId.values()].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      // Each invitation carries the OTHER person's pseudonym and avatar only (the sender for received
      // invitations, the recipient for sent ones), resolved here so clients never read profiles directly.
      const otherId = invite => (invite.direction === 'sent' ? invite.recipientId : invite.senderId);
      const otherIds = [...new Set(sorted.map(otherId).filter(Boolean))];
      const profiles = await partnerSummaries(db, otherIds, partnerSummary, partnerCache);
      const invitations = sorted.map(invite => ({ ...invite, partner: profiles.get(otherId(invite)) || partnerSummary(null) }));
      return send(res, 200, { invitations });
    }
    const { action, recipientId, invitationId, message, idempotencyKey, convId } = req.body || {};

    // Timed photos: sent and opened through one set of checks, on the server clock. See api/_media.js.
    if (action === 'send-photo' || action === 'open-photo') {
      const outcome = action === 'send-photo' ? await media.sendPhoto(db, uid, req.body || {}) : await media.openPhoto(db, uid, req.body || {});
      // The image is delivered once, in this response, and must never be stored by the browser or a proxy.
      setNoStoreHeaders(res);
      return send(res, outcome.status, outcome.body);
    }

    // Connection requests from the Looking For board: sent, accepted, declined and withdrawn through one set of checks.
    if (typeof action === 'string' && action.startsWith('request-')) {
      const outcome = await connectionRequests.handle(action, req.body || {}, uid, db);
      return send(res, outcome.status, outcome.body);
    }

    if (['create'].includes(action)) {
      if (!safeId(recipientId) || recipientId === uid) return send(res, 400, { error: 'invalid_recipient' });
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
        return send(res, 400, { error: 'invalid_idempotency_key' });
      }
      if (message !== undefined && (typeof message !== 'string' || message.trim().length > MAX_MESSAGE_LENGTH)) {
        return send(res, 400, { error: 'invalid_message' });
      }

      const idemRef = db.doc(`signalsIdempotency/${idempotencyDocId(uid, idempotencyKey)}`);
      const rateRef = db.doc(`signalsRateLimits/${uid}`);
      const invitationRef = db.collection('signalsInvitations').doc(randomUUID());
      const now = Timestamp.now();
      const expiresAt = Timestamp.fromMillis(now.toMillis() + INVITE_TTL_MS);

      const result = await db.runTransaction(async tx => {
        const [prior, rateSnap, senderSettings, recipientSettings, senderSuspension, recipientSuspension, convSnap] = await Promise.all([
          tx.get(idemRef),
          tx.get(rateRef),
          tx.get(db.doc(`users/${uid}/private/settings`)),
          tx.get(db.doc(`users/${recipientId}/private/settings`)),
          tx.get(db.doc(`suspensions/${uid}`)),
          tx.get(db.doc(`suspensions/${recipientId}`)),
          // The conversation the match created; only the matching API can create one (clients are denied by rules).
          tx.get(db.doc(`conversations/${safeId(convId) ? convId : 'invalid-conversation'}`)),
        ]);
        if (prior.exists) {
          const priorData = prior.data();
          if (priorData?.action !== 'create' || priorData?.recipientId !== recipientId) {
            throw Object.assign(new Error('idempotency_conflict'), { statusCode: 409 });
          }
          return { invitationId: priorData.invitationId, replayed: true };
        }
        // A Signal is a way to stay in touch after a match: only between the two members of a conversation
        // that is currently active. It is never a way to contact someone you have not been matched with.
        if (!isActiveMatch(convSnap.exists ? convSnap.data() : null, uid, recipientId)) {
          throw Object.assign(new Error('not_matched'), { statusCode: 403 });
        }
        if (senderSuspension.exists || recipientSuspension.exists) {
          throw Object.assign(new Error('account_unavailable'), { statusCode: 403 });
        }
        const aBlocked = senderSettings.data()?.blockedPartnerIds;
        const bBlocked = recipientSettings.data()?.blockedPartnerIds;
        if ((Array.isArray(aBlocked) && aBlocked.includes(recipientId))
          || (Array.isArray(bBlocked) && bBlocked.includes(uid))) {
          throw Object.assign(new Error('not_allowed'), { statusCode: 403 });
        }
        const lastCreatedAt = rateSnap.data()?.lastCreatedAt;
        if (lastCreatedAt instanceof Timestamp && now.toMillis() - lastCreatedAt.toMillis() < CREATE_COOLDOWN_MS) {
          throw Object.assign(new Error('rate_limited'), { statusCode: 429 });
        }
        tx.create(invitationRef, {
          senderId: uid,
          recipientId,
          message: typeof message === 'string' ? message.trim() : '',
          status: 'pending',
          createdAt: FieldValue.serverTimestamp(),
          expiresAt,
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.set(rateRef, { lastCreatedAt: now }, { merge: true });
        touchInbox(tx, db, recipientId, { [invitationRef.id]: expiresAt });
        touchInbox(tx, db, uid);
        tx.create(idemRef, {
          action: 'create',
          recipientId,
          invitationId: invitationRef.id,
          createdAt: FieldValue.serverTimestamp(),
        });
        return { invitationId: invitationRef.id, replayed: false };
      });
      return send(res, result.replayed ? 200 : 201, result);
    }

    // Profile background: store a new picture, and tidy up after the profile is saved. Only ever the signed-in member's own.
    // Support Chat pictures: no timer, kept in the conversation, for the member and the team. See api/_supportImages.js.
    if (action === 'support-image-send') {
      const sent = await sendSupportImage(db, uid, decoded, req.body || {});
      return send(res, sent.replayed ? 200 : 201, sent);
    }
    if (action === 'bg-image-set') return send(res, 200, await setBackgroundImage(db, uid, req.body || {}));
    if (action === 'bg-image-prune') return send(res, 200, await pruneBackgroundImages(db, uid));

    // Current Vibe: publish (or replace) and remove. Only ever the signed-in member's own; the id comes from the verified token.
    if (action === 'vibe-set') return send(res, 200, await setCurrentVibe(db, uid, req.body || {}));
    if (action === 'vibe-clear') return send(res, 200, await clearCurrentVibe(db, uid));

    if (action === 'react-message') {
      const pairId = req.body?.pairId;
      const messageId = req.body?.messageId;
      const emoji = req.body?.emoji;
      if (!safeId(pairId) || !safeId(messageId) || !ALLOWED_REACTIONS.includes(emoji)) {
        return send(res, 400, { error: 'invalid_reaction' });
      }
      const pairRef = db.doc(`signalsPairs/${pairId}`);
      const pairSnap = await pairRef.get();
      if (!pairSnap.exists) return send(res, 404, { error: 'pair_not_found' });
      const pair = pairSnap.data();
      if (!Array.isArray(pair.participants) || !pair.participants.includes(uid)) return send(res, 403, { error: 'not_allowed' });
      if (pair.status !== 'active') return send(res, 409, { error: 'pair_not_active' });
      const otherUid = pair.participants.find(participant => participant !== uid);
      if (!otherUid) return send(res, 403, { error: 'not_allowed' });
      const [ownSettings, otherSettings, ownSuspension, otherSuspension] = await Promise.all([
        db.doc(`users/${uid}/private/settings`).get(),
        db.doc(`users/${otherUid}/private/settings`).get(),
        db.doc(`suspensions/${uid}`).get(),
        db.doc(`suspensions/${otherUid}`).get(),
      ]);
      const ownBlocked = ownSettings.data()?.blockedPartnerIds;
      const otherBlocked = otherSettings.data()?.blockedPartnerIds;
      if (ownSuspension.exists || otherSuspension.exists
        || (Array.isArray(ownBlocked) && ownBlocked.includes(otherUid))
        || (Array.isArray(otherBlocked) && otherBlocked.includes(uid))) {
        return send(res, 403, { error: 'not_allowed' });
      }
      const messageRef = pairRef.collection('messages').doc(messageId);
      const result = await db.runTransaction(async tx => {
        const messageSnap = await tx.get(messageRef);
        if (!messageSnap.exists) throw Object.assign(new Error('message_not_found'), { statusCode: 404 });
        const { reactions, selected } = toggleReaction(messageSnap.data().reactions, uid, emoji);
        tx.update(messageRef, { reactions, updatedAt: FieldValue.serverTimestamp() });
        return { emoji, count: (reactions[emoji] || []).length, userReacted: selected === emoji, mine: selected };
      });
      return send(res, 200, result);
    }

    if (action === 'send-message') {
      const pairId = req.body?.pairId;
      const kind = req.body?.kind;
      if (kind !== undefined && kind !== 'text' && kind !== 'gif' && kind !== 'card' && kind !== 'game' && kind !== 'test') return send(res, 400, { error: 'invalid_message' });
      const isGif = kind === 'gif';
      const isCard = kind === 'card';
      const isGame = kind === 'game';
      // A Test Invitation is sent by its test's id alone; the words come from the server's catalog and nothing else is accepted.
      const isTest = kind === 'test';
      const testItem = isTest ? testById(req.body?.testId) : null;
      if (isTest && (!testItem || ['text', 'test', 'name', 'url', 'description', 'cardId', 'gifId', 'gif', 'game', 'card'].some(field => req.body[field] !== undefined))) {
        return send(res, 400, { error: 'invalid_test' });
      }
      if (!isTest && req.body?.testId !== undefined) return send(res, 400, { error: 'invalid_message' });
      // A Two Truths and a Lie challenge carries the three statements, the answer and an optional note, and nothing else.
      const challenge = isGame ? parseChallenge(req.body?.game) : null;
      if (isGame && (!challenge.ok || ['text', 'cardId', 'gifId', 'card', 'gif'].some(field => req.body[field] !== undefined))) {
        return send(res, 400, { error: challenge.ok ? 'invalid_game' : challenge.error });
      }
      if (!isGame && req.body?.game !== undefined) return send(res, 400, { error: 'invalid_message' });
      // A Comfort Card is sent by its id alone. The question comes from the approved list on the server; any other field is refused.
      // Either deck: a Comfort Card, or an NSFW Card (a separate list, for adults who have chosen to see mature content).
      const nsfwCard = isCard ? nsfwCardById(req.body?.cardId) : null;
      const card = isCard ? (nsfwCard ?? cardById(req.body?.cardId)) : null;
      const cardDeck = nsfwCard ? 'nsfw' : null;
      const cardView = card ? { id: card.id, category: card.category, ...(cardDeck ? { deck: cardDeck } : {}) } : null;
      if (isCard && (!card || ['text', 'card', 'question', 'gifId', 'gif', 'category'].some(field => req.body[field] !== undefined))) {
        return send(res, 400, { error: 'invalid_card' });
      }
      if (!isCard && req.body?.cardId !== undefined) return send(res, 400, { error: 'invalid_message' });
      // A GIF is sent by its GIPHY id alone. A link, or anything else about the GIF, is never taken from the app.
      const gifId = req.body?.gifId;
      if (isGif && (!isGifId(gifId) || ['gif', 'url', 'gifUrl', 'text'].some(field => req.body[field] !== undefined))) {
        return send(res, 400, { error: 'invalid_gif' });
      }
      if (!isGif && req.body?.gifId !== undefined) return send(res, 400, { error: 'invalid_message' });
      const text = isTest ? testInviteText(testItem) : isGif ? GIF_TEXT : isCard ? (cardDeck === 'nsfw' ? NSFW_CARD_TEXT : card.question) : isGame ? GAME_TEXT : typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      const replyToInput = req.body?.replyTo;
      // The app picks the message id up front, so a retry after a dropped connection can't create a second copy.
      const requestedId = req.body?.messageId;
      if (!safeId(pairId) || !text || text.length > 1000) return send(res, 400, { error: 'invalid_message' });
      if (requestedId !== undefined && !safeId(requestedId)) return send(res, 400, { error: 'invalid_message' });
      let replyTo = null;
      if (replyToInput !== undefined && replyToInput !== null) {
        if (!safeId(replyToInput.messageId) || typeof replyToInput.text !== 'string'
          || replyToInput.text.length > 1000 || !['self', 'partner'].includes(replyToInput.sender)) {
          return send(res, 400, { error: 'invalid_reply' });
        }
        replyTo = { messageId: replyToInput.messageId, text: replyToInput.text, sender: replyToInput.sender };
      }
      const pairRef = db.doc(`signalsPairs/${pairId}`);
      const pairSnap = await pairRef.get();
      if (!pairSnap.exists) return send(res, 404, { error: 'pair_not_found' });
      const pair = pairSnap.data();
      if (!Array.isArray(pair.participants) || !pair.participants.includes(uid)) return send(res, 403, { error: 'not_allowed' });
      if (pair.status !== 'active') return send(res, 409, { error: 'pair_not_active' });
      const otherUid = pair.participants.find(participant => participant !== uid);
      if (!otherUid) return send(res, 403, { error: 'not_allowed' });
      const [ownSettings, otherSettings, ownSuspension, otherSuspension] = await Promise.all([
        db.doc(`users/${uid}/private/settings`).get(),
        db.doc(`users/${otherUid}/private/settings`).get(),
        db.doc(`suspensions/${uid}`).get(),
        db.doc(`suspensions/${otherUid}`).get(),
      ]);
      const ownBlocked = ownSettings.data()?.blockedPartnerIds;
      const otherBlocked = otherSettings.data()?.blockedPartnerIds;
      if (ownSuspension.exists || otherSuspension.exists) return send(res, 403, { error: 'account_unavailable' });
      if ((Array.isArray(ownBlocked) && ownBlocked.includes(otherUid))
        || (Array.isArray(otherBlocked) && otherBlocked.includes(uid))) {
        return send(res, 403, { error: 'not_allowed' });
      }
      const messageRef = pairRef.collection('messages').doc(requestedId ?? randomUUID());
      const stamp = FieldValue.serverTimestamp();
      const replyBody = stored => (stored?.replyTo ? { ...stored.replyTo, senderId: stored.replyTo.sender === 'self' ? uid : otherUid } : null);
      let gif = null;
      if (isGif) {
        // Only after the pair, block and suspension checks above, so nobody can spend GIPHY quota without being allowed to send.
        const earlier = requestedId ? await messageRef.get() : null;
        if (earlier?.exists) {
          const prior = earlier.data();
          const priorGif = shapeStoredGif(prior.gif);
          if (prior.senderId !== uid || prior.kind !== 'gif' || !priorGif) return send(res, 409, { error: 'invalid_message' });
          return send(res, 200, { id: messageRef.id, senderId: uid, text: GIF_TEXT, kind: 'gif', gif: priorGif, replyTo: replyBody(prior), reactions: [], createdAt: prior.createdAt?.toDate?.().toISOString?.() || new Date().toISOString() });
        }
        await limitGifSends(db, uid);
        gif = await giphy.byId(gifId);
      }
      try {
        // The message and the recipient's unread counter commit together. A retried send fails on create(), so the
        // whole batch is rejected and the counter is never incremented twice for one message.
        const batch = db.batch();
        batch.create(messageRef, { senderId: uid, text, ...(gif ? { kind: 'gif', gif } : {}), ...(isCard ? { kind: 'card', card: { id: card.id } } : {}), ...(isTest ? { kind: 'test', test: { id: testItem.id } } : {}), ...(isGame ? { kind: 'game', game: { statements: challenge.statements, intro: challenge.intro, status: 'open' } } : {}), ...(replyTo ? { replyTo } : {}), createdAt: stamp, updatedAt: stamp });
        // The answer goes in its own document, which no client can read, in the same commit as the card.
        if (isGame) batch.create(pairRef.collection('gameSecrets').doc(messageRef.id), { senderId: uid, lie: challenge.lie, createdAt: stamp });
        // The recipient's unread counter, and the latest-message line for both people's inbox rows, in the same write.
        const writes = inboxWritesForMessage({ pairId, preview: previewText(text, isGif ? 'gif' : isTest ? 'test' : isCard ? (cardDeck === 'nsfw' ? 'nsfw-card' : 'card') : isGame ? 'game' : 'text'), ...(isGame ? { senderPreview: '✨ You sent a Two Truths and a Lie challenge.' } : {}), stamp, increment: FieldValue.increment });
        batch.set(db.doc(`signalsInbox/${otherUid}`), writes.recipient, { merge: true });
        batch.set(db.doc(`signalsInbox/${uid}`), writes.sender, { merge: true });
        await batch.commit();
      } catch (error) {
        // ALREADY_EXISTS: this exact send already went through (a retry). Answer with what was stored, never a copy.
        if (error?.code !== 6) throw error;
        const stored = (await messageRef.get()).data();
        if (stored?.senderId !== uid || (isGif && stored.kind !== 'gif') || (isCard && (stored.kind !== 'card' || stored.card?.id !== card.id)) || (isGame && stored.kind !== 'game') || (isTest && (stored.kind !== 'test' || stored.test?.id !== testItem.id))) return send(res, 409, { error: 'invalid_message' });
        return send(res, 200, {
          id: messageRef.id,
          senderId: uid,
          text: stored.text,
          ...(stored.kind === 'gif' && shapeStoredGif(stored.gif) ? { kind: 'gif', gif: shapeStoredGif(stored.gif) } : {}),
          ...(isCard ? { kind: 'card', card: cardView } : {}),
          ...(isTest ? { kind: 'test', test: { id: testItem.id } } : {}),
          ...(isGame ? { kind: 'game', game: shapeStoredGame(stored.game, uid, uid) } : {}),
          replyTo: replyBody(stored),
          reactions: [],
          createdAt: stored.createdAt?.toDate?.().toISOString?.() || new Date().toISOString(),
        });
      }
      return send(res, 201, {
        id: messageRef.id,
        senderId: uid,
        text,
        ...(gif ? { kind: 'gif', gif } : {}),
        ...(isCard ? { kind: 'card', card: cardView } : {}),
        ...(isTest ? { kind: 'test', test: { id: testItem.id } } : {}),
        ...(isGame ? { kind: 'game', game: shapeStoredGame({ statements: challenge.statements, intro: challenge.intro, status: 'open' }, uid, uid) } : {}),
        replyTo: replyTo ? { ...replyTo, senderId: replyTo.sender === 'self' ? uid : otherUid } : null,
        reactions: [],
        createdAt: new Date().toISOString(),
      });
    }

    if (action === 'guess-game') {
      // Two Truths and a Lie: the recipient's one guess. The answer is read here, on the server, and only written onto the card
      // (where both members can then see it) in the same transaction that records the guess. See api/_game.js.
      const pairId = req.body?.pairId;
      const messageId = req.body?.messageId;
      const guess = req.body?.guess;
      if (!safeId(pairId) || !safeId(messageId) || !isGuess(guess)
        || Object.keys(req.body).some(key => !['action', 'pairId', 'messageId', 'guess'].includes(key))) {
        return send(res, 400, { error: 'invalid_guess' });
      }
      const pairRef = db.doc(`signalsPairs/${pairId}`);
      const pairSnap = await pairRef.get();
      if (!pairSnap.exists) return send(res, 404, { error: 'pair_not_found' });
      const pair = pairSnap.data();
      if (!Array.isArray(pair.participants) || !pair.participants.includes(uid)) return send(res, 403, { error: 'not_allowed' });
      if (pair.status !== 'active') return send(res, 409, { error: 'pair_not_active' });
      const otherUid = pair.participants.find(participant => participant !== uid);
      if (!otherUid) return send(res, 403, { error: 'not_allowed' });
      const [ownSettings, otherSettings, ownSuspension, otherSuspension] = await Promise.all([
        db.doc(`users/${uid}/private/settings`).get(),
        db.doc(`users/${otherUid}/private/settings`).get(),
        db.doc(`suspensions/${uid}`).get(),
        db.doc(`suspensions/${otherUid}`).get(),
      ]);
      const ownBlocked = ownSettings.data()?.blockedPartnerIds;
      const otherBlocked = otherSettings.data()?.blockedPartnerIds;
      if (ownSuspension.exists || otherSuspension.exists
        || (Array.isArray(ownBlocked) && ownBlocked.includes(otherUid))
        || (Array.isArray(otherBlocked) && otherBlocked.includes(uid))) {
        return send(res, 403, { error: 'not_allowed' });
      }
      const messageRef = pairRef.collection('messages').doc(messageId);
      const secretRef = pairRef.collection('gameSecrets').doc(messageId);
      const result = await db.runTransaction(async tx => {
        const [messageSnap, secretSnap] = await Promise.all([tx.get(messageRef), tx.get(secretRef)]);
        const stored = messageSnap.exists ? messageSnap.data() : null;
        if (!stored || stored.kind !== 'game' || !secretSnap.exists) throw Object.assign(new Error('game_not_found'), { statusCode: 404 });
        const secret = secretSnap.data();
        // Only the person the challenge was sent to may guess: not the one who made it, and (by the pair check above) no one else.
        if (stored.senderId === uid || secret.senderId !== stored.senderId || stored.senderId !== otherUid) throw Object.assign(new Error('not_allowed'), { statusCode: 403 });
        if (!isGuess(secret.lie)) throw Object.assign(new Error('game_not_found'), { statusCode: 404 });
        const current = stored.game;
        if (current?.status === 'complete') {
          // One guess per game. The same guess again (a retry after a dropped connection) is answered with the recorded result;
          // anything else is refused and changes nothing.
          if (current.guess === guess) return { replayed: true, stored };
          throw Object.assign(new Error('game_already_answered'), { statusCode: 409 });
        }
        const game = { ...current, status: 'complete', guess, lie: secret.lie, guessedBy: uid, guessedAt: Timestamp.now() };
        tx.update(messageRef, { game, updatedAt: FieldValue.serverTimestamp() });
        // Tell the person who made the challenge, through their own inbox document (the one their app already listens to): one more
        // unread and a new latest line. Written only here, in the transaction that records the guess, so a retried or simultaneous
        // guess can never add a second one. The words are fixed: they never say what was guessed or what the answer is.
        tx.set(db.doc(`signalsInbox/${stored.senderId}`), { unread: { [pairId]: FieldValue.increment(1) }, last: { [pairId]: { text: previewText('', 'guess'), mine: false, at: FieldValue.serverTimestamp() } } }, { merge: true });
        return { replayed: false, stored: { ...stored, game } };
      });
      const stored = result.stored;
      return send(res, 200, {
        id: messageId,
        senderId: stored.senderId,
        text: GAME_TEXT,
        kind: 'game',
        game: shapeStoredGame(stored.game, uid, stored.senderId),
        createdAt: stored.createdAt?.toDate?.().toISOString?.() || null,
        replyTo: null,
        reactions: [],
        replayed: result.replayed,
      });
    }

    if (action === 'mark-read') {
      const pairId = req.body?.pairId;
      const throughId = req.body?.throughMessageId;
      if (!safeId(pairId) || !safeId(throughId)) return send(res, 400, { error: 'invalid_request' });
      const pairRef = db.doc(`signalsPairs/${pairId}`);
      const inboxRef = db.doc(`signalsInbox/${uid}`);
      const result = await db.runTransaction(async tx => {
        const [pairSnap, seenSnap] = await Promise.all([tx.get(pairRef), tx.get(pairRef.collection('messages').doc(throughId))]);
        if (!pairSnap.exists) throw Object.assign(new Error('pair_not_found'), { statusCode: 404 });
        const participants = pairSnap.data().participants;
        if (!Array.isArray(participants) || !participants.includes(uid)) throw Object.assign(new Error('not_allowed'), { statusCode: 403 });
        const otherUid = participants.find(participant => participant !== uid);
        const seenAt = seenSnap.exists ? seenSnap.data().createdAt : null;
        if (!(seenAt instanceof Timestamp)) throw Object.assign(new Error('message_not_found'), { statusCode: 404 });
        // Every send writes the inbox doc, so a message that lands while this runs makes the transaction retry
        // and it stays unread instead of being wiped by a stale count.
        const [later] = await Promise.all([
          tx.get(pairRef.collection('messages').where('createdAt', '>', seenAt).orderBy('createdAt', 'asc').limit(UNREAD_RECOUNT_LIMIT)),
          tx.get(inboxRef),
        ]);
        const unread = countUnread(later.docs.map(snap => snap.data()), otherUid);
        tx.set(inboxRef, { unread: { [pairId]: unread > 0 ? unread : FieldValue.delete() } }, { merge: true });
        return { unread };
      });
      return send(res, 200, result);
    }

    if (action === 'ack-notification') {
      const pairId = req.body?.pairId;
      if (!safeId(pairId)) return send(res, 400, { error: 'invalid_request' });
      const inboxRef = db.doc(`signalsInbox/${uid}`);
      await db.runTransaction(async tx => {
        const note = (await tx.get(inboxRef)).data()?.notifications?.[pairId];
        // Only the member's own notification can be marked, and only once.
        if (note && note.read !== true) tx.set(inboxRef, { notifications: { [pairId]: { read: true } } }, { merge: true });
      });
      return send(res, 200, { ok: true });
    }

    if (action === 'end') {
      const pairId = req.body?.pairId;
      if (!safeId(pairId)) return send(res, 400, { error: 'invalid_request' });
      const pairRef = db.doc(`signalsPairs/${pairId}`);
      const result = await db.runTransaction(async tx => {
        const pairSnap = await tx.get(pairRef);
        if (!pairSnap.exists) throw Object.assign(new Error('pair_not_found'), { statusCode: 404 });
        const pair = pairSnap.data();
        if (!Array.isArray(pair.participants) || !pair.participants.includes(uid)) {
          throw Object.assign(new Error('not_allowed'), { statusCode: 403 });
        }
        if (pair.status === 'ended') return { status: 'ended', alreadyEnded: true };
        if (pair.status !== 'active') {
          throw Object.assign(new Error('pair_not_active'), { statusCode: 409 });
        }
        tx.update(pairRef, {
          status: 'ended',
          endedBy: uid,
          endedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        for (const participant of pair.participants) touchInbox(tx, db, participant);
        return { status: 'ended', alreadyEnded: false };
      });
      return send(res, 200, result);
    }

    if (!['accept', 'decline', 'revoke'].includes(action) || !safeId(invitationId)) {
      return send(res, 400, { error: 'invalid_request' });
    }

    const inviteRef = db.doc(`signalsInvitations/${invitationId}`);
    const result = await db.runTransaction(async tx => {
      const inviteSnap = await tx.get(inviteRef);
      if (!inviteSnap.exists) throw Object.assign(new Error('invitation_not_found'), { statusCode: 404 });
      const invite = inviteSnap.data();
      const isRecipient = invite.recipientId === uid;
      const isSender = invite.senderId === uid;
      if (action === 'revoke' ? !isSender : !isRecipient) {
        throw Object.assign(new Error('not_allowed'), { statusCode: 403 });
      }
      if (invite.status !== 'pending') {
        throw Object.assign(new Error('invitation_not_pending'), { statusCode: 409 });
      }
      // Resolving removes it from the recipient's pending list and wakes both people's live listeners.
      const resolved = (senderExtra) => {
        touchInbox(tx, db, invite.recipientId, { [invitationId]: FieldValue.delete() });
        touchInbox(tx, db, invite.senderId, undefined, senderExtra);
      };
      if (!(invite.expiresAt instanceof Timestamp) || invite.expiresAt.toMillis() <= Date.now()) {
        tx.update(inviteRef, { status: 'expired', updatedAt: FieldValue.serverTimestamp() });
        resolved();
        return { status: 'expired' };
      }
      if (action === 'accept') {
        const senderId = invite.senderId;
        const recipientId = invite.recipientId;
        const pairRef = db.doc(`signalsPairs/${invitationId}`);
        const [senderSettings, recipientSettings, senderSuspension, recipientSuspension, pairSnap, existingPair] = await Promise.all([
          tx.get(db.doc(`users/${senderId}/private/settings`)),
          tx.get(db.doc(`users/${recipientId}/private/settings`)),
          tx.get(db.doc(`suspensions/${senderId}`)),
          tx.get(db.doc(`suspensions/${recipientId}`)),
          tx.get(pairRef),
          // A conversation these two already have (from an earlier Signal or a connection request) is reused, never duplicated.
          tx.get(db.collection('signalsPairs').where('participants', '==', [senderId, recipientId].sort()).where('status', '==', 'active').limit(1)),
        ]);
        const aBlocked = senderSettings.data()?.blockedPartnerIds;
        const bBlocked = recipientSettings.data()?.blockedPartnerIds;
        if ((Array.isArray(aBlocked) && aBlocked.includes(recipientId))
          || (Array.isArray(bBlocked) && bBlocked.includes(senderId))
          || senderSuspension.exists || recipientSuspension.exists) {
          tx.update(inviteRef, { status: 'declined', updatedAt: FieldValue.serverTimestamp() });
          resolved();
          return { status: 'declined' };
        }
        if (!existingPair.empty && !pairSnap.exists) {
          const existingId = existingPair.docs[0].id;
          tx.update(inviteRef, { status: 'accepted', updatedAt: FieldValue.serverTimestamp() });
          resolved(acceptedNotification(existingId));
          return { status: 'accepted', pairId: existingId };
        }
        if (pairSnap.exists) throw Object.assign(new Error('pair_already_exists'), { statusCode: 409 });
        tx.create(pairRef, {
          invitationId,
          participants: [senderId, recipientId].sort(),
          status: 'active',
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.update(inviteRef, { status: 'accepted', updatedAt: FieldValue.serverTimestamp() });
        // Only a successful acceptance notifies the sender, atomically with the pair, so a retry can never add a second one.
        resolved(acceptedNotification(invitationId));
        return { status: 'accepted', pairId: invitationId };
      }
      const nextStatus = action === 'decline' ? 'declined' : 'revoked';
      tx.update(inviteRef, { status: nextStatus, updatedAt: FieldValue.serverTimestamp() });
      resolved();
      return { status: nextStatus };
    });
    return send(res, 200, result);
  } catch (error) {
    const status = Number(error?.statusCode) || (typeof error?.code === 'string' && error.code.startsWith('auth/') ? 401 : 500);
    if (status === 500) console.error('[Signals API]', error);
    return send(res, status, { error: status === 500 ? 'internal_error' : (error.message || 'request_failed') });
  }
}

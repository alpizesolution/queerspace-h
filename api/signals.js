import { randomUUID, createHash } from 'node:crypto';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';

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
export function touchInbox(tx, db, uid, pending) {
  tx.set(db.doc(`signalsInbox/${uid}`), {
    rev: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
    ...(pending ? { pending } : {}),
  }, { merge: true });
}

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
          return send(res, 403, { error: 'not_allowed' });
        }
        const messageSnap = await db.collection('signalsPairs').doc(pairId).collection('messages').orderBy('createdAt', 'asc').limit(100).get();
        const messages = messageSnap.docs.map(snap => {
          const data = snap.data();
          const reactions = data.reactions && typeof data.reactions === 'object' ? data.reactions : {};
          return {
            id: snap.id,
            senderId: data.senderId,
            text: data.text,
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
        return send(res, 200, { messages });
      }
      if (view === 'pairs') {
        const pairSnapshots = await Promise.all([
          db.collection('signalsPairs').where('participants', 'array-contains', uid).limit(100).get(),
        ]);
        const pairs = pairSnapshots[0].docs
          .map(snap => ({ id: snap.id, ...snap.data() }))
          .filter(pair => Array.isArray(pair.participants)
            && pair.participants.includes(uid)
            && ['active', 'ended'].includes(pair.status))
          .sort((a, b) => {
            const aTime = a.createdAt?.toMillis?.() || 0;
            const bTime = b.createdAt?.toMillis?.() || 0;
            return bTime - aTime;
          })
          .map(pair => ({
            partnerId: pair.participants.find(participant => participant !== uid),
            id: pair.id,
            invitationId: pair.invitationId || pair.id,
            participants: pair.participants,
            status: pair.status,
            createdAt: pair.createdAt?.toDate?.().toISOString?.() || null,
            endedAt: pair.endedAt?.toDate?.().toISOString?.() || null,
            endedBy: pair.endedBy || null,
          }));
        const partnerIds = [...new Set(pairs.map(pair => pair.partnerId).filter(Boolean))];
        const profiles = new Map(await Promise.all(partnerIds.map(async id => {
          const snap = await db.doc(`users/${id}/public/profile`).get();
          return [id, partnerSummary(snap.exists ? snap.data() : null)];
        })));
        return send(res, 200, {
          pairs: pairs.map(({ partnerId, ...pair }) => ({
            ...pair,
            partner: profiles.get(partnerId) || partnerSummary(null),
          })),
        });
      }
      const [received, sent] = await Promise.all([
        db.collection('signalsInvitations').where('recipientId', '==', uid).limit(50).get(),
        db.collection('signalsInvitations').where('senderId', '==', uid).limit(50).get(),
      ]);
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
      const invitations = [...byId.values()].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return send(res, 200, { invitations });
    }
    const { action, recipientId, invitationId, message, idempotencyKey } = req.body || {};

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
        const [prior, rateSnap, senderSettings, recipientSettings, senderSuspension, recipientSuspension] = await Promise.all([
          tx.get(idemRef),
          tx.get(rateRef),
          tx.get(db.doc(`users/${uid}/private/settings`)),
          tx.get(db.doc(`users/${recipientId}/private/settings`)),
          tx.get(db.doc(`suspensions/${uid}`)),
          tx.get(db.doc(`suspensions/${recipientId}`)),
        ]);
        if (prior.exists) {
          const priorData = prior.data();
          if (priorData?.action !== 'create' || priorData?.recipientId !== recipientId) {
            throw Object.assign(new Error('idempotency_conflict'), { statusCode: 409 });
          }
          return { invitationId: priorData.invitationId, replayed: true };
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

    if (action === 'react-message') {
      const pairId = req.body?.pairId;
      const messageId = req.body?.messageId;
      const emoji = req.body?.emoji;
      const allowedReactions = ['💜', '🥹', '😂', '✨'];
      if (!safeId(pairId) || !safeId(messageId) || !allowedReactions.includes(emoji)) {
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
        const data = messageSnap.data();
        const reactions = data.reactions && typeof data.reactions === 'object' ? { ...data.reactions } : {};
        const users = Array.isArray(reactions[emoji]) ? [...reactions[emoji]] : [];
        const index = users.indexOf(uid);
        if (index >= 0) users.splice(index, 1);
        else users.push(uid);
        if (users.length) reactions[emoji] = users;
        else delete reactions[emoji];
        tx.update(messageRef, { reactions, updatedAt: FieldValue.serverTimestamp() });
        return { emoji, count: users.length, userReacted: index < 0 };
      });
      return send(res, 200, result);
    }

    if (action === 'send-message') {
      const pairId = req.body?.pairId;
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      const replyToInput = req.body?.replyTo;
      if (!safeId(pairId) || !text || text.length > 1000) return send(res, 400, { error: 'invalid_message' });
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
      const messageRef = pairRef.collection('messages').doc(randomUUID());
      await messageRef.create({ senderId: uid, text, ...(replyTo ? { replyTo } : {}), createdAt: FieldValue.serverTimestamp() });
      return send(res, 201, {
        id: messageRef.id,
        senderId: uid,
        text,
        replyTo: replyTo ? { ...replyTo, senderId: replyTo.sender === 'self' ? uid : otherUid } : null,
        reactions: [],
        createdAt: new Date().toISOString(),
      });
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
      const resolved = () => {
        touchInbox(tx, db, invite.recipientId, { [invitationId]: FieldValue.delete() });
        touchInbox(tx, db, invite.senderId);
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
        const [senderSettings, recipientSettings, senderSuspension, recipientSuspension, pairSnap] = await Promise.all([
          tx.get(db.doc(`users/${senderId}/private/settings`)),
          tx.get(db.doc(`users/${recipientId}/private/settings`)),
          tx.get(db.doc(`suspensions/${senderId}`)),
          tx.get(db.doc(`suspensions/${recipientId}`)),
          tx.get(pairRef),
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
        if (pairSnap.exists) throw Object.assign(new Error('pair_already_exists'), { statusCode: 409 });
        tx.create(pairRef, {
          invitationId,
          participants: [senderId, recipientId].sort(),
          status: 'active',
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.update(inviteRef, { status: 'accepted', updatedAt: FieldValue.serverTimestamp() });
        resolved();
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

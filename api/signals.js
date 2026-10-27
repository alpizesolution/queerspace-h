import { randomUUID, createHash } from 'node:crypto';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';

const MAX_MESSAGE_LENGTH = 240;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getAdminApp() {
  if (getApps().length) return getApps()[0];
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

function idempotencyDocId(uid, key) {
  return createHash('sha256').update(uid + ':' + key).digest('hex');
}

async function isBlocked(db, a, b) {
  const [aSettings, bSettings] = await Promise.all([
    db.doc(`users/${a}/private/settings`).get(),
    db.doc(`users/${b}/private/settings`).get(),
  ]);
  const aBlocked = aSettings.data()?.blockedPartnerIds;
  const bBlocked = bSettings.data()?.blockedPartnerIds;
  return (Array.isArray(aBlocked) && aBlocked.includes(b))
    || (Array.isArray(bBlocked) && bBlocked.includes(a));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
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
    const { action, recipientId, invitationId, message, idempotencyKey } = req.body || {};

    if (['create'].includes(action)) {
      if (!safeId(recipientId) || recipientId === uid) return send(res, 400, { error: 'invalid_recipient' });
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
        return send(res, 400, { error: 'invalid_idempotency_key' });
      }
      if (message !== undefined && (typeof message !== 'string' || message.trim().length > MAX_MESSAGE_LENGTH)) {
        return send(res, 400, { error: 'invalid_message' });
      }

      const [senderSuspension, recipientSuspension] = await Promise.all([
        db.doc(`suspensions/${uid}`).get(),
        db.doc(`suspensions/${recipientId}`).get(),
      ]);
      if (senderSuspension.exists || recipientSuspension.exists) return send(res, 403, { error: 'account_unavailable' });
      if (await isBlocked(db, uid, recipientId)) return send(res, 403, { error: 'not_allowed' });

      const idemRef = db.doc(`signalsIdempotency/${idempotencyDocId(uid, idempotencyKey)}`);
      const invitationRef = db.collection('signalsInvitations').doc(randomUUID());
      const now = Timestamp.now();
      const expiresAt = Timestamp.fromMillis(now.toMillis() + INVITE_TTL_MS);

      const result = await db.runTransaction(async tx => {
        const prior = await tx.get(idemRef);
        if (prior.exists) {
          const priorData = prior.data();
          if (priorData?.action !== 'create' || priorData?.recipientId !== recipientId) {
            throw Object.assign(new Error('idempotency_conflict'), { statusCode: 409 });
          }
          return { invitationId: priorData.invitationId, replayed: true };
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
        tx.create(idemRef, {
          action: 'create',
          recipientId,
          invitationId: invitationRef.id,
          createdAt: FieldValue.serverTimestamp(),
        });
        return { invitationId: invitationRef.id, replayed: false };
      });
      return send(res, 201, result);
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
      if (!(invite.expiresAt instanceof Timestamp) || invite.expiresAt.toMillis() <= Date.now()) {
        tx.update(inviteRef, { status: 'expired', updatedAt: FieldValue.serverTimestamp() });
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
        return { status: 'accepted', pairId: invitationId };
      }
      const nextStatus = action === 'decline' ? 'declined' : 'revoked';
      tx.update(inviteRef, { status: nextStatus, updatedAt: FieldValue.serverTimestamp() });
      return { status: nextStatus };
    });
    return send(res, 200, result);
  } catch (error) {
    const status = Number(error?.statusCode) || (error?.code === 'auth/id-token-revoked' || error?.code === 'auth/argument-error' ? 401 : 500);
    if (status === 500) console.error('[Signals API]', error);
    return send(res, status, { error: status === 500 ? 'internal_error' : (error.message || 'request_failed') });
  }
}

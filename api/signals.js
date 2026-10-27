import { randomUUID, createHash } from 'node:crypto';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';

const MAX_MESSAGE_LENGTH = 240;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CREATE_COOLDOWN_MS = 30 * 1000;

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
    const status = Number(error?.statusCode) || (typeof error?.code === 'string' && error.code.startsWith('auth/') ? 401 : 500);
    if (status === 500) console.error('[Signals API]', error);
    return send(res, status, { error: status === 500 ? 'internal_error' : (error.message || 'request_failed') });
  }
}

// Trusted age endpoints: a chat partner's age (only when they opted in) and the birthday correction workflow.
// Birthdays and ages are never stored in a readable document; clients get an age only through this API.
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  MINIMUM_AGE, HttpError, ageFromDate, ageFromTimestamp, authenticate, parseBirthDate, rateLimit, requireAdmin, safeId, send, sendError,
} from './_lib.js';
import { migrateAgePrivacy } from '../scripts/migrate-age-privacy.mjs';

const REASON_MAX = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

const isoDate = (date) => date.toISOString().slice(0, 10);

/** Audit entries record who decided what and when, never a birthday. */
function audit(tx, db, entry) {
  tx.set(db.collection('ageAudit').doc(), { ...entry, at: FieldValue.serverTimestamp() });
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }
  try {
    const { uid, decoded, db } = await authenticate(req);
    const query = req.query || Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams);

    if (req.method === 'GET') {
      // The chat partner's age: only inside your own conversation, only if they chose to show it.
      if (query.view === 'partner-age') {
        await rateLimit(db, uid, 'partner-age', 120, 60_000);
        if (!safeId(query.convId)) throw new HttpError(400, 'invalid_request');
        const conv = await db.doc(`conversations/${query.convId}`).get();
        const participants = conv.data()?.participants;
        if (!conv.exists || !Array.isArray(participants) || !participants.includes(uid)) throw new HttpError(403, 'not_allowed');
        const partnerId = participants.find((p) => p !== uid);
        if (!partnerId) throw new HttpError(403, 'not_allowed');
        const [profile, settings] = await Promise.all([
          db.doc(`users/${partnerId}/public/profile`).get(),
          db.doc(`users/${partnerId}/private/settings`).get(),
        ]);
        if (profile.data()?.showAgeOnProfile !== true) return send(res, 200, { age: null });
        const age = ageFromTimestamp(settings.data()?.birthDate);
        return send(res, 200, { age: age !== null && age >= MINIMUM_AGE ? age : null });
      }

      // The caller's own latest correction request (status only).
      if (query.view === 'my-correction') {
        const snap = await db.doc(`birthdayCorrections/${uid}`).get();
        return send(res, 200, { status: snap.exists ? snap.data().status : null });
      }

      // Admin: pending requests to review.
      if (query.view === 'corrections') {
        await requireAdmin(db, decoded);
        const snap = await db.collection('birthdayCorrections').where('status', '==', 'pending').limit(50).get();
        const requests = snap.docs.map((d) => {
          const data = d.data();
          const requested = parseBirthDate(data.requestedBirthDate);
          return {
            id: d.id,
            reason: data.reason || '',
            requestedBirthDate: data.requestedBirthDate || null,
            requestedAge: requested ? ageFromDate(requested) : null,
            createdAt: data.createdAt?.toDate?.().toISOString?.() || null,
          };
        });
        return send(res, 200, { requests });
      }
      return send(res, 400, { error: 'invalid_request' });
    }

    const { action } = req.body || {};

    if (action === 'request-correction') {
      await rateLimit(db, uid, 'age-correction', 5, DAY_MS);
      const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, REASON_MAX) : '';
      const requested = parseBirthDate(req.body.requestedBirthDate);
      if (!requested) throw new HttpError(400, 'invalid_birthday');
      const requestedAge = ageFromDate(requested);
      const settings = await db.doc(`users/${uid}/private/settings`).get();
      if (!(settings.data()?.birthDate instanceof Timestamp)) throw new HttpError(409, 'no_birthday');

      const requestRef = db.doc(`birthdayCorrections/${uid}`);
      const status = await db.runTransaction(async (tx) => {
        const existing = await tx.get(requestRef);
        if (existing.exists && existing.data().status === 'pending') throw new HttpError(409, 'already_pending');
        if (requestedAge === null || requestedAge < MINIMUM_AGE) {
          // A correction that shows the member is under 18 is rejected and the account is restricted pending review.
          tx.set(requestRef, { uid, status: 'restricted', reason, createdAt: FieldValue.serverTimestamp() });
          tx.set(db.doc(`suspensions/${uid}`), {
            source: 'age-correction',
            reason: 'Birthday correction request indicated under 18; pending review',
            createdAt: FieldValue.serverTimestamp(),
          });
          audit(tx, db, { action: 'birthday-correction', decision: 'restricted-underage', requestId: uid, uid, adminUid: null });
          return 'restricted';
        }
        tx.set(requestRef, {
          uid, status: 'pending', reason, requestedBirthDate: isoDate(requested), createdAt: FieldValue.serverTimestamp(),
        });
        audit(tx, db, { action: 'birthday-correction', decision: 'requested', requestId: uid, uid, adminUid: null });
        return 'pending';
      });
      return send(res, status === 'pending' ? 201 : 200, { status });
    }

    // Admin-only, idempotent cleanup of legacy age fields (age on profiles; age and range on queue entries).
    // It runs with the server's own credentials, so no secret ever leaves Vercel. Counts only are returned.
    if (action === 'migrate-age-privacy') {
      await requireAdmin(db, decoded);
      const result = await migrateAgePrivacy(db, { dryRun: req.body.dryRun !== false });
      return send(res, 200, result);
    }

    if (action === 'decide-correction') {
      await requireAdmin(db, decoded);
      const { requestId, decision } = req.body;
      if (!safeId(requestId) || !['approve', 'reject'].includes(decision)) throw new HttpError(400, 'invalid_request');
      const requestRef = db.doc(`birthdayCorrections/${requestId}`);
      const status = await db.runTransaction(async (tx) => {
        const snap = await tx.get(requestRef);
        if (!snap.exists || snap.data().status !== 'pending') throw new HttpError(409, 'not_pending');
        const request = snap.data();
        let outcome = decision === 'approve' ? 'approved' : 'rejected';
        if (outcome === 'approved') {
          const requested = parseBirthDate(request.requestedBirthDate);
          const age = requested ? ageFromDate(requested) : null;
          if (age === null || age < MINIMUM_AGE) {
            // Defence in depth: an approval can never make a member under 18.
            outcome = 'restricted';
            tx.set(db.doc(`suspensions/${requestId}`), {
              source: 'age-correction',
              reason: 'Birthday correction indicated under 18; pending review',
              createdAt: FieldValue.serverTimestamp(),
            });
          } else {
            tx.set(db.doc(`users/${requestId}/private/settings`), {
              birthDate: Timestamp.fromDate(requested), updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
          }
        }
        // The requested date is removed once decided, so nothing keeps it.
        tx.update(requestRef, {
          status: outcome, decidedBy: decoded.uid, decidedAt: FieldValue.serverTimestamp(), requestedBirthDate: FieldValue.delete(),
        });
        audit(tx, db, { action: 'birthday-correction', decision: outcome, requestId, uid: requestId, adminUid: decoded.uid });
        return outcome;
      });
      return send(res, 200, { status });
    }

    return send(res, 400, { error: 'invalid_request' });
  } catch (error) {
    return sendError(res, error);
  }
}

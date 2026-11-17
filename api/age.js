// Trusted age endpoints: a chat partner's age (only when they opted in) and the birthday correction workflow.
// Birthdays and ages are never stored in a readable document; clients get an age only through this API.
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  MINIMUM_AGE, HttpError, ageFromDate, ageFromTimestamp, authenticate, parseBirthDate, rateLimit, requireAdmin, safeId, send, sendError,
} from './_lib.js';
import { migrateAgePrivacy } from '../scripts/migrate-age-privacy.mjs';
import {
  MAX_APPROVED_CORRECTIONS, NOTICES, OPEN_CORRECTION_STATUSES, REJECTIONS_BEFORE_REVIEW, audit, isoDate, memberReviewState, notifyMember,
  purgeExpiredAgeRecords, redactDates, suspiciousFlags,
} from './_ageReview.js';

const REASON_MAX = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

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

      // A member's age on their profile page: only for someone connected to them through Signals, only if they chose to
      // show it, never when either has blocked the other. Same promise as the chat partner's age above.
      if (query.view === 'profile-age') {
        await rateLimit(db, uid, 'profile-age', 120, 60_000);
        if (!safeId(query.memberId) || query.memberId === uid) throw new HttpError(400, 'invalid_request');
        const memberId = query.memberId;
        const [pair, profile, own, theirs] = await Promise.all([
          db.collection('signalsPairs').where('participants', '==', [uid, memberId].sort()).where('status', '==', 'active').limit(1).get(),
          db.doc(`users/${memberId}/public/profile`).get(),
          db.doc(`users/${uid}/private/settings`).get(),
          db.doc(`users/${memberId}/private/settings`).get(),
        ]);
        const blocked = (settings, other) => Array.isArray(settings.data()?.blockedPartnerIds) && settings.data().blockedPartnerIds.includes(other);
        if (pair.empty || profile.data()?.showAgeOnProfile !== true || profile.data()?.profileComplete !== true
          || blocked(own, memberId) || blocked(theirs, uid)) return send(res, 200, { age: null });
        const age = ageFromTimestamp(theirs.data()?.birthDate);
        return send(res, 200, { age: age !== null && age >= MINIMUM_AGE ? age : null });
      }

      // The caller's own latest correction request (status only).
      if (query.view === 'my-correction') {
        const snap = await db.doc(`birthdayCorrections/${uid}`).get();
        return send(res, 200, { status: snap.exists ? snap.data().status : null });
      }

      // Admin: open requests to review, each with what the admin may know about the member.
      if (query.view === 'corrections') {
        await requireAdmin(db, decoded);
        const snap = await db.collection('birthdayCorrections').where('status', 'in', OPEN_CORRECTION_STATUSES).limit(50).get();
        const requests = await Promise.all(snap.docs.map(async (d) => {
          const data = d.data();
          const requested = parseBirthDate(data.requestedBirthDate);
          return {
            id: d.id,
            status: data.status,
            reason: data.reason || '',
            requestedBirthDate: data.requestedBirthDate || null,
            requestedAge: requested ? ageFromDate(requested) : null,
            createdAt: data.createdAt?.toDate?.().toISOString?.() || null,
            review: await memberReviewState(db, d.id),
          };
        }));
        return send(res, 200, { requests });
      }

      // Admin: the review state of the members named in age-review reports (at most 25 at a time).
      if (query.view === 'review-state') {
        await requireAdmin(db, decoded);
        const ids = String(query.ids || '').split(',').filter(safeId).slice(0, 25);
        const members = {};
        await Promise.all(ids.map(async (id) => { members[id] = await memberReviewState(db, id); }));
        return send(res, 200, { members });
      }
      return send(res, 400, { error: 'invalid_request' });
    }

    const { action } = req.body || {};

    // The age gate calls this when someone enters a birthday that makes them under 18. The date is kept only in a server-only
    // record for the admin's review; it never becomes the approved birthday and is not logged.
    if (action === 'submit-underage-attempt') {
      await rateLimit(db, uid, 'age-attempt', 5, DAY_MS);
      const attempted = parseBirthDate(req.body.birthDate);
      if (!attempted) throw new HttpError(400, 'invalid_birthday');
      const attemptedAge = ageFromDate(attempted);
      if (attemptedAge === null || attemptedAge >= MINIMUM_AGE) throw new HttpError(400, 'not_underage');
      const settings = await db.doc(`users/${uid}/private/settings`).get();
      if (settings.data()?.birthDate instanceof Timestamp) throw new HttpError(409, 'birthday_on_file');
      const attemptRef = db.doc(`ageAttempts/${uid}`);
      await db.runTransaction(async (tx) => {
        const existing = await tx.get(attemptRef);
        tx.set(attemptRef, {
          uid,
          attemptedBirthDate: isoDate(attempted),
          attemptedAge,
          attemptCount: (existing.data()?.attemptCount || 0) + 1,
          ...(safeId(req.body.reportId) ? { reportId: req.body.reportId } : {}),
          createdAt: existing.data()?.createdAt || FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        audit(tx, db, { action: 'age-attempt', decision: 'recorded-underage', requestId: uid, uid, adminUid: null });
      });
      await notifyMember(db, uid, NOTICES.submitted);
      return send(res, 201, { status: 'recorded' });
    }

    if (action === 'request-correction') {
      await rateLimit(db, uid, 'age-correction', 5, DAY_MS);
      const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, REASON_MAX) : '';
      const requested = parseBirthDate(req.body.requestedBirthDate);
      if (!requested) throw new HttpError(400, 'invalid_birthday');
      const requestedAge = ageFromDate(requested);
      const settings = await db.doc(`users/${uid}/private/settings`).get();
      const stored = settings.data()?.birthDate;
      const current = stored instanceof Timestamp ? stored.toDate() : null;
      // A member whose birthday was never recorded sends it for review (it is never approved automatically); a member who has
      // one must say what went wrong.
      if (current && reason.length < 3) throw new HttpError(400, 'reason_required');

      const requestRef = db.doc(`birthdayCorrections/${uid}`);
      const recordRef = db.doc(`ageRecords/${uid}`);
      const attemptRef = db.doc(`ageAttempts/${uid}`);
      const status = await db.runTransaction(async (tx) => {
        const [existing, recordSnap, attemptSnap] = await Promise.all([tx.get(requestRef), tx.get(recordRef), tx.get(attemptRef)]);
        if (existing.exists && OPEN_CORRECTION_STATUSES.includes(existing.data().status)) throw new HttpError(409, 'already_pending');
        const record = recordSnap.data() || {};
        if (current && (record.correctionCount || 0) >= MAX_APPROVED_CORRECTIONS) throw new HttpError(403, 'correction_limit');
        const kind = current ? 'correction' : 'initial';
        if (requestedAge === null || requestedAge < MINIMUM_AGE) {
          // Under 18: never accepted. The date is kept only for the admin's review, and an account with a birthday is restricted.
          tx.set(attemptRef, {
            uid, attemptedBirthDate: isoDate(requested), attemptedAge: requestedAge, attemptCount: (attemptSnap.data()?.attemptCount || 0) + 1,
            createdAt: attemptSnap.data()?.createdAt || FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
          });
          tx.set(requestRef, { uid, status: 'restricted', kind, reason, createdAt: FieldValue.serverTimestamp(), decidedAt: FieldValue.serverTimestamp() });
          if (current) {
            tx.set(db.doc(`suspensions/${uid}`), {
              source: 'age-correction',
              reason: 'Birthday correction request indicated under 18; pending review',
              createdAt: FieldValue.serverTimestamp(),
            });
          }
          audit(tx, db, { action: 'birthday-correction', decision: 'restricted-underage', requestId: uid, uid, adminUid: null });
          return 'restricted';
        }
        const flags = suspiciousFlags({ record, current, requested });
        tx.set(requestRef, {
          uid, status: 'pending', kind, reason, requestedBirthDate: isoDate(requested), flags, createdAt: FieldValue.serverTimestamp(),
        });
        audit(tx, db, { action: 'birthday-correction', decision: 'requested', requestId: uid, uid, adminUid: null });
        return 'pending';
      });
      if (status === 'pending') await notifyMember(db, uid, NOTICES.submitted);
      return send(res, status === 'pending' ? 201 : 200, { status });
    }

    // Admin-only, idempotent cleanup of legacy age fields (age on profiles; age and range on queue entries).
    // It runs with the server's own credentials, so no secret ever leaves Vercel. Counts only are returned.
    if (action === 'migrate-age-privacy') {
      await requireAdmin(db, decoded);
      const result = await migrateAgePrivacy(db, { dryRun: req.body.dryRun !== false });
      return send(res, 200, result);
    }

    // Admin-only retention: removes old under-18 attempts and decided requests. A dry run (the default) only counts.
    if (action === 'purge-age-records') {
      await requireAdmin(db, decoded);
      return send(res, 200, await purgeExpiredAgeRecords(db, { dryRun: req.body.dryRun !== false }));
    }

    if (action === 'decide-correction') {
      await requireAdmin(db, decoded);
      const { requestId, decision } = req.body;
      if (!safeId(requestId) || !['approve', 'reject', 'request-info'].includes(decision)) throw new HttpError(400, 'invalid_request');
      const note = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
      if (decision !== 'approve' && note.length < 3) throw new HttpError(400, 'reason_required');
      const requestRef = db.doc(`birthdayCorrections/${requestId}`);
      const settingsRef = db.doc(`users/${requestId}/private/settings`);
      const recordRef = db.doc(`ageRecords/${requestId}`);
      const outcome = await db.runTransaction(async (tx) => {
        const [snap, settings, recordSnap] = await Promise.all([tx.get(requestRef), tx.get(settingsRef), tx.get(recordRef)]);
        if (!snap.exists || !OPEN_CORRECTION_STATUSES.includes(snap.data().status)) throw new HttpError(409, 'not_pending');
        if (decision === 'request-info' && snap.data().status !== 'pending') throw new HttpError(409, 'not_pending');
        const request = snap.data();
        const record = recordSnap.data() || {};
        const stored = settings.data()?.birthDate;
        const current = stored instanceof Timestamp ? stored.toDate() : null;

        if (decision === 'request-info') {
          tx.update(requestRef, { status: 'info-requested', decisionReason: redactDates(note), infoRequestedBy: decoded.uid, infoRequestedAt: FieldValue.serverTimestamp() });
          audit(tx, db, { action: 'birthday-correction', decision: 'info-requested', requestId, uid: requestId, adminUid: decoded.uid });
          return 'info-requested';
        }

        let result = decision === 'approve' ? 'approved' : 'rejected';
        if (result === 'approved') {
          const requested = parseBirthDate(request.requestedBirthDate);
          const age = requested ? ageFromDate(requested) : null;
          if (age === null || age < MINIMUM_AGE) {
            // Defence in depth: an approval can never make a member under 18.
            result = 'restricted';
            tx.set(db.doc(`suspensions/${requestId}`), {
              source: 'age-correction',
              reason: 'Birthday correction indicated under 18; pending review',
              createdAt: FieldValue.serverTimestamp(),
            });
          } else if (current && (record.correctionCount || 0) >= MAX_APPROVED_CORRECTIONS) {
            throw new HttpError(409, 'correction_limit');
          } else {
            const now = Timestamp.now();
            tx.set(settingsRef, {
              birthDate: Timestamp.fromDate(requested), updatedAt: FieldValue.serverTimestamp(),
              ...(settings.exists ? {} : { blockedPartnerIds: [], createdAt: FieldValue.serverTimestamp() }),
            }, { merge: true });
            // The approved birthday it replaces is kept; the first one ever recorded stays as the original.
            tx.set(recordRef, current ? {
              originalBirthDate: record.originalBirthDate || isoDate(current),
              previousBirthDates: [...(Array.isArray(record.previousBirthDates) ? record.previousBirthDates : []), { birthDate: isoDate(current), replacedAt: now, decidedBy: decoded.uid }],
              correctionCount: (record.correctionCount || 0) + 1,
              lastCorrectionAt: now,
              updatedAt: FieldValue.serverTimestamp(),
            } : {
              originalBirthDate: isoDate(requested),
              previousBirthDates: Array.isArray(record.previousBirthDates) ? record.previousBirthDates : [],
              correctionCount: record.correctionCount || 0,
              updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
            // What the member typed while under 18 is no longer needed once an adult birthday is approved.
            tx.delete(db.doc(`ageAttempts/${requestId}`));
          }
        } else {
          const rejected = (record.rejectedCount || 0) + 1;
          tx.set(recordRef, {
            rejectedCount: rejected,
            ...(rejected >= REJECTIONS_BEFORE_REVIEW ? { manualReview: true } : {}),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
        // The requested date is removed once decided, so nothing keeps it.
        tx.update(requestRef, {
          status: result, decidedBy: decoded.uid, decidedAt: FieldValue.serverTimestamp(), requestedBirthDate: FieldValue.delete(),
          ...(note ? { decisionReason: redactDates(note) } : {}),
        });
        audit(tx, db, { action: 'birthday-correction', decision: result, requestId, uid: requestId, adminUid: decoded.uid });
        return result;
      });
      if (outcome === 'approved') await notifyMember(db, requestId, NOTICES.approved);
      else if (outcome === 'rejected') await notifyMember(db, requestId, NOTICES.rejected(redactDates(note)));
      else if (outcome === 'info-requested') await notifyMember(db, requestId, NOTICES.info(redactDates(note)));
      return send(res, 200, { status: outcome });
    }

    return send(res, 400, { error: 'invalid_request' });
  } catch (error) {
    return sendError(res, error);
  }
}

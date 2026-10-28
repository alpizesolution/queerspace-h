// Trusted matchmaking: private age ranges and match claiming. Clients never see anyone's age or age range;
// the server compares birthdays and ranges and only tells a client who it was paired with.
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { MINIMUM_AGE, HttpError, ageFromTimestamp, authenticate, rateLimit, safeId, send, sendError } from './_lib.js';
import { STALE_AFTER_MS, agesCompatible, isFreshQueueEntry, orderCandidates } from './_matching.js';

const MAX_AGE = 99;
const SCAN_LIMIT = 40;
const MAX_EXCLUDED = 200;

const validAge = (n) => Number.isInteger(n) && n >= MINIMUM_AGE && n <= MAX_AGE;

/** Everything trusted matching needs about one member, read with the Admin SDK. */
async function loadMember(db, uid, now) {
  const [settings, profile, suspension, prefs] = await Promise.all([
    db.doc(`users/${uid}/private/settings`).get(),
    db.doc(`users/${uid}/public/profile`).get(),
    db.doc(`suspensions/${uid}`).get(),
    db.doc(`matchPrefs/${uid}`).get(),
  ]);
  const age = ageFromTimestamp(settings.data()?.birthDate, now);
  const range = prefs.exists && validAge(prefs.data().ageMin) && validAge(prefs.data().ageMax)
    ? { ageMin: prefs.data().ageMin, ageMax: prefs.data().ageMax }
    : null;
  const blocked = settings.data()?.blockedPartnerIds;
  return {
    age,
    range,
    // Mirrors isEligibleMember in firestore.rules: an adult birthday, a completed profile, not suspended.
    eligible: age !== null && age >= MINIMUM_AGE && profile.data()?.profileComplete === true && !suspension.exists,
    blocked: Array.isArray(blocked) ? blocked : [],
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }
  try {
    const { uid, db } = await authenticate(req);
    const { action } = req.body || {};

    // Stores (or clears) the caller's private age range. It is never copied to the queue or any readable document.
    if (action === 'prefs') {
      await rateLimit(db, uid, 'match-prefs', 30, 60_000);
      const { ageMin, ageMax } = req.body;
      const ref = db.doc(`matchPrefs/${uid}`);
      if (ageMin === null && ageMax === null) {
        await ref.delete();
        return send(res, 200, { ok: true });
      }
      if (!validAge(ageMin) || !validAge(ageMax) || ageMin > ageMax) throw new HttpError(400, 'invalid_age_range');
      await ref.set({ ageMin, ageMax, updatedAt: FieldValue.serverTimestamp() });
      return send(res, 200, { ok: true });
    }

    if (action === 'claim') {
      await rateLimit(db, uid, 'match-claim', 40, 60_000);
      const excludeIds = Array.isArray(req.body.excludeIds) ? req.body.excludeIds.filter(safeId).slice(0, MAX_EXCLUDED) : [];
      const now = Date.now();

      const myRef = db.doc(`match_queue/${uid}`);
      const mySnap = await myRef.get();
      if (!mySnap.exists || mySnap.data().status !== 'waiting') return send(res, 200, { matched: false });
      const me = await loadMember(db, uid, new Date(now));
      if (!me.eligible) throw new HttpError(403, 'not_eligible');

      const cutoff = Timestamp.fromMillis(now - STALE_AFTER_MS);
      let snap;
      try {
        snap = await db.collection('match_queue').where('status', '==', 'waiting').where('heartbeatAt', '>', cutoff).limit(SCAN_LIMIT).get();
      } catch {
        snap = await db.collection('match_queue').where('status', '==', 'waiting').limit(SCAN_LIMIT).get();
      }
      const ordered = orderCandidates(
        snap.docs.map((d) => ({ id: d.id, data: d.data() })),
        uid,
        [...excludeIds, ...me.blocked],
        mySnap.data(),
        now
      );

      for (const partnerId of ordered) {
        const partner = await loadMember(db, partnerId, new Date(now));
        // Never pair across a block, a suspension, an ineligible account or a private age range.
        if (!partner.eligible || partner.blocked.includes(uid)) continue;
        if (!agesCompatible({ age: me.age, range: me.range }, { age: partner.age, range: partner.range })) continue;

        const theirRef = db.doc(`match_queue/${partnerId}`);
        const convRef = db.collection('conversations').doc();
        try {
          // Atomic: both entries must still be waiting, so one member can never be claimed twice.
          await db.runTransaction(async (tx) => {
            const [mine, theirs] = await Promise.all([tx.get(myRef), tx.get(theirRef)]);
            if (!mine.exists || mine.data().status !== 'waiting') throw new HttpError(409, 'self_not_waiting');
            if (!theirs.exists || theirs.data().status !== 'waiting' || !isFreshQueueEntry(theirs.data(), now)) {
              throw new HttpError(409, 'partner_unavailable');
            }
            tx.set(convRef, {
              participants: [uid, partnerId].sort(),
              status: 'active',
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            });
            tx.update(theirRef, { status: 'matched', partnerId: uid, convId: convRef.id, updatedAt: FieldValue.serverTimestamp() });
            tx.update(myRef, { status: 'matched', partnerId, convId: convRef.id, updatedAt: FieldValue.serverTimestamp() });
          });
          return send(res, 200, { matched: true, partnerId, convId: convRef.id });
        } catch (error) {
          if (error?.message === 'self_not_waiting') return send(res, 200, { matched: false });
          // The partner was claimed or left first: try the next candidate.
        }
      }
      return send(res, 200, { matched: false });
    }

    return send(res, 400, { error: 'invalid_request' });
  } catch (error) {
    return sendError(res, error);
  }
}

// Trusted matchmaking: private age ranges and match claiming. Clients never see anyone's age or age range;
// the server compares birthdays and ranges and only tells a client who it was paired with.
//
// The age rules are enforced here and nowhere else can create a conversation (firestore.rules: create is false):
//   - ages always come from the stored birthday, never from anything a client sends;
//   - both people's ranges must fit the other's age (inclusive); a range needs a known age;
//   - everything is checked again inside the transaction that creates the match, so a range, birthday, block or
//     suspension that changed a moment ago can never be missed.
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { MINIMUM_AGE, HttpError, ageFromTimestamp, authenticate, rateLimit, safeId, send, sendError } from './_lib.js';
import { STALE_AFTER_MS, agesCompatible, isFreshQueueEntry, orderCandidates, sameRange, storedRange, validAgeRange } from './_matching.js';

const SCAN_LIMIT = 40;
const MAX_EXCLUDED = 200;

const memberRefs = (db, uid) => [
  db.doc(`users/${uid}/private/settings`),
  db.doc(`users/${uid}/public/profile`),
  db.doc(`suspensions/${uid}`),
  db.doc(`matchPrefs/${uid}`),
];

/** Everything trusted matching needs about one member, from the four documents memberRefs() lists. */
export function memberFromSnaps([settings, profile, suspension, prefs], now) {
  const age = ageFromTimestamp(settings.data()?.birthDate, now);
  const stored = prefs.exists ? storedRange(prefs.data()) : null;
  const blocked = settings.data()?.blockedPartnerIds;
  return {
    age,
    range: stored && stored.valid ? stored.range : null,
    // Mirrors isEligibleMember in firestore.rules: an adult birthday, a completed profile, not suspended.
    // A stored range that is damaged is never read as "no filter": that member is simply not matchable.
    eligible:
      age !== null && age >= MINIMUM_AGE && profile.data()?.profileComplete === true && !suspension.exists &&
      !(stored && !stored.valid),
    blocked: Array.isArray(blocked) ? blocked : [],
  };
}

async function loadMember(db, uid, now) {
  return memberFromSnaps(await db.getAll(...memberRefs(db, uid)), now);
}

/**
 * Pairs two members in one transaction, re-reading everything that decides whether they may be paired.
 * Throws HttpError(409) when either is no longer waiting, or no longer eligible or compatible.
 */
export async function pairInTransaction(db, uid, partnerId, now) {
  const myRef = db.doc(`match_queue/${uid}`);
  const theirRef = db.doc(`match_queue/${partnerId}`);
  const convRef = db.collection('conversations').doc();
  await db.runTransaction(async (tx) => {
    const [mine, theirs, ...rest] = await tx.getAll(myRef, theirRef, ...memberRefs(db, uid), ...memberRefs(db, partnerId));
    if (!mine.exists || mine.data().status !== 'waiting') throw new HttpError(409, 'self_not_waiting');
    if (!theirs.exists || theirs.data().status !== 'waiting' || !isFreshQueueEntry(theirs.data(), now)) {
      throw new HttpError(409, 'partner_unavailable');
    }
    const me = memberFromSnaps(rest.slice(0, 4), new Date(now));
    const partner = memberFromSnaps(rest.slice(4), new Date(now));
    if (!me.eligible || !partner.eligible || me.blocked.includes(partnerId) || partner.blocked.includes(uid)) {
      throw new HttpError(409, 'not_compatible');
    }
    if (!agesCompatible({ age: me.age, range: me.range }, { age: partner.age, range: partner.range })) {
      throw new HttpError(409, 'not_compatible');
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
  return convRef.id;
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
      if (!validAgeRange(ageMin, ageMax)) throw new HttpError(400, 'invalid_age_range');
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

      // The app sends the age range it is searching with on every claim, so a range changed since joining (or one that
      // never reached the server) takes effect immediately. An app that does not send it leaves the stored range alone.
      if ('ageMin' in req.body || 'ageMax' in req.body) {
        const { ageMin, ageMax } = req.body;
        const wanted = ageMin === null && ageMax === null ? null : { ageMin, ageMax };
        if (wanted && !validAgeRange(ageMin, ageMax)) throw new HttpError(400, 'invalid_age_range');
        if (!sameRange(me.range, wanted)) {
          const prefsRef = db.doc(`matchPrefs/${uid}`);
          if (wanted) await prefsRef.set({ ...wanted, updatedAt: FieldValue.serverTimestamp() });
          else await prefsRef.delete();
          me.range = wanted;
        }
      }

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
        // A quick pre-check so a candidate who cannot match never costs a transaction. The transaction below
        // repeats it with fresh reads, and that repeat is the one that counts.
        if (!partner.eligible || partner.blocked.includes(uid)) continue;
        if (!agesCompatible({ age: me.age, range: me.range }, { age: partner.age, range: partner.range })) continue;

        try {
          const convId = await pairInTransaction(db, uid, partnerId, now);
          return send(res, 200, { matched: true, partnerId, convId });
        } catch (error) {
          if (error?.message === 'self_not_waiting') return send(res, 200, { matched: false });
          // The partner was claimed or left first, or something changed and they no longer fit: try the next candidate.
        }
      }
      return send(res, 200, { matched: false });
    }

    return send(res, 400, { error: 'invalid_request' });
  } catch (error) {
    return sendError(res, error);
  }
}

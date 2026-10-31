// Read-only diagnostic for "were these two members matched against their age ranges?".
//
//   node scripts/diagnose-match.mjs <uidA> <uidB>
//   node scripts/diagnose-match.mjs --conversation <convId>
//
// It reads, with the Admin SDK, what the matching server reads: each member's stored birthday, saved age range, queue entry,
// suspension and profile state, plus the match audit note and the conversation if there is one. It prints AGES (whole years)
// and RANGES only. It never prints, logs or returns a birth date, a name, or any message. It writes nothing.
//
// Credentials: FIREBASE_SERVICE_ACCOUNT_JSON in the environment (never printed), or the Firestore emulator
// (FIRESTORE_EMULATOR_HOST). Run it from a machine you trust; the output is still private information about members.
import { pathToFileURL } from 'node:url';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { ageFromTimestamp } from '../api/_lib.js';
import { agesCompatible, storedRange } from '../api/_matching.js';

function connect() {
  if (getApps().length) return getFirestore();
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-queerspace-test' });
    return getFirestore();
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Set FIREBASE_SERVICE_ACCOUNT_JSON (or FIRESTORE_EMULATOR_HOST for the emulator).');
  const credentials = JSON.parse(raw);
  initializeApp({ credential: cert(credentials), projectId: credentials.project_id });
  return getFirestore();
}

const iso = (value) => (value instanceof Timestamp ? value.toDate().toISOString() : null);

/** What the matching server would see for one member right now. Contains ages and ranges, never a birth date. */
export async function describeMember(db, uid, now = new Date()) {
  const [settings, profile, suspension, prefs, queue] = await Promise.all([
    db.doc(`users/${uid}/private/settings`).get(),
    db.doc(`users/${uid}/public/profile`).get(),
    db.doc(`suspensions/${uid}`).get(),
    db.doc(`matchPrefs/${uid}`).get(),
    db.doc(`match_queue/${uid}`).get(),
  ]);
  const birth = settings.data()?.birthDate;
  const age = ageFromTimestamp(birth, now);
  const stored = prefs.exists ? storedRange(prefs.data()) : null;
  return {
    uid,
    birthday: birth === undefined ? 'missing' : birth instanceof Timestamp ? 'stored (not shown)' : `stored as ${typeof birth}, not a timestamp: the server cannot read an age from it`,
    ageNow: age,
    ageRangeNow: stored === null ? 'none saved (no age filter)' : stored.valid ? `${stored.range.ageMin}-${stored.range.ageMax}` : 'DAMAGED (member is not matchable)',
    profileComplete: profile.data()?.profileComplete === true,
    suspended: suspension.exists,
    queue: queue.exists
      ? { status: queue.data().status, enteredAt: iso(queue.data().createdAt), lastHeartbeat: iso(queue.data().heartbeatAt), intent: queue.data().intent ?? null }
      : 'no entry',
    _forCompatibility: { age, range: stored?.valid ? stored.range : null },
  };
}

export function verdict(a, b) {
  const x = a._forCompatibility;
  const y = b._forCompatibility;
  const ok = (m) => m.ageNow !== null && m.ageNow >= 18 && m.profileComplete && !m.suspended && !String(m.ageRangeNow).startsWith('DAMAGED');
  if (!ok(a) || !ok(b)) return 'Not matchable today: one member is not eligible (age unknown or under 18, profile incomplete, suspended, or damaged range).';
  return agesCompatible(x, y)
    ? 'Compatible TODAY: each age is inside the other\'s saved range (or a range is not set).'
    : 'NOT compatible today: at least one age is outside the other\'s saved range.';
}

async function main() {
  const args = process.argv.slice(2);
  const db = connect();
  let uids;
  let audit = null;
  let conversation = null;
  if (args[0] === '--conversation' && args[1]) {
    const convSnap = await db.doc(`conversations/${args[1]}`).get();
    if (!convSnap.exists) throw new Error('No such conversation.');
    uids = convSnap.data().participants;
    conversation = { id: args[1], status: convSnap.data().status, createdAt: iso(convSnap.data().createdAt) };
    const auditSnap = await db.doc(`matchAudit/${args[1]}`).get();
    audit = auditSnap.exists
      ? { createdAt: iso(auditSnap.data().createdAt), ageRangeAppliedAtMatchTime: auditSnap.data().ageRangeApplied, ageChecked: auditSnap.data().ageChecked }
      : 'none (this match was made before audit notes existed)';
  } else if (args.length === 2) {
    uids = args;
  } else {
    throw new Error('Usage: diagnose-match.mjs <uidA> <uidB>   or   diagnose-match.mjs --conversation <convId>');
  }
  const [a, b] = await Promise.all(uids.map((uid) => describeMember(db, uid)));
  const strip = ({ _forCompatibility, ...rest }) => rest;
  console.log(JSON.stringify({ conversation, audit, members: [strip(a), strip(b)], verdict: verdict(a, b) }, null, 2));
  console.log('\nNote: ranges and queue entries are today\'s. A range is replaced the next time that member searches, so what they had at the');
  console.log('moment of an older match is only recorded for matches made after audit notes were introduced.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

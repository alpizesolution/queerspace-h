// One-time, idempotent Admin SDK migration for the age privacy fix.
//
// Removes ONLY age-related fields from legacy documents and never deletes a document:
//   users/{uid}/public/profile : age
//   match_queue/{uid}          : age, ageMin, ageMax
// Everything else on those documents is left untouched. Run with --dry-run first (no writes), then without it.
//
//   node scripts/migrate-age-privacy.mjs --dry-run
//   node scripts/migrate-age-privacy.mjs
//
// Credentials: FIREBASE_SERVICE_ACCOUNT_JSON in the environment (never printed), or the Firestore emulator
// (FIRESTORE_EMULATOR_HOST). Safe to re-run: a second run finds nothing to change.
import { pathToFileURL } from 'node:url';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const BATCH_SIZE = 400;

/** Deletes `fields` from every document in `docs` that has any of them. Returns counts only. */
async function scrub(db, docs, fields, dryRun) {
  let scanned = 0;
  let changed = 0;
  let batch = db.batch();
  let pending = 0;
  for (const snap of docs) {
    scanned++;
    const data = snap.data();
    const present = fields.filter((field) => field in data);
    if (!present.length) continue;
    changed++;
    if (dryRun) continue;
    batch.update(snap.ref, Object.fromEntries(present.map((field) => [field, FieldValue.delete()])));
    if (++pending === BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending) await batch.commit();
  return { scanned, changed };
}

export async function migrateAgePrivacy(db, { dryRun = false } = {}) {
  // Profiles live at users/{uid}/public/profile, so the collection group "public" holds exactly those documents.
  const publicDocs = (await db.collectionGroup('public').get()).docs.filter((d) => d.id === 'profile');
  const profiles = await scrub(db, publicDocs, ['age'], dryRun);
  const queue = await scrub(db, (await db.collection('match_queue').get()).docs, ['age', 'ageMin', 'ageMax'], dryRun);
  return { dryRun, profiles, queue };
}

function getDb() {
  if (getApps().length) return getFirestore();
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return getFirestore(initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-queerspace-test' }));
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Set FIREBASE_SERVICE_ACCOUNT_JSON (or use the emulator).');
  const credentials = JSON.parse(raw);
  return getFirestore(initializeApp({ credential: cert(credentials), projectId: credentials.project_id }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  migrateAgePrivacy(getDb(), { dryRun })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error('Migration failed:', error.message);
      process.exitCode = 1;
    });
}

// Audit and (only when told to) repair duplicate pseudonyms, and backfill the reservation registry.
//
//   npx tsx scripts/migrate-pseudonyms.mjs                 audit: counts and duplicate groups. Reads only.
//   npx tsx scripts/migrate-pseudonyms.mjs --plan          the exact renames and registry writes that --apply would do. Reads only.
//   npx tsx scripts/migrate-pseudonyms.mjs --apply --confirm <projectId>
//                                                          performs them. Refuses unless <projectId> is the project in use.
//
// What it does, and does not do:
//   - Names that are already unique are kept exactly as they are; they are only registered (pseudonyms/{key}, pseudonymOwners/{uid}).
//   - In a group of accounts sharing a name (ignoring case, spaces and punctuation) the OLDEST account keeps it. Every other
//     account gets a new generated name that nobody holds. Only users/{uid}/public/profile.displayName (and updatedAt) changes.
//   - User ids, authentication records, conversations, messages, Signals and match data are never touched. Posts and messages
//     already written keep the name they were written under, as history. A renamed member sees the new name the next time the
//     app loads their profile.
//   - Safe to re-run: a second run finds nothing to rename and nothing missing.
//
// Credentials: FIREBASE_SERVICE_ACCOUNT_JSON in the environment (never printed), or the Firestore emulator (FIRESTORE_EMULATOR_HOST).
// The output lists pseudonyms (public by design) and only the first 6 characters of an account id. No birthdays, no messages.
import { pathToFileURL } from 'node:url';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { generatePseudonymCandidates } from '../src/utils/pseudonyms.ts';
import { cleanName, pseudonymKey, withSuffix } from '../api/_pseudonym.js';

function connect() {
  if (getApps().length) return { db: getFirestore(), projectId: process.env.GCLOUD_PROJECT || null };
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const projectId = process.env.GCLOUD_PROJECT || 'demo-queerspace-test';
    initializeApp({ projectId });
    return { db: getFirestore(), projectId };
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Set FIREBASE_SERVICE_ACCOUNT_JSON (or FIRESTORE_EMULATOR_HOST for the emulator).');
  const credentials = JSON.parse(raw);
  initializeApp({ credential: cert(credentials), projectId: credentials.project_id });
  return { db: getFirestore(), projectId: credentials.project_id };
}

const millis = (value) => (value instanceof Timestamp ? value.toMillis() : null);
const short = (uid) => `${uid.slice(0, 6)}…`;

/** Every account's public pseudonym and join time. */
export async function loadProfiles(db) {
  const snap = await db.collectionGroup('public').get();
  const profiles = [];
  for (const doc of snap.docs) {
    if (doc.id !== 'profile') continue;
    const data = doc.data();
    const uid = doc.ref.parent.parent?.id;
    if (!uid) continue;
    profiles.push({ uid, displayName: typeof data.displayName === 'string' ? data.displayName : '', createdAt: millis(data.createdAt) });
  }
  return profiles;
}

/** Existing registry claims, key -> uid. */
export async function loadClaims(db) {
  const snap = await db.collection('pseudonyms').get();
  return new Map(snap.docs.map((doc) => [doc.id, doc.data().uid]));
}

/**
 * Decides, without writing anything, who keeps which name.
 * `claims` are reservations that already exist: a claim by another account always beats an unregistered profile.
 * `random` is injectable for tests.
 */
export function planMigration(profiles, claims = new Map(), random = Math.random) {
  const named = profiles.filter((p) => cleanName(p.displayName));
  const skipped = profiles.length - named.length;
  const byKey = new Map();
  for (const p of named) {
    const key = pseudonymKey(p.displayName);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(p);
  }
  // Oldest account first; accounts without a join time last; account id breaks ties so the result is repeatable.
  const order = (a, b) => (a.createdAt ?? Infinity) - (b.createdAt ?? Infinity) || a.uid.localeCompare(b.uid);

  const taken = new Set(byKey.keys());
  for (const key of claims.keys()) taken.add(key);
  const keep = []; // { uid, name, key } already fine, may still need registering
  const rename = []; // { uid, from, to, key }
  const duplicateGroups = [];

  for (const [key, group] of byKey) {
    group.sort(order);
    const holder = claims.get(key);
    // An existing claim by one of these accounts wins; otherwise the oldest account keeps the name.
    const keeper = (holder && group.find((p) => p.uid === holder)) || (holder ? null : group[0]);
    if (group.length > 1 || (holder && !keeper)) duplicateGroups.push({ key, name: group[0].displayName, accounts: group.length });
    for (const p of group) {
      if (p === keeper) keep.push({ uid: p.uid, name: p.displayName.trim(), key });
      else rename.push({ uid: p.uid, from: p.displayName, key });
    }
  }

  for (const entry of rename.sort(order_by_uid)) {
    let chosen = null;
    for (const candidate of generatePseudonymCandidates(24, random)) {
      if (!taken.has(pseudonymKey(candidate))) { chosen = candidate; break; }
    }
    // Practically unreachable with ~30,000 names; the numbered form still guarantees a free one.
    for (let i = 0; !chosen && i < 50; i++) {
      const candidate = withSuffix(generatePseudonymCandidates(1, random)[0], random);
      if (!taken.has(pseudonymKey(candidate))) chosen = candidate;
    }
    if (!chosen) throw new Error('Could not find a free name; nothing was changed.');
    taken.add(pseudonymKey(chosen));
    entry.to = chosen;
    entry.toKey = pseudonymKey(chosen);
  }

  const missingClaims = keep.filter((k) => claims.get(k.key) !== k.uid);
  return {
    totals: {
      accounts: profiles.length,
      withoutUsableName: skipped,
      distinctNames: byKey.size,
      duplicateGroups: duplicateGroups.length,
      accountsToRename: rename.length,
      alreadyRegistered: keep.length - missingClaims.length,
      toRegister: missingClaims.length + rename.length,
    },
    duplicateGroups: duplicateGroups.sort((a, b) => b.accounts - a.accounts || a.name.localeCompare(b.name)),
    keep,
    rename,
    register: missingClaims,
  };
}
function order_by_uid(a, b) {
  return a.uid.localeCompare(b.uid);
}

/** Writes the plan. Profiles keep every other field; only displayName and updatedAt change on the renamed ones. */
export async function applyPlan(db, plan) {
  // One transaction per account, re-checked at write time: the plan may be minutes old and members keep registering names
  // meanwhile. A claim held by another account is never overwritten, and an account that changed its name since the plan
  // is left alone. Skipped entries are reported; running the script again plans them afresh. Finished entries stay finished,
  // so an interrupted run resumes by simply running it again.
  const result = { registered: 0, renamed: 0, skipped: [] };
  const claim = (tx, uid, name, key) => {
    tx.set(db.doc(`pseudonyms/${key}`), { uid, name, createdAt: FieldValue.serverTimestamp() });
    tx.set(db.doc(`pseudonymOwners/${uid}`), { key, name, updatedAt: FieldValue.serverTimestamp() });
  };
  for (const entry of plan.register) {
    await db.runTransaction(async (tx) => {
      const [claimSnap, ownerSnap] = await Promise.all([tx.get(db.doc(`pseudonyms/${entry.key}`)), tx.get(db.doc(`pseudonymOwners/${entry.uid}`))]);
      if (claimSnap.exists && claimSnap.data().uid !== entry.uid) return void result.skipped.push({ uid: entry.uid, reason: 'name reserved by another account' });
      if (ownerSnap.exists && ownerSnap.data().key !== entry.key) return void result.skipped.push({ uid: entry.uid, reason: 'account reserved a different name since the plan' });
      if (claimSnap.exists && ownerSnap.exists) return; // already registered
      claim(tx, entry.uid, entry.name, entry.key);
      result.registered++;
    });
  }
  for (const entry of plan.rename) {
    await db.runTransaction(async (tx) => {
      const profileRef = db.doc(`users/${entry.uid}/public/profile`);
      const [profileSnap, claimSnap, ownerSnap] = await Promise.all([tx.get(profileRef), tx.get(db.doc(`pseudonyms/${entry.toKey}`)), tx.get(db.doc(`pseudonymOwners/${entry.uid}`))]);
      if (!profileSnap.exists || profileSnap.data().displayName !== entry.from) return void result.skipped.push({ uid: entry.uid, reason: 'profile changed since the plan' });
      if (claimSnap.exists && claimSnap.data().uid !== entry.uid) return void result.skipped.push({ uid: entry.uid, reason: 'new name taken since the plan' });
      if (ownerSnap.exists && ownerSnap.data().key !== entry.toKey) return void result.skipped.push({ uid: entry.uid, reason: 'account reserved a different name since the plan' });
      tx.update(profileRef, { displayName: entry.to, updatedAt: FieldValue.serverTimestamp() });
      claim(tx, entry.uid, entry.to, entry.toKey);
      result.renamed++;
    });
  }
  return result;
}

function print(plan, withRenames) {
  console.log(JSON.stringify(plan.totals, null, 2));
  if (plan.duplicateGroups.length) {
    console.log('\nNames shared by more than one account (name, accounts):');
    for (const g of plan.duplicateGroups.slice(0, 50)) console.log(`  ${g.name}  x${g.accounts}`);
    if (plan.duplicateGroups.length > 50) console.log(`  … and ${plan.duplicateGroups.length - 50} more`);
  }
  if (withRenames) {
    console.log(`\nKeeping their current name (${plan.keep.length}):`);
    for (const k of plan.keep.slice(0, 100)) console.log(`  ${short(k.uid)}  ${k.name}`);
    if (plan.keep.length > 100) console.log(`  … and ${plan.keep.length - 100} more`);
    console.log('\nRenames (account, old -> new). The oldest account in each group keeps the name:');
    for (const r of plan.rename) console.log(`  ${short(r.uid)}  ${r.from} -> ${r.to}`);
    console.log(`\nRegistry entries to create: ${plan.totals.toRegister}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const { db, projectId } = connect();
  const [profiles, claims] = await Promise.all([loadProfiles(db), loadClaims(db)]);
  const plan = planMigration(profiles, claims);
  const apply = args.includes('--apply');
  print(plan, apply || args.includes('--plan'));
  if (!apply) {
    console.log('\nRead-only run: nothing was written.');
    return;
  }
  const confirmed = args[args.indexOf('--confirm') + 1];
  if (!args.includes('--confirm') || !projectId || confirmed !== projectId) {
    throw new Error(`Refusing to write: pass --confirm ${projectId ?? '<projectId>'} to confirm the project you mean to change.`);
  }
  const result = await applyPlan(db, plan);
  console.log(`\nDone in ${projectId}. Renamed ${result.renamed} account(s), registered ${result.registered} name(s).`);
  if (result.skipped.length) {
    console.log(`Skipped ${result.skipped.length} because something changed since the plan (nothing was overwritten). Run the script again to plan them afresh:`);
    for (const s of result.skipped) console.log(`  ${short(s.uid)}  ${s.reason}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

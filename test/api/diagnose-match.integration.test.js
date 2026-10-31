// The diagnostic prints ages and ranges, never a birth date, and gives the right verdict for the reported pair.
// Run with SIGNALS_INTEGRATION_TESTS=true (never against production).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';

const enabled = process.env.SIGNALS_INTEGRATION_TESTS === 'true';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ||= 'demo-queerspace-test';
const skip = !enabled ? 'Set SIGNALS_INTEGRATION_TESTS=true to run against Firebase emulators.' : false;

test('the diagnostic shows age and range, flags the reported mismatch, and never prints a birth date', { skip }, async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { describeMember, verdict } = await import('../../scripts/diagnose-match.mjs');
  const db = getFirestore(getAdminApp());
  const now = new Date(Date.UTC(2026, 9, 30, 12));
  // Born on these exact dates: neither may ever appear in the output.
  const luna = Timestamp.fromDate(new Date(Date.UTC(1996, 4, 17)));
  const mika = Timestamp.fromDate(new Date(Date.UTC(2007, 1, 3)));
  await db.doc('users/luna/private/settings').set({ birthDate: luna, createdAt: new Date(), updatedAt: new Date() });
  await db.doc('users/mika/private/settings').set({ birthDate: mika, createdAt: new Date(), updatedAt: new Date() });
  for (const uid of ['luna', 'mika']) await db.doc(`users/${uid}/public/profile`).set({ displayName: `secret-name-${uid}`, profileComplete: true });
  await db.doc('matchPrefs/luna').set({ ageMin: 25, ageMax: 35 });
  await db.doc('match_queue/luna').set({ status: 'waiting', createdAt: Timestamp.now(), heartbeatAt: Timestamp.now(), intent: 'open' });

  const [a, b] = await Promise.all([describeMember(db, 'luna', now), describeMember(db, 'mika', now)]);
  assert.equal(a.ageNow, 30);
  assert.equal(b.ageNow, 19);
  assert.equal(a.ageRangeNow, '25-35');
  assert.match(b.ageRangeNow, /none saved/);
  assert.match(verdict(a, b), /NOT compatible/);

  const printed = JSON.stringify([a, b]);
  for (const forbidden of ['1996', '2007-02', '05-17', 'birthDate', 'secret-name']) assert.equal(printed.includes(forbidden), false, forbidden);
  assert.equal(a.birthday, 'stored (not shown)');

  // Fail closed: no birthday, a damaged range, a suspension.
  await db.doc('users/mika/private/settings').set({ createdAt: new Date() });
  assert.match(verdict(a, await describeMember(db, 'mika', now)), /Not matchable/);
  await db.doc('users/mika/private/settings').set({ birthDate: Timestamp.fromDate(new Date(Date.UTC(1995, 0, 1))), createdAt: new Date() });
  await db.doc('matchPrefs/mika').set({ updatedAt: new Date() });
  assert.equal((await describeMember(db, 'mika', now)).ageRangeNow, 'DAMAGED (member is not matchable)');
  assert.match(verdict(a, await describeMember(db, 'mika', now)), /Not matchable/);
});

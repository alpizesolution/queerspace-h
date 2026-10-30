import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { MINIMUM_AGE, ageFromDate, ageFromTimestamp } from '../../api/_lib.js';
import { RANGE_MAX_AGE, RANGE_MIN_AGE, agesCompatible, ageFits, sameRange, storedRange, validAgeRange } from '../../api/_matching.js';
import { memberFromSnaps } from '../../api/match.js';
import { calculateAge } from '../../src/utils/ageEligibility.ts';

const range = { ageMin: 25, ageMax: 35 };

test('a 25-35 range: 19, 24 and 36 are out; 25, 30 and 35 are in; a missing birthday is out', () => {
  const table = [[19, false], [24, false], [25, true], [30, true], [35, true], [36, false], [null, false], [undefined, false]];
  for (const [age, expected] of table) {
    assert.equal(ageFits(range, age), expected, `age ${age}`);
    // The same answer whichever person holds the range.
    assert.equal(agesCompatible({ age: 30, range }, { age, range: null }), expected, `me 30 holding ${JSON.stringify(range)} vs ${age}`);
    assert.equal(agesCompatible({ age, range: null }, { age: 30, range }), expected, `${age} vs partner holding the range`);
  }
});

test('a number that is not a real age never passes a range, however it is written', () => {
  for (const bad of ['30', NaN, Infinity, 30.5, -1, {}, [], true]) assert.equal(ageFits(range, bad), false, String(bad));
});

test('two people whose ranges do not fit each other are never compatible, in either direction', () => {
  const young = { age: 22, range: { ageMin: 18, ageMax: 25 } };
  const older = { age: 40, range: { ageMin: 35, ageMax: 50 } };
  assert.equal(agesCompatible(young, older), false); // each is outside the other's range
  assert.equal(agesCompatible(older, young), false);
  // One-sided fit is not enough: 30 wants 25-35, the 33-year-old only wants 40+.
  assert.equal(agesCompatible({ age: 30, range }, { age: 33, range: { ageMin: 40, ageMax: 60 } }), false);
  // Both fit: compatible. And no ranges at all means no age filter.
  assert.equal(agesCompatible({ age: 30, range }, { age: 33, range: { ageMin: 28, ageMax: 40 } }), true);
  assert.equal(agesCompatible({ age: 19, range: null }, { age: 61, range: null }), true);
});

test('what counts as a usable range, and a damaged stored range is never read as "no filter"', () => {
  assert.equal(validAgeRange(25, 35), true);
  assert.equal(validAgeRange(35, 25), false);
  assert.equal(validAgeRange(17, 30), false);
  assert.equal(validAgeRange(25, 100), false);
  assert.equal(validAgeRange(25.5, 30), false);
  assert.equal(validAgeRange('25', 35), false);
  assert.deepEqual(storedRange({ ageMin: 25, ageMax: 35, updatedAt: 1 }), { valid: true, range: range });
  for (const damaged of [{}, { ageMin: 25 }, { ageMin: 40, ageMax: 20 }, { ageMin: 'x', ageMax: 'y' }, null]) {
    assert.equal(storedRange(damaged).valid, false, JSON.stringify(damaged));
  }
  assert.equal(sameRange(range, { ageMin: 25, ageMax: 35 }), true);
  assert.equal(sameRange(range, { ageMin: 25, ageMax: 36 }), false);
  assert.equal(sameRange(null, null), true);
  assert.equal(sameRange(null, range), false);
  assert.equal(RANGE_MIN_AGE, MINIMUM_AGE, 'the range floor and the 18+ gate are the same number');
  assert.equal(RANGE_MAX_AGE, 99);
});

const snap = (data) => ({ exists: data !== undefined, data: () => data });
const member = (birth, { profile = true, suspended = false, prefs } = {}, now = new Date(Date.UTC(2026, 9, 30, 12))) =>
  memberFromSnaps(
    [snap({ ...(birth ? { birthDate: Timestamp.fromDate(birth) } : {}) }), snap({ profileComplete: profile }), snap(suspended ? { reason: 'x' } : undefined), snap(prefs)],
    now
  );
const dob = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

test('matching eligibility comes from the stored birthday and the account state, and fails closed', () => {
  assert.equal(member(dob(1996, 1, 1)).eligible, true);
  assert.equal(member(null).eligible, false, 'no birthday');
  assert.equal(member(dob(2010, 1, 1)).eligible, false, 'under 18');
  assert.equal(member(dob(1996, 1, 1), { profile: false }).eligible, false);
  assert.equal(member(dob(1996, 1, 1), { suspended: true }).eligible, false);
  // A stored range is read only if it is usable; a damaged one makes the member unmatchable, not unfiltered.
  assert.deepEqual(member(dob(1996, 1, 1), { prefs: { ageMin: 25, ageMax: 35 } }).range, range);
  assert.equal(member(dob(1996, 1, 1), { prefs: { ageMin: 25 } }).eligible, false);
  assert.equal(member(dob(1996, 1, 1), { prefs: { ageMin: 35, ageMax: 25 } }).eligible, false);
  assert.equal(member(dob(1996, 1, 1)).range, null);
});

test('age follows the birthday exactly, in UTC, the same way on the server and in the app', () => {
  // Turning 26 on 31 October 2000: still 25 until that UTC day starts.
  const born = dob(2000, 10, 31);
  assert.equal(ageFromDate(born, new Date(Date.UTC(2026, 9, 30, 23, 59, 59))), 25);
  assert.equal(ageFromDate(born, new Date(Date.UTC(2026, 9, 31, 0, 0, 0))), 26);
  // A 29 February birthday: 21 on 28 February, 22 on 1 March.
  assert.equal(ageFromDate(dob(2004, 2, 29), new Date(Date.UTC(2026, 1, 28, 12))), 21);
  assert.equal(ageFromDate(dob(2004, 2, 29), new Date(Date.UTC(2026, 2, 1, 12))), 22);
  // The eligibility edges used by the 25-35 range, at the boundary of the birthday.
  const now = new Date(Date.UTC(2026, 9, 30, 12));
  assert.equal(ageFromDate(dob(2001, 10, 30), now), 25, 'turns 25 today: in');
  assert.equal(ageFromDate(dob(2001, 10, 31), now), 24, 'turns 25 tomorrow: out');
  assert.equal(ageFromDate(dob(1990, 10, 30), now), 36, 'turned 36 today: out');
  assert.equal(ageFromDate(dob(1990, 10, 31), now), 35, 'turns 36 tomorrow: still in');
  // Missing, invalid or future dates have no age at all.
  assert.equal(ageFromDate(new Date('nope'), now), null);
  assert.equal(ageFromDate(dob(2030, 1, 1), now), null);
  assert.equal(ageFromTimestamp(undefined, now), null);
  assert.equal(ageFromTimestamp('1996-01-01', now), null, 'a text date is not a stored birthday');
  // The app's own calculation agrees with the server's across a spread of dates and moments.
  for (const born of ['1990-02-28', '1990-02-28', '2000-02-29', '1999-12-31', '2007-10-30', '2007-10-31', '2008-01-01']) {
    for (const at of [Date.UTC(2026, 9, 30, 0, 0, 0), Date.UTC(2026, 9, 30, 23, 59, 59), Date.UTC(2027, 0, 1, 0, 0, 0), Date.UTC(2028, 1, 29, 12)]) {
      const [y, m, d] = born.split('-').map(Number);
      assert.equal(ageFromDate(dob(y, m, d), new Date(at)), calculateAge(born, new Date(at)), `${born} at ${new Date(at).toISOString()}`);
    }
  }
});

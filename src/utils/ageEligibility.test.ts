import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateAge, isAdultBirthDate, isValidBirthDate } from './ageEligibility.ts';

test('calculates age on either side of a birthday', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  assert.equal(calculateAge('2008-10-29', now), 17);
  assert.equal(calculateAge('2008-10-28', now), 18);
  assert.equal(calculateAge('1990-01-01', now), 36);
});
test('rejects invalid, future, and under-18 birthdays', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  assert.equal(isValidBirthDate('2000-02-30', now), false);
  assert.equal(isValidBirthDate('2027-01-01', now), false);
  assert.equal(isAdultBirthDate('2010-01-01', now), false);
  assert.equal(isAdultBirthDate('2008-10-28', now), true);
});

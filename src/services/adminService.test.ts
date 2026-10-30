import test from 'node:test';
import assert from 'node:assert/strict';
import { indexLinkFromError, lastDays, pctChange, splitPeriods } from './adminService.ts';

test('lastDays returns consecutive local midnights ending today', () => {
  const days = lastDays(14, new Date(2026, 9, 24, 15, 30));
  assert.equal(days.length, 14);
  assert.equal(days[13], new Date(2026, 9, 24).getTime());
  assert.equal(days[0], new Date(2026, 9, 11).getTime());
});

test('indexLinkFromError pulls the console link out of a missing-index error', () => {
  const err = new Error(
    'The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/x/firestore/indexes?create_exemption=abc'
  );
  assert.equal(
    indexLinkFromError(err),
    'https://console.firebase.google.com/v1/r/project/x/firestore/indexes?create_exemption=abc'
  );
  assert.equal(indexLinkFromError(new Error('permission-denied')), null);
});

test('splitPeriods separates the last N days from the N before', () => {
  const { current, previous } = splitPeriods([1, 2, 3, 4, 5, 6], 3);
  assert.deepEqual(current, [4, 5, 6]);
  assert.deepEqual(previous, [1, 2, 3]);
});

test('pctChange compares with the previous period and never divides by zero', () => {
  assert.equal(pctChange(15, 10), 50);
  assert.equal(pctChange(5, 10), -50);
  assert.equal(pctChange(4, 4), 0);
  assert.equal(pctChange(3, 0), null);
});

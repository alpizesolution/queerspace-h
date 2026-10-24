import test from 'node:test';
import assert from 'node:assert/strict';
import { indexLinkFromError, lastDays } from './adminService.ts';

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

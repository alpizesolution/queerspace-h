import test from 'node:test';
import assert from 'node:assert/strict';
import { isQuotaError, nextResetLabel } from './quotaGuard.ts';

test('isQuotaError spots Firestore quota errors in their usual shapes', () => {
  assert.equal(isQuotaError({ code: 'resource-exhausted', message: 'Quota exceeded.' }), true);
  assert.equal(isQuotaError(new Error('8 RESOURCE_EXHAUSTED: Quota exceeded.')), true);
  assert.equal(isQuotaError('[PublicRoom] FirebaseError: Quota exceeded.'), true);
  assert.equal(isQuotaError({ code: 'permission-denied', message: 'Missing or insufficient permissions.' }), false);
  assert.equal(isQuotaError(undefined), false);
});

test('nextResetLabel is midnight Pacific in Philippine time (3 PM in PDT, 4 PM in PST)', () => {
  assert.equal(nextResetLabel(new Date('2026-10-25T15:00:00Z')), '3:00 PM PHT');
  assert.equal(nextResetLabel(new Date('2026-11-10T03:00:00Z')), '4:00 PM PHT');
});

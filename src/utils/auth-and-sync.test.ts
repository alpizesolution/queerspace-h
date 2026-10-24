import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSyncFeedback, executeHonestStorageWrite } from './sync-feedback.ts';

test('formatSyncFeedback reports cloud success only when cloud write succeeds', () => {
  const result = formatSyncFeedback('Preferences', true, true, true, null);
  assert.equal(result.savedToCloud, true);
  assert.equal(result.savedLocally, true);
  assert.equal(result.userMessage, 'Preferences saved to cloud securely.');
});

test('formatSyncFeedback explicitly reports local fallback when cloud fails', () => {
  const result = formatSyncFeedback('Preferences', true, true, false, 'Permission denied');
  assert.equal(result.savedToCloud, false);
  assert.equal(result.savedLocally, true);
  assert.equal(result.error, 'Permission denied');
  assert.equal(result.userMessage, 'Preferences — Cloud sync unavailable, saved locally.');
});

test('formatSyncFeedback reports local demo mode when cloud is not attempted', () => {
  const result = formatSyncFeedback('Preferences', true, false, false, null);
  assert.equal(result.savedToCloud, false);
  assert.equal(result.savedLocally, true);
  assert.equal(result.userMessage, 'Preferences saved locally (Offline Demo Mode).');
});

test('formatSyncFeedback handles complete save failure honestly', () => {
  const result = formatSyncFeedback('Preferences', false, true, false, 'Quota exceeded');
  assert.equal(result.savedToCloud, false);
  assert.equal(result.savedLocally, false);
  assert.equal(result.userMessage, 'Failed to save preferences. Please try again.');
});

test('executeHonestStorageWrite handles local-only saver', async () => {
  const result = await executeHonestStorageWrite('Settings', () => true);
  assert.equal(result.savedLocally, true);
  assert.equal(result.savedToCloud, false);
  assert.match(result.userMessage, /saved locally/i);
});

test('executeHonestStorageWrite reports local save when cloud save throws error', async () => {
  const result = await executeHonestStorageWrite(
    'Profile',
    () => true,
    async () => {
      throw new Error('Firestore connection error');
    }
  );
  assert.equal(result.savedLocally, true);
  assert.equal(result.savedToCloud, false);
  assert.equal(result.error, 'Firestore connection error');
  assert.match(result.userMessage, /Cloud sync unavailable, saved locally/i);
});

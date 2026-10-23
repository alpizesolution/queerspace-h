import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPublicProfilePayload,
  buildPrivateSettingsPayload,
  saveAnonymousProfile,
  loadAnonymousProfile,
} from './profilePersistence.ts';
import { UserPreferences } from '../types.ts';

const mockPrefs: UserPreferences = {
  displayName: 'Super long display name that exceeds thirty characters for testing limit',
  pronouns: 'she/her/they/them/long',
  intention: 'friendship',
  region: 'Metro Manila',
  topics: ['Books', 'Cats', 'Music', 'Art', 'Coffee', 'Hiking', 'Poetry', 'Travel', 'ExtraTopic1', 'ExtraTopic2'],
  sexualOrientation: 'Lesbian',
  genderExpression: ['Femme'],
  preferredGenderExpressions: ['Femme', 'Andro'],
  locationSelection: ['Quezon City'],
};

test('buildPublicProfilePayload enforces field boundaries and excludes SOGIE fields', () => {
  const payload = buildPublicProfilePayload(mockPrefs);

  assert.equal(payload.displayName.length <= 30, true);
  assert.equal(payload.displayName, 'Super long display name that e');

  assert.equal(payload.pronouns.length <= 20, true);
  assert.equal(payload.intention, 'friendship');
  assert.equal(payload.region, 'Metro Manila');
  assert.equal(payload.topics.length <= 8, true);
  assert.deepEqual(payload.topics, ['Books', 'Cats', 'Music', 'Art', 'Coffee', 'Hiking', 'Poetry', 'Travel']);

  // Verify private fields are NOT present in public payload
  assert.equal('sexualOrientation' in payload, false);
  assert.equal('genderExpression' in payload, false);
  assert.equal('exactLocation' in payload, false);
  assert.equal('blockedPartnerIds' in payload, false);
});

test('buildPrivateSettingsPayload isolates SOGIE, location, and blocklist data', () => {
  const privatePayload = buildPrivateSettingsPayload(mockPrefs, ['blocked123']);

  assert.equal(privatePayload.exactLocation, 'Quezon City');
  assert.equal(privatePayload.sexualOrientation, 'Lesbian');
  assert.deepEqual(privatePayload.genderExpression, ['Femme']);
  assert.deepEqual(privatePayload.preferredGenderExpressions, ['Femme', 'Andro']);
  assert.deepEqual(privatePayload.blockedPartnerIds, ['blocked123']);

  // Verify public fields are NOT present in private payload
  assert.equal('displayName' in privatePayload, false);
  assert.equal('pronouns' in privatePayload, false);
  assert.equal('topics' in privatePayload, false);
});

test('saveAnonymousProfile saves to local storage and returns honest feedback when offline', async () => {
  const result = await saveAnonymousProfile(mockPrefs, ['blocked123']);

  assert.equal(result.savedLocally, true);
  assert.equal(typeof result.userMessage, 'string');
});

test('loadAnonymousProfile returns default local profile when cloud is unavailable', async () => {
  const loadResult = await loadAnonymousProfile();

  assert.equal(loadResult.source, 'local');
  assert.equal(loadResult.fromCloudSuccess, false);
  assert.equal(typeof loadResult.prefs.displayName, 'string');
});

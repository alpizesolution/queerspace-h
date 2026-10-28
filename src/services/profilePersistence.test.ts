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
  assert.equal(typeof payload.sexualOrientation === 'string', false);
  assert.equal(Array.isArray(payload.genderExpression), false);
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

test('buildPublicProfilePayload keeps a valid avatar and drops an invalid one', () => {
  assert.equal(buildPublicProfilePayload({ ...mockPrefs, avatar: 'cat.1.2' }).avatar, 'cat.1.2');
  assert.equal('avatar' in buildPublicProfilePayload({ ...mockPrefs, avatar: '<script>' }), false);
  assert.equal('avatar' in buildPublicProfilePayload(mockPrefs), false);
});

// ---------------------------------------------------------------- Cloud restore

import { mergeCloudProfile, cloudProfileSignature } from './profilePersistence.ts';

const local: UserPreferences = {
  displayName: 'Local_Name',
  pronouns: 'fae/faer',
  customPronouns: 'fae/faer',
  intention: 'dating',
  topics: ['Books'],
  region: 'Cebu',
  genderIdentity: 'Non-binary',
  genderExpression: ['Andro'],
  showLocationOnProfile: false,
  locationSelection: ['Cebu'],
  applyLocationFilter: true,
  applyGenderExpressionFilter: true,
  preferredGenderExpressions: ['Femme'],
  age: 29,
  applyAgeFilter: true,
  ageMin: 25,
  ageMax: 35,
};

test('cloud restore keeps every field the cloud does not store', () => {
  const restored = mergeCloudProfile(
    local,
    { displayName: 'Cloud_Name', pronouns: 'fae/faer', intention: 'dating', region: 'Cebu', topics: ['Books', 'Art'] },
    { sexualOrientation: 'Lesbian', genderExpression: ['Andro'], preferredGenderExpressions: ['Femme'] }
  );
  assert.equal(restored.displayName, 'Cloud_Name');
  assert.deepEqual(restored.topics, ['Books', 'Art']);
  assert.equal(restored.sexualOrientation, 'Lesbian');
  // Previously reset by a cloud restore:
  assert.equal(restored.customPronouns, 'fae/faer');
  assert.equal(restored.genderIdentity, 'Non-binary');
  assert.deepEqual(restored.locationSelection, ['Cebu']);
  assert.equal(restored.applyLocationFilter, true);
  assert.equal(restored.applyGenderExpressionFilter, true);
  assert.equal(restored.age, 29);
  assert.equal(restored.applyAgeFilter, true);
  assert.equal(restored.ageMin, 25);
  assert.equal(restored.ageMax, 35);
  // A visibility flag the cloud doesn't have keeps the local value.
  assert.equal(restored.showLocationOnProfile, false);
});

test('legacy or partial cloud data restores safely without overwriting valid local values', () => {
  const restored = mergeCloudProfile(local, { displayName: '', intention: 'not-a-real-intention', topics: 'x' }, {});
  assert.equal(restored.displayName, 'Local_Name');
  assert.equal(restored.intention, 'dating');
  assert.deepEqual(restored.topics, ['Books']);
  assert.deepEqual(restored.genderExpression, ['Andro']);

  const fresh = mergeCloudProfile(
    { displayName: 'X', pronouns: 'she/her', intention: 'open', topics: [], region: '' },
    {},
    { exactLocation: 'Davao City' }
  );
  assert.deepEqual(fresh.locationSelection, ['Davao City']);
});

test('a self-described orientation saves its text and restores as Self-described', () => {
  const prefs: UserPreferences = { ...local, sexualOrientation: 'Self-described', sexualOrientationCustom: 'Sapphic & proud' };
  const saved = buildPrivateSettingsPayload(prefs).sexualOrientation;
  assert.equal(saved, 'Sapphic & proud');
  const restored = mergeCloudProfile(local, {}, { sexualOrientation: saved });
  assert.equal(restored.sexualOrientation, 'Self-described');
  assert.equal(restored.sexualOrientationCustom, 'Sapphic & proud');
  // Older saves stored the custom text the same way, so they restore the same.
  assert.equal(buildPrivateSettingsPayload({ ...local, sexualOrientation: 'Bisexual' }).sexualOrientation, 'Bisexual');
});

test('cloud save then restore round-trips every cloud-stored field', () => {
  const prefs: UserPreferences = { ...local, avatar: 'cat.1.2', showGenderExpressionOnProfile: true, showSogieOnProfile: false, sexualOrientation: 'Bisexual' };
  const { updatedAt: _a, ...pub } = buildPublicProfilePayload(prefs);
  const { updatedAt: _b, ...priv } = buildPrivateSettingsPayload(prefs, ['b1']);
  const restored = mergeCloudProfile({ displayName: 'Other', pronouns: 'she/her', intention: 'open', topics: [], region: '' }, pub, priv);
  for (const key of ['displayName', 'avatar', 'pronouns', 'intention', 'region', 'topics', 'showGenderExpressionOnProfile', 'showSogieOnProfile', 'showLocationOnProfile', 'sexualOrientation', 'genderExpression', 'preferredGenderExpressions'] as const) {
    assert.deepEqual(restored[key], prefs[key], key);
  }
});

test('the cloud signature ignores device-only fields, so changing them skips the cloud write', () => {
  const base = cloudProfileSignature(local, ['b1']);
  assert.equal(cloudProfileSignature({ ...local, age: 40, applyAgeFilter: false, ageMin: 30 }, ['b1']), base);
  assert.notEqual(cloudProfileSignature({ ...local, displayName: 'Changed' }, ['b1']), base);
  assert.notEqual(cloudProfileSignature(local, ['b1', 'b2']), base);
});

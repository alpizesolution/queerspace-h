import test from 'node:test';
import assert from 'node:assert/strict';
import { UserPreferences } from '../types.ts';
import { applyFilters, applyProfile, matchPrefsForMode, pickFilters, pickProfile, PROFILE_KEYS, FILTER_KEYS } from './preferences.ts';
import { queueMatchFields } from '../services/liveMatchService.ts';

const full: UserPreferences = {
  displayName: 'Cozy_Raccoon',
  avatar: 'cat.1.2',
  pronouns: 'they/she',
  intention: 'dating',
  topics: ['Books', 'Coffee'],
  region: 'Cebu',
  sexualOrientation: 'Lesbian',
  genderIdentity: 'Non-binary',
  genderExpression: ['Andro'],
  myVibe: 'Andro',
  showGenderExpressionOnProfile: false,
  showSogieOnProfile: true,
  showLocationOnProfile: false,
  applyGenderExpressionFilter: true,
  preferredGenderExpressions: ['Femme'],
  locationSelection: ['Cebu'],
  applyLocationFilter: true,
  age: 27,
  applyAgeFilter: true,
  ageMin: 24,
  ageMax: 32,
};

test('profile and filter keys never overlap', () => {
  const overlap = PROFILE_KEYS.filter((k) => (FILTER_KEYS as readonly string[]).includes(k));
  assert.deepEqual(overlap, []);
});

test('saving a profile does not change any matching preference', () => {
  const next = applyProfile(full, { ...pickProfile(full), displayName: 'New_Name', sexualOrientation: undefined });
  assert.equal(next.displayName, 'New_Name');
  assert.equal(next.sexualOrientation, undefined);
  assert.deepEqual(pickFilters(next), pickFilters(full));
});

test('changing chat filters does not change profile fields or visibility flags', () => {
  const next = applyFilters(full, {
    ...pickFilters(full),
    intention: 'friendship',
    topics: [],
    applyLocationFilter: false,
    applyGenderExpressionFilter: false,
  });
  assert.equal(next.intention, 'friendship');
  assert.deepEqual(pickProfile(next), pickProfile(full));
});

test('a Quick search runs without filters but leaves the saved Custom filters intact', () => {
  const quick = matchPrefsForMode(full, 'quick');
  assert.equal(quick.intention, 'open');
  assert.deepEqual(quick.topics, []);
  assert.equal(quick.applyAgeFilter, false);
  assert.equal(quick.applyLocationFilter, false);
  assert.equal(quick.applyGenderExpressionFilter, false);
  // The input is not modified, so switching back to Custom finds everything still set.
  assert.equal(full.intention, 'dating');
  assert.deepEqual(full.topics, ['Books', 'Coffee']);
  assert.equal(matchPrefsForMode(full, 'custom'), full);

  const fields = queueMatchFields(quick);
  assert.equal(fields.wantAreas, undefined);
  assert.equal(fields.wantExpr, undefined);
  assert.equal(fields.ageMin, undefined);
  assert.equal(fields.intent, 'open');
});

test('private gender expression and hidden area stay out of the queue while my own filters still apply', () => {
  const fields = queueMatchFields(full);
  // Private gender expression is never published; only the public My Vibe label is.
  assert.deepEqual(fields.expr, ['Andro']);
  assert.equal(JSON.stringify(fields).includes('Lesbian'), false);
  assert.equal(fields.areas, undefined);
  // My filters are independent of what I show.
  assert.deepEqual(fields.wantExpr, ['Femme']);
  assert.deepEqual(fields.wantAreas, ['Cebu']);
  assert.equal(fields.ageMin, 24);

  const shown = queueMatchFields({ ...full, showGenderExpressionOnProfile: true, showLocationOnProfile: true });
  assert.deepEqual(shown.expr, ['Andro']);
  assert.deepEqual(shown.areas, ['Cebu']);
});

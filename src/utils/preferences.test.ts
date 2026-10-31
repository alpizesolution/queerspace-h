import test from 'node:test';
import assert from 'node:assert/strict';
import { UserPreferences } from '../types.ts';
import { applyFilters, applyProfile, matchPrefsForMode, pickFilters, pickProfile, PROFILE_KEYS, FILTER_KEYS } from './preferences.ts';
import { ageRangeFromPrefs, queueMatchFields } from '../services/liveMatchService.ts';

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

test('a Quick search skips the taste filters but still honours a switched-on age range, and leaves the saved Custom filters intact', () => {
  const quick = matchPrefsForMode(full, 'quick');
  assert.equal(quick.intention, 'open');
  assert.deepEqual(quick.topics, []);
  assert.equal(quick.applyAgeFilter, true, 'a saved age range is not dropped by Quick');
  assert.deepEqual(ageRangeFromPrefs(quick), { ageMin: 24, ageMax: 32 });
  assert.equal(ageRangeFromPrefs(matchPrefsForMode({ ...full, applyAgeFilter: false }, 'quick')), null, 'switched off stays off');
  assert.equal(quick.applyLocationFilter, false);
  assert.equal(quick.applyGenderExpressionFilter, false);
  // The input is not modified, so switching back to Custom finds everything still set.
  assert.equal(full.intention, 'dating');
  assert.deepEqual(full.topics, ['Books', 'Coffee']);
  assert.equal(matchPrefsForMode(full, 'custom'), full);

  const fields = queueMatchFields(quick);
  assert.equal(fields.wantAreas, undefined);
  assert.equal(fields.wantExpr, undefined);
  assert.equal('ageMin' in fields, false);
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
  assert.equal('ageMin' in fields, false, 'the age range is private and never in the queue fields');

  const shown = queueMatchFields({ ...full, showGenderExpressionOnProfile: true, showLocationOnProfile: true });
  assert.deepEqual(shown.expr, ['Andro']);
  assert.deepEqual(shown.areas, ['Cebu']);
});

test('a switched-on age range that cannot be used gives no range, which the search screen treats as a stop, never as "no filter"', () => {
  for (const bad of [{ ageMin: 40, ageMax: 20 }, { ageMin: 17, ageMax: 30 }, { ageMin: 25, ageMax: 100 }, { ageMin: undefined, ageMax: 30 }, { ageMin: 25.5, ageMax: 30 }]) {
    const prefs = { ...full, applyAgeFilter: true, ...bad };
    assert.equal(ageRangeFromPrefs(prefs), null, JSON.stringify(bad));
    assert.equal(prefs.applyAgeFilter && !ageRangeFromPrefs(prefs), true, 'the guard in SearchingState stops this search');
    // Quick does not turn the problem into "search without an age filter".
    assert.equal(matchPrefsForMode(prefs, 'quick').applyAgeFilter, true);
  }
});

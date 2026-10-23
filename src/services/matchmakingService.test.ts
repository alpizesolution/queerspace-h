import test from 'node:test';
import assert from 'node:assert/strict';
import { findMatchCandidate } from './matchmakingService.ts';
import { UserPreferences } from '../types.ts';

const testPrefs: UserPreferences = {
  displayName: 'Dahlia Star',
  pronouns: 'she/her',
  intention: 'friendship',
  topics: ['WLW Books & Poetry', 'Plants & Coffee'],
  region: 'National Capital Region (NCR), Metro Manila',
};

test('findMatchCandidate handles unconfigured or cloud query safely without crashing', async () => {
  const result = await findMatchCandidate(testPrefs, ['partner-maya']);

  assert.equal(typeof result.compatibilityScore, 'number');
  assert.equal(typeof result.message, 'string');
  assert.equal(['cloud', 'local_fallback', 'dynamic_fallback'].includes(result.source), true);

  if (result.candidate) {
    assert.equal(typeof result.candidate.id, 'string');
    assert.equal(typeof result.candidate.displayName, 'string');
    assert.notEqual(result.candidate.id, 'partner-maya');
  }
});

test('findMatchCandidate never exposes private SOGIE on candidate profile when candidate exists', async () => {
  const result = await findMatchCandidate(testPrefs);

  if (result.candidate) {
    assert.equal(result.candidate.showSogieOnProfile, false);
    assert.equal(typeof result.candidate.displayName, 'string');
    assert.equal(typeof result.candidate.pronouns, 'string');
    assert.equal(typeof result.candidate.region, 'string');
  }
});

test('findMatchCandidate excludes active partner and blocked IDs when candidate exists', async () => {
  const excludeSet = ['partner-maya', 'partner-clover', 'partner-rowan'];
  const result = await findMatchCandidate(testPrefs, excludeSet);

  if (result.candidate) {
    assert.equal(excludeSet.includes(result.candidate.id), false);
  }
});

test('findMatchCandidate output explicitly identifies candidate source for UI transparency', async () => {
  const result = await findMatchCandidate(testPrefs);

  assert.equal(['cloud', 'local_fallback', 'dynamic_fallback'].includes(result.source), true);
  assert.equal(typeof result.message, 'string');
  assert.ok(result.message.length > 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatFadesIn,
  isUnsaidVisible,
  needsCrisisSupport,
  toUnsaidKind,
  UNSAID_MAX_LENGTH,
  UnsaidPost,
  validateUnsaidText,
} from './unsaidService.ts';

test('validateUnsaidText accepts plain feelings and trims them', () => {
  assert.deepEqual(validateUnsaidText('  I miss her more than I admit  '), {
    ok: true,
    text: 'I miss her more than I admit',
  });
});

test('validateUnsaidText rejects empty, too long and identifying text', () => {
  assert.equal(validateUnsaidText('   ').ok, false);
  assert.equal(validateUnsaidText('a'.repeat(UNSAID_MAX_LENGTH + 1)).ok, false);
  assert.equal(validateUnsaidText('dm me @sapphic.girl').ok, false);
  assert.equal(validateUnsaidText('text me 0917 123 4567').ok, false);
  assert.equal(validateUnsaidText('see https://example.com').ok, false);
});

test('needsCrisisSupport catches English and Tagalog crisis phrases', () => {
  assert.equal(needsCrisisSupport('sometimes I want to die'), true);
  assert.equal(needsCrisisSupport('gusto ko nang magpakamatay'), true);
  assert.equal(needsCrisisSupport('I have been hurting myself again'), true);
  assert.equal(needsCrisisSupport('I came out to my mom today'), false);
});

test('isUnsaidVisible hides faded and heavily flagged posts', () => {
  const now = 1_000_000;
  const post: UnsaidPost = { id: 'a', kind: 'vent', text: 't', createdAt: now, expiresAt: now + 1000, hugs: 0, same: 0, felt: 0, strong: 0, proud: 0, flags: 0 };
  assert.equal(isUnsaidVisible(post, now), true);
  assert.equal(isUnsaidVisible({ ...post, expiresAt: now - 1 }, now), false);
  assert.equal(isUnsaidVisible({ ...post, flags: 3 }, now), false);
});

test('formatFadesIn shows hours, then minutes', () => {
  const now = 0;
  assert.equal(formatFadesIn(31 * 3_600_000 + 5, now), 'Fades in 31h');
  assert.equal(formatFadesIn(12 * 60_000, now), 'Fades in 12m');
  assert.equal(formatFadesIn(10, now), 'Fades in 1m');
});

test('toUnsaidKind falls back to vent for unknown values', () => {
  assert.equal(toUnsaidKind('confession'), 'confession');
  assert.equal(toUnsaidKind('vent'), 'vent');
  assert.equal(toUnsaidKind(undefined), 'vent');
});

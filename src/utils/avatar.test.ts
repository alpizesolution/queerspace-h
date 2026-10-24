import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AVATAR_ANIMALS,
  avatarFromSeed,
  isValidAvatar,
  parseAvatar,
  randomAvatar,
  resolveAvatar,
} from './avatar.ts';

test('avatarFromSeed is stable and always valid', () => {
  assert.equal(avatarFromSeed('uid-123'), avatarFromSeed('uid-123'));
  for (const seed of ['', 'a', 'Willow Lark', 'xY9kLmN0pQ', '🐱']) {
    assert.equal(isValidAvatar(avatarFromSeed(seed)), true, seed);
  }
});

test('avatarFromSeed spreads seeds across many animals', () => {
  const animals = new Set(Array.from({ length: 200 }, (_, i) => avatarFromSeed(`user-${i}`).split('.')[0]));
  assert.equal(animals.size, AVATAR_ANIMALS.length);
});

test('parseAvatar rejects unknown animals and out-of-range colours', () => {
  assert.notEqual(parseAvatar('cat.0.0'), null);
  assert.equal(parseAvatar('dragon.0.0'), null);
  assert.equal(parseAvatar('panda.1.0'), null);
  assert.equal(parseAvatar('cat.0.99'), null);
  assert.equal(parseAvatar('cat.-1.0'), null);
  assert.equal(parseAvatar(undefined), null);
});

test('randomAvatar returns a valid code that differs from the current one', () => {
  for (let i = 0; i < 50; i++) {
    const current = randomAvatar();
    const next = randomAvatar(current);
    assert.equal(isValidAvatar(next), true);
    assert.notEqual(next, current);
  }
});

test('resolveAvatar prefers the saved code and falls back to the seed', () => {
  assert.equal(resolveAvatar('bunny.1.2', 'seed').animal, 'bunny');
  assert.deepEqual(resolveAvatar('nope', 'seed'), resolveAvatar(undefined, 'seed'));
});

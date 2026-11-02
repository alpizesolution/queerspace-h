import test from 'node:test';
import assert from 'node:assert/strict';
import { toLookingForPost } from './lookingForService.ts';

const stored = (over: Record<string, unknown> = {}) => ({
  authorId: 'u1', authorName: 'Willow', authorPronouns: 'she/her', title: 'Hi', intro: 'About', lookingFor: 'Friends',
  intention: 'friendship', tags: ['Books'], isNsfw: false, contentWarning: null, timestamp: { toMillis: () => 1000 }, ...over,
});

test('a stored post becomes a safe client post', () => {
  const post = toLookingForPost('u1_friendship', stored({ age: 30, seekAgeMin: 25, seekAgeMax: 35, region: 'Cebu City', authorAvatar: 'cat.1.2' }));
  assert.ok(post);
  assert.equal(post.id, 'u1_friendship');
  assert.equal(post.author, 'Willow');
  assert.equal(post.age, 30);
  assert.equal(post.region, 'Cebu City');
  assert.equal(post.timestamp, 1000);
  assert.equal(post.isNsfw, false);
});

test('posts with an unknown intention are dropped instead of shown', () => {
  assert.equal(toLookingForPost('x', stored({ intention: 'hookup' })), null);
  assert.equal(toLookingForPost('x', stored({ intention: undefined })), null);
});

test('malformed values are ignored: bad ages, avatars and warnings never reach the screen', () => {
  const post = toLookingForPost('u1_friendship', stored({ age: 12, seekAgeMin: 'x', seekAgeMax: 200, authorAvatar: '<script>', tags: 'nope', isNsfw: 'yes', contentWarning: 'ignored' }));
  assert.ok(post);
  assert.equal(post.age, undefined);
  assert.equal(post.seekAgeMin, undefined);
  assert.equal(post.seekAgeMax, undefined);
  assert.equal(post.authorAvatar, undefined);
  assert.deepEqual(post.tags, []);
  assert.equal(post.isNsfw, false, 'only a real true marks a post as mature');
  assert.equal(post.contentWarning, null, 'a warning without the flag is dropped');
});

test('the mature flag and warning are read together', () => {
  const post = toLookingForPost('u1_friendship', stored({ isNsfw: true, contentWarning: 'Mature themes' }));
  assert.ok(post);
  assert.equal(post.isNsfw, true);
  assert.equal(post.contentWarning, 'Mature themes');
});

test('private fields that should never be on a public post are not copied', () => {
  const post = toLookingForPost('u1_friendship', stored({ birthDate: '1990-01-01', email: 'a@b.c', exactLocation: 'Somewhere', blockedPartnerIds: ['x'] }));
  assert.ok(post);
  const json = JSON.stringify(post);
  for (const secret of ['1990-01-01', 'a@b.c', 'Somewhere', 'blockedPartnerIds']) assert.equal(json.includes(secret), false, secret);
});

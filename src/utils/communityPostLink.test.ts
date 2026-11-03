import test from 'node:test';
import assert from 'node:assert/strict';
import { isPostId, postIdFromSearch, postLink, postLoadFromError, postVisibleTo } from './communityPostLink.ts';

test('only plausible post ids are accepted, and a link round-trips the id', () => {
  assert.ok(isPostId('aB3dE5gH7jK9mN1pQ3sT'));
  assert.ok(isPostId('post_id-0001'));
  for (const bad of ['', 'short', 'has space in it', '../../etc/passwd', 'x'.repeat(129), null, undefined, 42]) assert.equal(isPostId(bad), false, String(bad));
  const link = postLink('https://queerspace.example', 'aB3dE5gH7jK9mN1pQ3sT');
  assert.equal(link, 'https://queerspace.example/?post=aB3dE5gH7jK9mN1pQ3sT');
  assert.equal(postIdFromSearch(new URL(link).search), 'aB3dE5gH7jK9mN1pQ3sT');
  assert.equal(postIdFromSearch('?post=../../x'), null);
  assert.equal(postIdFromSearch('?post=short'), null);
  assert.equal(postIdFromSearch('?profile=aB3dE5gH7jK9mN1pQ3sT'), null);
  assert.equal(postIdFromSearch(''), null);
});

test('a deleted or unreadable post is "unavailable", and only a real failure can be retried', () => {
  assert.deepEqual(postLoadFromError({ code: 'permission-denied' }), { status: 'unavailable' });
  assert.deepEqual(postLoadFromError({ code: 'firestore/permission-denied' }), { status: 'unavailable' });
  assert.deepEqual(postLoadFromError({ code: 'not-found' }), { status: 'unavailable' });
  assert.deepEqual(postLoadFromError({ code: 'unavailable' }), { status: 'failed' }, 'offline');
  assert.deepEqual(postLoadFromError({ code: 'deadline-exceeded' }), { status: 'failed' });
  assert.deepEqual(postLoadFromError(new Error('boom')), { status: 'failed' });
  assert.deepEqual(postLoadFromError(null), { status: 'failed' });
});

test('a post by someone the viewer blocked is not shown, and any other post is', () => {
  assert.equal(postVisibleTo({ authorId: 'a1' }, ['b2']), true);
  assert.equal(postVisibleTo({ authorId: 'b2' }, ['b2']), false);
  assert.equal(postVisibleTo({ authorId: 'a1' }, []), true);
  assert.equal(postVisibleTo({}, ['b2']), true);
});

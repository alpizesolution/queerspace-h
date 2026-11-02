import test from 'node:test';
import assert from 'node:assert/strict';
import {
  orderRequests,
  pendingCount,
  postReference,
  requestErrorMessage,
  STATUS_LABELS,
  type ConnectionRequest,
} from './connectionRequests.ts';

const request = (over: Partial<ConnectionRequest> = {}): ConnectionRequest => ({
  id: 'r1', status: 'pending', message: 'hi', intention: 'dating', createdAt: '2026-11-03T10:00:00.000Z', respondedAt: null,
  expiresAt: null, conversationId: null, memberId: 'm1',
  partner: { displayName: 'Willow', avatar: null, pronouns: null, about: null },
  post: { status: 'active', title: 'Quiet reader', sensitive: false }, ...over,
});

test('waiting requests come first, then the rest, each newest first', () => {
  const list = [
    request({ id: 'old-accepted', status: 'accepted', createdAt: '2026-11-03T12:00:00.000Z' }),
    request({ id: 'old-pending', createdAt: '2026-11-01T10:00:00.000Z' }),
    request({ id: 'new-pending', createdAt: '2026-11-03T09:00:00.000Z' }),
    request({ id: 'declined', status: 'declined', createdAt: '2026-11-02T10:00:00.000Z' }),
  ];
  assert.deepEqual(orderRequests(list).map((r) => r.id), ['new-pending', 'old-pending', 'old-accepted', 'declined']);
  assert.equal(list[0].id, 'old-accepted', 'the original list is not changed');
  assert.equal(pendingCount(list), 2);
});

test('every status has a label', () => {
  assert.deepEqual(Object.keys(STATUS_LABELS).sort(), ['accepted', 'declined', 'expired', 'pending', 'withdrawn']);
});

test('the post reference shows its title, a paused or removed notice, and never a sensitive title', () => {
  assert.deepEqual(postReference(request(), 'Dating'), { text: '“Quiet reader”', notice: null });
  assert.equal(postReference(request({ post: { status: 'paused', title: 'Quiet reader', sensitive: false } }), 'Dating').notice, 'This post is not taking new requests right now.');
  const removed = postReference(request({ post: { status: 'removed', title: null, sensitive: false } }), 'Dating');
  assert.equal(removed.text, 'Dating post');
  assert.equal(removed.notice, 'This post is no longer available.');
  const sensitive = postReference(request({ post: { status: 'active', title: 'SPICY-TITLE-SECRET', sensitive: true } }), 'Dating');
  assert.equal(sensitive.text, 'Dating post (sensitive)');
  assert.ok(!JSON.stringify(sensitive).includes('SPICY'), 'a sensitive title is never repeated, even if one were sent');
  assert.equal(postReference(request({ post: { status: 'active', title: null, sensitive: false } }), 'Dating').text, 'Dating post');
});

test('error codes become calm sentences, and unknown ones never leak raw text', () => {
  for (const code of ['already_pending', 'post_paused', 'rate_limited', 'daily_limit', 'too_many_pending', 'recently_declined', 'request_not_pending', 'not_allowed']) {
    assert.ok(requestErrorMessage(code).endsWith('.'), code);
    assert.notEqual(requestErrorMessage(code), requestErrorMessage('something-unknown'), code);
  }
  assert.equal(requestErrorMessage('<script>'), 'Something went wrong. Please try again.');
  assert.equal(requestErrorMessage(undefined), 'Something went wrong. Please try again.');
});

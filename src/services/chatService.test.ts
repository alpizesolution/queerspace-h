import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDeterministicConvId,
  startOrCreateConversation,
  sendCloudMessage,
  endCloudConversation,
  submitCloudReport,
} from './chatService.ts';

test('getDeterministicConvId produces identical sorted string regardless of UID order', () => {
  const convId1 = getDeterministicConvId('uid_alice_123', 'uid_bob_456');
  const convId2 = getDeterministicConvId('uid_bob_456', 'uid_alice_123');

  assert.equal(convId1, 'uid_alice_123_uid_bob_456');
  assert.equal(convId1, convId2);
});

test('startOrCreateConversation returns local demo session when cloud is unconfigured/offline', async () => {
  const session = await startOrCreateConversation('partner_maya');

  assert.equal(typeof session.convId, 'string');
  assert.equal(session.isCloud, false);
  assert.equal(session.reused, false);
  assert.equal(session.participants.includes('partner_maya'), true);
});

test('sendCloudMessage rejects empty message and messages over 1000 characters', async () => {
  const emptyRes = await sendCloudMessage('conv_123', '   ');
  assert.equal(emptyRes.success, false);
  assert.equal(typeof emptyRes.error, 'string');

  const longText = 'A'.repeat(1005);
  const longRes = await sendCloudMessage('conv_123', longText);
  assert.equal(longRes.success, false);
  assert.equal(typeof longRes.error, 'string');
});

test('sendCloudMessage handles offline/unconfigured environment cleanly', async () => {
  const res = await sendCloudMessage('conv_123', 'Hello sapphic friend!');
  assert.equal(res.success, false);
  assert.equal(typeof res.error, 'string');
});

test('endCloudConversation and submitCloudReport handle offline state without throwing', async () => {
  const endRes = await endCloudConversation('conv_123', 'ended');
  assert.equal(endRes, false);

  const reportRes = await submitCloudReport('user_target_999', 'user', 'Harassment');
  assert.equal(reportRes, false);
});

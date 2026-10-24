import test from 'node:test';
import assert from 'node:assert/strict';
import { chatEventManager } from './chat-events.ts';
import { PartnerStatus } from '../types.ts';

test('chatEventManager notifies subscribers when partner status changes to typing', () => {
  chatEventManager.clear();
  const partnerId = 'partner-test-1';
  const receivedStatuses: PartnerStatus[] = [];

  const unsubscribe = chatEventManager.subscribeToPartnerStatus(partnerId, (status) => {
    receivedStatuses.push(status);
  });

  // Initial status is online
  assert.equal(receivedStatuses[0], 'online');

  // Emit typing status
  chatEventManager.emitPartnerStatus(partnerId, 'typing');
  assert.equal(receivedStatuses[1], 'typing');
  assert.equal(chatEventManager.getStatus(partnerId), 'typing');

  // Emit online status
  chatEventManager.emitPartnerStatus(partnerId, 'online');
  assert.equal(receivedStatuses[2], 'online');
  assert.equal(chatEventManager.getStatus(partnerId), 'online');

  unsubscribe();

  // Emitting after unsubscribe should not notify
  chatEventManager.emitPartnerStatus(partnerId, 'typing');
  assert.equal(receivedStatuses.length, 3);
});

test('simulateTypingBurst switches to typing and then automatically reverts to online', async () => {
  chatEventManager.clear();
  const partnerId = 'partner-test-2';
  const receivedStatuses: PartnerStatus[] = [];

  const unsubscribe = chatEventManager.subscribeToPartnerStatus(partnerId, (status) => {
    receivedStatuses.push(status);
  });

  await new Promise<void>((resolve) => {
    chatEventManager.simulateTypingBurst(partnerId, 150, () => {
      resolve();
    });
  });

  assert.ok(receivedStatuses.includes('typing'));
  assert.equal(chatEventManager.getStatus(partnerId), 'online');
  unsubscribe();
});

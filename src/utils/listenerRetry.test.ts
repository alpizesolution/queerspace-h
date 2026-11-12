import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PERMISSION_RETRIES, MAX_TRANSIENT_RETRIES, RETRY_MAX_MS, classifyListenerError, listenerFailureText, mayRetry, retryDelayMs } from './listenerRetry.ts';

test('a permission refusal is told apart from a temporary failure', () => {
  assert.equal(classifyListenerError({ code: 'permission-denied' }), 'permission');
  assert.equal(classifyListenerError({ code: 'firestore/permission-denied' }), 'permission');
  assert.equal(classifyListenerError({ code: 'unauthenticated' }), 'permission');
  for (const code of ['unavailable', 'deadline-exceeded', 'network-request-failed', 'resource-exhausted', 'internal', undefined]) {
    assert.equal(classifyListenerError({ code }), 'transient', String(code));
  }
  assert.equal(classifyListenerError(null), 'transient');
  assert.equal(classifyListenerError(new Error('boom')), 'transient');
});

test('the wait grows 1s, 2s, 4s, 8s, 16s and never passes 30s', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(retryDelayMs), [1000, 2000, 4000, 8000, 16000]);
  assert.equal(retryDelayMs(5), 30_000);
  assert.equal(retryDelayMs(50), RETRY_MAX_MS);
  assert.equal(retryDelayMs(-3), 1000);
});

test('retries are bounded: five for a temporary failure, one for a refusal, never endless', () => {
  assert.equal(MAX_TRANSIENT_RETRIES, 5);
  assert.equal(MAX_PERMISSION_RETRIES, 1);
  let tries = 0;
  while (mayRetry('transient', tries)) tries += 1;
  assert.equal(tries, 5);
  tries = 0;
  while (mayRetry('permission', tries)) tries += 1;
  assert.equal(tries, 1);
});

test('the words for a failure say what to do and differ for a refusal', () => {
  assert.match(listenerFailureText('transient'), /connection/i);
  assert.match(listenerFailureText('transient'), /Retry/);
  assert.match(listenerFailureText('permission'), /session/i);
  assert.notEqual(listenerFailureText('permission'), listenerFailureText('transient'));
});

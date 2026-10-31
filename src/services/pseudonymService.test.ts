import test from 'node:test';
import assert from 'node:assert/strict';
import { reservePseudonym, suggestPseudonym } from './pseudonymService.ts';

const reply = (status: number, body: unknown = {}) => async () => ({ status, json: async () => body });

test('a reserved name is returned, and whether it replaced the one asked for', async () => {
  const sent: Record<string, unknown>[] = [];
  const send = async (body: Record<string, unknown>) => { sent.push(body); return { status: 200, json: async () => ({ name: 'VelvetMuse', replaced: false }) }; };
  assert.deepEqual(await reservePseudonym('VelvetMuse', {}, send), { status: 'reserved', name: 'VelvetMuse', replaced: false });
  assert.deepEqual(sent[0], { action: 'reserve', names: ['VelvetMuse'], allowSuffix: false });
});

test('a typed name is sent alone and never numbered; a taken one is reported as taken', async () => {
  assert.deepEqual(await reservePseudonym('VelvetMuse', {}, reply(409, { error: 'name_taken' })), { status: 'taken' });
});

test('an app-made name comes with fresh fallbacks and permission to be numbered', async () => {
  const sent: Record<string, unknown>[] = [];
  const send = async (body: Record<string, unknown>) => { sent.push(body); return { status: 200, json: async () => ({ name: 'DreamyFox', replaced: true }) }; };
  const outcome = await reservePseudonym('VelvetMuse', { generated: true }, send);
  assert.deepEqual(outcome, { status: 'reserved', name: 'DreamyFox', replaced: true });
  const names = sent[0].names as string[];
  assert.equal(names[0], 'VelvetMuse');
  assert.ok(names.length > 1 && names.length <= 12);
  assert.equal(sent[0].allowSuffix, true);
});

test('a server error, a network failure or a malformed reply is reported as unavailable (the caller must not save)', async () => {
  assert.deepEqual(await reservePseudonym('VelvetMuse', {}, reply(500)), { status: 'unavailable' });
  assert.deepEqual(await reservePseudonym('VelvetMuse', {}, reply(429)), { status: 'unavailable' });
  assert.deepEqual(await reservePseudonym('VelvetMuse', {}, reply(200, { nope: true })), { status: 'unavailable' });
  assert.deepEqual(await reservePseudonym('VelvetMuse', {}, async () => { throw new Error('offline'); }), { status: 'unavailable' });
});

test('suggest uses the server pick, and falls back to a local name when offline', async () => {
  assert.equal(await suggestPseudonym(reply(200, { name: 'ChaoticCupid' })), 'ChaoticCupid');
  assert.match(await suggestPseudonym(reply(200, { name: null })), /^[A-Za-z]+$/);
  assert.match(await suggestPseudonym(async () => { throw new Error('offline'); }), /^[A-Za-z]+$/);
});

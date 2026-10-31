import test from 'node:test';
import assert from 'node:assert/strict';
import { createNameGate, TAKEN_MESSAGE, UNAVAILABLE_MESSAGE } from './pseudonymGate.ts';
import { ReserveOutcome } from './pseudonymService.ts';

const gateWith = (outcomes: ReserveOutcome[]) => {
  const calls: { name: string; generated: boolean }[] = [];
  const gate = createNameGate(async (name, options) => { calls.push({ name, generated: options.generated }); return outcomes.shift() ?? { status: 'unavailable' }; });
  return { gate, calls };
};

test('a name is only let through once the server has confirmed it', async () => {
  const { gate, calls } = gateWith([{ status: 'reserved', name: 'VelvetMuse', replaced: false }]);
  assert.deepEqual(await gate.ensure('VelvetMuse', false), { ok: true, name: 'VelvetMuse', replaced: false });
  assert.equal(gate.held(), 'VelvetMuse');
  assert.equal(calls.length, 1);
});

test('when the reservation service is unavailable nothing is let through, and a retry asks again', async () => {
  const { gate, calls } = gateWith([{ status: 'unavailable' }, { status: 'reserved', name: 'VelvetMuse', replaced: false }]);
  const failed = await gate.ensure('VelvetMuse', true);
  assert.deepEqual(failed, { ok: false, reason: 'unavailable', message: UNAVAILABLE_MESSAGE });
  assert.equal(gate.held(), null);
  assert.equal((await gate.ensure('VelvetMuse', true)).ok, true);
  assert.equal(calls.length, 2);
});

test('a taken name is refused with a message and nothing is held', async () => {
  const { gate } = gateWith([{ status: 'taken' }]);
  assert.deepEqual(await gate.ensure('VelvetMuse', false), { ok: false, reason: 'taken', message: TAKEN_MESSAGE });
  assert.equal(gate.held(), null);
});

test('a generated name that was taken comes back replaced', async () => {
  const { gate, calls } = gateWith([{ status: 'reserved', name: 'DreamyFox', replaced: true }]);
  assert.deepEqual(await gate.ensure('VelvetMuse', true), { ok: true, name: 'DreamyFox', replaced: true });
  assert.equal(calls[0].generated, true);
});

test('an existing, unchanged pseudonym is not reserved again, but a changed one is', async () => {
  const { gate, calls } = gateWith([{ status: 'reserved', name: 'NewName', replaced: false }]);
  gate.markHeld('Lavender Lark');
  assert.equal((await gate.ensure('Lavender Lark', false)).ok, true);
  assert.equal(calls.length, 0);
  assert.equal((await gate.ensure('NewName', false)).ok, true);
  assert.equal(calls.length, 1);
  // The old name is no longer the held one.
  assert.equal(gate.held(), 'NewName');
});

test('a failed change leaves the previously held name in place', async () => {
  const { gate } = gateWith([{ status: 'taken' }]);
  gate.markHeld('Lavender Lark');
  assert.equal((await gate.ensure('Taken Name', false)).ok, false);
  assert.equal(gate.held(), 'Lavender Lark');
});

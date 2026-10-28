import test from 'node:test';
import assert from 'node:assert/strict';
import { computePickerPlacement } from './pickerPlacement.ts';

const bounds = { top: 100, bottom: 700, left: 0, right: 360 };
const picker = { width: 220, height: 44 };

test('picker sits above a message with room, aligned to the bubble side', () => {
  const p = computePickerPlacement({ top: 300, bottom: 340, left: 50, right: 200 }, picker, bounds, false);
  assert.deepEqual(p, { below: false, shiftX: 0 });
});

test('picker flips below a message near the top of the chat', () => {
  assert.equal(computePickerPlacement({ top: 120, bottom: 160, left: 50, right: 200 }, picker, bounds, false).below, true);
  assert.equal(computePickerPlacement({ top: 150, bottom: 190, left: 50, right: 200 }, picker, bounds, false).below, false);
});

test('picker slides in from the right and left screen edges', () => {
  // Own message hugging the left edge: right-aligned picker would start at -20.
  const left = computePickerPlacement({ top: 300, bottom: 340, left: 4, right: 200 }, picker, bounds, true);
  assert.equal(200 - 220 + left.shiftX, 8);
  // Received message near the right edge: left-aligned picker would end at 400.
  const right = computePickerPlacement({ top: 300, bottom: 340, left: 180, right: 350 }, picker, bounds, false);
  assert.equal(180 + right.shiftX + 220, 352);
});

test('a chat area narrower than the picker keeps its start edge visible', () => {
  const p = computePickerPlacement({ top: 300, bottom: 340, left: 20, right: 150 }, picker, { ...bounds, right: 200 }, false);
  assert.equal(20 + p.shiftX, 8);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_PHOTO_TYPES,
  DEFAULT_PHOTO_TIMER,
  MAX_PICKED_BYTES,
  PHOTO_TIMERS,
  SEND_MAX_SIDE,
  fitWithin,
  isCaptureKey,
  isPhotoTimer,
  photoCard,
  pickProblemText,
  pickedFileProblem,
  secondsLeft,
  shouldConceal,
  type PhotoInfo,
} from './timedPhoto.ts';

test('there are exactly three timers, 3 is the default, and nothing else is a timer', () => {
  assert.deepEqual([...PHOTO_TIMERS], [3, 5, 8]);
  assert.equal(DEFAULT_PHOTO_TIMER, 3);
  for (const ok of [3, 5, 8]) assert.equal(isPhotoTimer(ok), true);
  for (const bad of [0, 1, 2, 4, 6, 7, 9, 10, 60, -3, 3.5, '3', null, undefined, NaN]) assert.equal(isPhotoTimer(bad), false, String(bad));
});

const photo = (over: Partial<PhotoInfo> = {}): PhotoInfo => ({ durationSec: 5, status: 'unopened', mine: false, ...over });

test('a received photo is concealed with an "Open photo" action until it is opened, and shows "Photo expired" afterwards', () => {
  assert.deepEqual(photoCard(photo(), 1000, false), { kind: 'openable', label: 'Open photo' });
  assert.deepEqual(photoCard(photo({ status: 'viewing', expiresAt: 5000 }), 4999, false), { kind: 'openable', label: 'Open photo' }, 'still inside its window');
  assert.deepEqual(photoCard(photo({ status: 'viewing', expiresAt: 5000 }), 5000, false), { kind: 'expired', label: 'Photo expired' }, 'the moment time is up');
  assert.deepEqual(photoCard(photo({ status: 'expired' }), 0, false), { kind: 'expired', label: 'Photo expired' });
  assert.deepEqual(photoCard(photo({ status: 'unopened', until: 100 }), 100, false), { kind: 'expired', label: 'Photo expired' }, 'an unopened photo lapses');
  assert.deepEqual(photoCard(photo({ status: 'viewing', expiresAt: 99999 }), 10, true), { kind: 'expired', label: 'Photo expired' }, 'closed on this device: no reopening from the thread');
});

test('the sender sees the timer, then "Opened", then "Photo expired", and never an "Open photo" action', () => {
  assert.deepEqual(photoCard(photo({ mine: true, status: 'sent', durationSec: 8 }), 0, false), { kind: 'sent', label: 'Photo · 8s' });
  assert.deepEqual(photoCard(photo({ mine: true, status: 'opened', expiresAt: 9000 }), 1000, false), { kind: 'opened', label: 'Opened' });
  assert.equal(photoCard(photo({ mine: true, status: 'opened', expiresAt: 9000 }), 9000, false).kind, 'expired');
  assert.equal(photoCard(photo({ mine: true, status: 'expired' }), 0, false).kind, 'expired');
  for (const status of ['sent', 'opened', 'unopened', 'viewing'] as const) assert.notEqual(photoCard(photo({ mine: true, status }), 0, false).kind, 'openable', status);
});

test('the countdown shows whole seconds and never goes below zero', () => {
  assert.equal(secondsLeft(3000), 3);
  assert.equal(secondsLeft(2001), 3);
  assert.equal(secondsLeft(1), 1);
  assert.equal(secondsLeft(0), 0);
  assert.equal(secondsLeft(-500), 0);
});

test('only JPEG, PNG and WebP photos under 20 MB can be chosen; SVG and everything else is refused', () => {
  assert.deepEqual([...ALLOWED_PHOTO_TYPES], ['image/jpeg', 'image/png', 'image/webp']);
  for (const type of ALLOWED_PHOTO_TYPES) assert.equal(pickedFileProblem({ type, size: 1000 }), null, type);
  for (const type of ['image/svg+xml', 'image/gif', 'image/heic', 'application/pdf', 'text/html', 'application/x-msdownload', '']) assert.equal(pickedFileProblem({ type, size: 1000 }), 'type', type);
  assert.equal(pickedFileProblem({ type: 'image/jpeg', size: MAX_PICKED_BYTES + 1 }), 'size');
  assert.equal(pickedFileProblem({ type: 'image/jpeg', size: MAX_PICKED_BYTES }), null);
  assert.equal(pickedFileProblem({ type: 'image/jpeg', size: 0 }), 'empty');
  for (const problem of ['type', 'size', 'empty'] as const) assert.ok(pickProblemText(problem).length > 5);
});

test('a photo is shrunk to at most 1600px on its longest side and never enlarged', () => {
  assert.equal(SEND_MAX_SIDE, 1600);
  assert.deepEqual(fitWithin(4000, 3000), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(3000, 4000), { width: 1200, height: 1600 });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(1, 5000), { width: 1, height: 1600 });
});

test('the picture is hidden when the page is hidden, loses focus, or a screenshot key is pressed', () => {
  assert.equal(shouldConceal({ hidden: false, focused: true, captureKey: false }), false);
  assert.equal(shouldConceal({ hidden: true, focused: true, captureKey: false }), true);
  assert.equal(shouldConceal({ hidden: false, focused: false, captureKey: false }), true);
  assert.equal(shouldConceal({ hidden: false, focused: true, captureKey: true }), true);
  assert.equal(isCaptureKey({ key: 'PrintScreen' }), true);
  assert.equal(isCaptureKey({ key: '4', metaKey: true, shiftKey: true }), true);
  assert.equal(isCaptureKey({ key: 's', metaKey: true, shiftKey: true }), true);
  assert.equal(isCaptureKey({ key: 'a' }), false);
  assert.equal(isCaptureKey({ key: '4' }), false);
});

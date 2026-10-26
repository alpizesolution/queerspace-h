import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createTypingSender, createTypingWatcher, TYPING_TTL_MS } from './typing-indicator.ts';

const setup = () => mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });

test('sender writes once when typing starts, not on every keystroke', () => {
  setup();
  const writes: boolean[] = [];
  const s = createTypingSender((t) => writes.push(t));
  for (let i = 0; i < 20; i++) {
    s.input(true);
    mock.timers.tick(100);
  }
  assert.deepEqual(writes, [true]);
  mock.timers.reset();
});

test('sender clears after about 2 seconds of inactivity', () => {
  setup();
  const writes: boolean[] = [];
  const s = createTypingSender((t) => writes.push(t));
  s.input(true);
  mock.timers.tick(1900);
  assert.deepEqual(writes, [true]);
  mock.timers.tick(200);
  assert.deepEqual(writes, [true, false]);
  mock.timers.reset();
});

test('sender re-stamps at most every 5 seconds while typing continues', () => {
  setup();
  const writes: boolean[] = [];
  const s = createTypingSender((t) => writes.push(t));
  for (let i = 0; i < 30; i++) {
    s.input(true);
    mock.timers.tick(1000);
  }
  // 30s of typing: start + a refresh roughly every 5s, never per keystroke.
  assert.ok(writes.length >= 5 && writes.length <= 7, `writes: ${writes.length}`);
  assert.ok(writes.every(Boolean));
  mock.timers.reset();
});

test('emptying the field clears; reset() forgets without writing (message sent)', () => {
  setup();
  const writes: boolean[] = [];
  const s = createTypingSender((t) => writes.push(t));
  s.input(true);
  s.input(false);
  assert.deepEqual(writes, [true, false]);
  s.input(true);
  s.reset();
  mock.timers.tick(5000);
  assert.deepEqual(writes, [true, false, true]);
  assert.equal(s.isActive(), false);
  mock.timers.reset();
});

test('watcher shows a fresh stamp and expires it locally without further reads', () => {
  setup();
  const seen: boolean[] = [];
  const w = createTypingWatcher((t) => seen.push(t));
  w.update(Date.now());
  assert.deepEqual(seen, [true]);
  w.update(Date.now()); // same doc re-delivered: no reset
  mock.timers.tick(TYPING_TTL_MS + 10);
  assert.deepEqual(seen, [true, false]);
  mock.timers.reset();
});

test('watcher hides on clear, and ignores a stale stamp left from an earlier session', () => {
  setup();
  const seen: boolean[] = [];
  const w = createTypingWatcher((t) => seen.push(t));
  w.update(Date.now() - 60_000);
  assert.deepEqual(seen, []);
  w.update(Date.now());
  w.update(null);
  assert.deepEqual(seen, [true, false]);
  mock.timers.reset();
});

test('a refreshed stamp extends the indicator', () => {
  setup();
  const seen: boolean[] = [];
  const w = createTypingWatcher((t) => seen.push(t));
  w.update(Date.now());
  mock.timers.tick(5000);
  w.update(Date.now());
  mock.timers.tick(5000);
  assert.deepEqual(seen, [true]);
  mock.timers.tick(3000);
  assert.deepEqual(seen, [true, false]);
  mock.timers.reset();
});

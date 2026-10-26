import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { startSearchAttempt } from './search-attempt.ts';
import { isLiveMatchingAvailable, joinLiveMatchQueue } from '../services/liveMatchService.ts';

// joinLiveMatchQueue touches window listeners when leaving; tests run in Node.
(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };

test('regression: matching unavailable reports the error instead of crashing (ticker used before init)', async () => {
  // The old crash surfaced as an unhandled rejection from inside joinLiveMatchQueue's async start.
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);
  process.on('unhandledRejection', onRejection);
  mock.timers.enable({ apis: ['setInterval'] });
  // Under tests Firebase isn't configured, exactly the case that crashed the Seek screen.
  assert.equal(isLiveMatchingAvailable(), false);
  const errors: string[] = [];
  let ticks = 0;
  let timedOut = false;
  let stop: () => void = () => {};
  assert.doesNotThrow(() => {
    stop = startSearchAttempt({
      join: (onError) => joinLiveMatchQueue([], { onMatched: () => {}, onError }, {}),
      windowSeconds: 30,
      onTick: () => ticks++,
      onTimeout: () => (timedOut = true),
      onError: (m) => errors.push(m),
    });
  });
  assert.deepEqual(errors, ["Live matching isn't available right now."]);
  // The failed attempt doesn't keep counting toward a timeout.
  mock.timers.tick(31_000);
  assert.equal(ticks, 0);
  assert.equal(timedOut, false);
  assert.doesNotThrow(() => stop());
  mock.timers.reset();
  await new Promise((resolve) => setImmediate(resolve));
  process.off('unhandledRejection', onRejection);
  assert.deepEqual(rejections, []);
});

test('a synchronous join error is reported once and the queue is still left on cleanup', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  let left = 0;
  const errors: string[] = [];
  const stop = startSearchAttempt({
    join: (onError) => {
      onError('first');
      onError('second');
      return () => left++;
    },
    windowSeconds: 30,
    onTick: () => {},
    onTimeout: () => {},
    onError: (m) => errors.push(m),
  });
  assert.deepEqual(errors, ['first']);
  stop();
  assert.equal(left, 1);
  mock.timers.reset();
});

test('the attempt ticks, then times out once and leaves the queue', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  const ticks: number[] = [];
  let left = 0;
  let timeouts = 0;
  startSearchAttempt({
    join: () => () => left++,
    windowSeconds: 3,
    onTick: (s) => ticks.push(s),
    onTimeout: () => timeouts++,
    onError: () => {},
  });
  mock.timers.tick(10_000);
  assert.deepEqual(ticks, [1, 2, 3]);
  assert.equal(timeouts, 1);
  assert.equal(left, 1);
  mock.timers.reset();
});

test('an async error stops the timer; nothing fires after cleanup (unmount or cancel)', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  let report: (m: string) => void = () => {};
  const errors: string[] = [];
  let ticks = 0;
  const stop = startSearchAttempt({
    join: (onError) => {
      report = onError;
      return () => {};
    },
    windowSeconds: 30,
    onTick: () => ticks++,
    onTimeout: () => {},
    onError: (m) => errors.push(m),
  });
  mock.timers.tick(2000);
  report('lost connection');
  mock.timers.tick(5000);
  assert.equal(ticks, 2);
  assert.deepEqual(errors, ['lost connection']);

  // After cleanup, late callbacks from the queue are ignored.
  const errors2: string[] = [];
  let report2: (m: string) => void = () => {};
  const stop2 = startSearchAttempt({
    join: (onError) => {
      report2 = onError;
      return () => {};
    },
    windowSeconds: 30,
    onTick: () => {},
    onTimeout: () => {},
    onError: (m) => errors2.push(m),
  });
  stop2();
  report2('too late');
  assert.deepEqual(errors2, []);
  stop();
  mock.timers.reset();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { whileActive, type ActivityEnv } from './whileActive.ts';

function fakeEnv() {
  let now = 0;
  let hidden = false;
  let tick: () => void = () => {};
  let activity: () => void = () => {};
  const env: ActivityEnv = {
    now: () => now,
    isHidden: () => hidden,
    every: (fn) => {
      tick = fn;
      return () => (tick = () => {});
    },
    onActivity: (fn) => {
      activity = fn;
      return () => (activity = () => {});
    },
  };
  return {
    env,
    advance(ms: number) {
      now += ms;
      tick();
    },
    setHidden(value: boolean) {
      hidden = value;
      activity();
    },
    touch: () => activity(),
  };
}

function listener() {
  const state = { opens: 0, closes: 0 };
  const open = () => {
    state.opens += 1;
    return () => (state.closes += 1);
  };
  return { state, open };
}

test('keeps listening while the person is active', () => {
  const f = fakeEnv();
  const l = listener();
  whileActive(l.open, 1000, f.env);
  f.advance(600);
  f.touch();
  f.advance(600);
  assert.deepEqual(l.state, { opens: 1, closes: 0 });
});

test('pauses after the idle time and resumes on the next interaction', () => {
  const f = fakeEnv();
  const l = listener();
  whileActive(l.open, 1000, f.env);
  f.advance(1000);
  assert.deepEqual(l.state, { opens: 1, closes: 1 });
  f.advance(5000);
  assert.equal(l.state.closes, 1, 'does not close twice');
  f.touch();
  assert.deepEqual(l.state, { opens: 2, closes: 1 });
});

test('a hidden tab pauses, and coming back resumes', () => {
  const f = fakeEnv();
  const l = listener();
  whileActive(l.open, 1000, f.env);
  f.setHidden(true);
  f.advance(1000);
  assert.equal(l.state.closes, 1);
  f.touch(); // events while hidden don't count
  assert.equal(l.state.opens, 1);
  f.setHidden(false);
  assert.equal(l.state.opens, 2);
});

test('cleanup closes the listener once and stops watching', () => {
  const f = fakeEnv();
  const l = listener();
  const stop = whileActive(l.open, 1000, f.env);
  stop();
  f.advance(5000);
  f.touch();
  assert.deepEqual(l.state, { opens: 1, closes: 1 });
});

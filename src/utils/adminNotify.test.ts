import test from 'node:test';
import assert from 'node:assert/strict';
import { adminSoundEnabled, playAdminChime, toastCopy } from './adminNotify.ts';

test('the chime is off by default and only plays when switched on', () => {
  assert.equal(adminSoundEnabled(), false); // no localStorage here: the safe default is off
  let plays = 0;
  assert.equal(playAdminChime(false, () => { plays += 1; }), false);
  assert.equal(plays, 0);
  assert.equal(playAdminChime(true, () => { plays += 1; }), true);
  assert.equal(plays, 1);
});

test('a blocked or failing audio context never throws', () => {
  assert.equal(playAdminChime(true, () => { throw new Error('NotAllowedError'); }), false);
});

test('toasts say what arrived, never what it said', () => {
  const suggestion = toastCopy('suggestion');
  const report = toastCopy('report');
  assert.equal(suggestion.title, 'New Suggestion');
  assert.equal(report.title, 'New Report');
  assert.match(report.body, /requiring attention/);
  // The helper takes only the kind, so it cannot include a submission's text, a member's name or an id.
  assert.equal(toastCopy.length, 1);
});

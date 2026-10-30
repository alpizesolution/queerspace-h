import test from 'node:test';
import assert from 'node:assert/strict';
import { newArrivalTracker, pickArrivals, toReportStatus, toSuggestionStatus } from './adminInboxService.ts';

const item = (id: string, createdAt: number, status = 'open') => ({ id, createdAt, status });
const pending = (i: { status: string }) => i.status === 'open';

test('a missing status is New/Open and the old "done" maps to Reviewed / Resolved', () => {
  assert.equal(toSuggestionStatus(undefined), 'open');
  assert.equal(toSuggestionStatus('done'), 'reviewed');
  assert.equal(toSuggestionStatus('in_progress'), 'in_progress');
  assert.equal(toSuggestionStatus('nonsense'), 'open');
  assert.equal(toReportStatus(undefined), 'open');
  assert.equal(toReportStatus('done'), 'resolved');
  assert.equal(toReportStatus('reviewing'), 'reviewing');
  assert.equal(toReportStatus('in_progress'), 'open'); // a suggestion status is not a report status
});

test('what is already there when the panel opens is never announced', () => {
  const t = newArrivalTracker();
  assert.deepEqual(pickArrivals(t, [item('a', 100), item('b', 200), item('c', 300)], pending), []);
});

test('a later submission is announced once, and only once', () => {
  const t = newArrivalTracker();
  pickArrivals(t, [item('a', 100), item('b', 200)], pending);
  assert.deepEqual(pickArrivals(t, [item('c', 300)], pending).map((i) => i.id), ['c']);
  assert.deepEqual(pickArrivals(t, [item('c', 300)], pending), []); // the same event again (re-subscribe, reconnect)
});

test('reconnecting replays the window without announcing old submissions, but does announce ones missed while offline', () => {
  const t = newArrivalTracker();
  pickArrivals(t, [item('a', 100), item('b', 200)], pending);
  // The listener restarts and sends the whole window again, plus one new item that arrived while offline.
  const replay = pickArrivals(t, [item('a', 100), item('b', 200), item('n', 400)], pending);
  assert.deepEqual(replay.map((i) => i.id), ['n']);
});

test('an older item sliding into the window (a newer one was deleted) is not an arrival', () => {
  const t = newArrivalTracker();
  pickArrivals(t, [item('new', 500), item('mid', 300)], pending);
  assert.deepEqual(pickArrivals(t, [item('old', 50)], pending), []);
});

test('items that are no longer pending are not announced', () => {
  const t = newArrivalTracker();
  pickArrivals(t, [item('a', 100)], pending);
  assert.deepEqual(pickArrivals(t, [item('b', 300, 'resolved')], pending), []);
});

test('a status change on an existing item is not an arrival', () => {
  const t = newArrivalTracker();
  pickArrivals(t, [item('a', 100)], pending);
  // A 'modified' change is not passed in at all; even if it were, the id is already seen.
  assert.deepEqual(pickArrivals(t, [item('a', 100, 'reviewing')], pending), []);
});

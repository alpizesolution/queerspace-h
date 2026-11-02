import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRelativeTime } from './relativeTime.ts';

const NOW = new Date(2026, 10, 3, 12, 0, 0).getTime();
const ago = (ms: number) => NOW - ms;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('recent posts read as now, minutes and hours', () => {
  assert.equal(formatRelativeTime(ago(0), NOW), 'now');
  assert.equal(formatRelativeTime(ago(59_000), NOW), 'now');
  assert.equal(formatRelativeTime(ago(MIN), NOW), '1m');
  assert.equal(formatRelativeTime(ago(59 * MIN), NOW), '59m');
  assert.equal(formatRelativeTime(ago(HOUR), NOW), '1h');
  assert.equal(formatRelativeTime(ago(23 * HOUR + 59 * MIN), NOW), '23h');
});

test('the last week reads in days, then the date', () => {
  assert.equal(formatRelativeTime(ago(DAY), NOW), '1d');
  assert.equal(formatRelativeTime(ago(6 * DAY + 23 * HOUR), NOW), '6d');
  const older = formatRelativeTime(ago(10 * DAY), NOW);
  assert.match(older, /Oct/);
  assert.doesNotMatch(older, /2026/);
  assert.match(formatRelativeTime(new Date(2025, 11, 30).getTime(), NOW), /2025/);
});

test('a clock slightly ahead of the server never shows a negative or odd time', () => {
  assert.equal(formatRelativeTime(NOW + 5 * MIN, NOW), 'now');
});

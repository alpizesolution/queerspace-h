import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GROWTH_DAYS, bucketCreations, manilaDate } from './admin-growth.js';

test('days follow Philippine time', () => {
  assert.equal(manilaDate(Date.UTC(2026, 9, 30, 15, 59)), '2026-10-30');
  assert.equal(manilaDate(Date.UTC(2026, 9, 30, 16, 0)), '2026-10-31');
});

test('accounts are counted per Manila day over the last 90 days, ignoring older and future ones', () => {
  const now = Date.UTC(2026, 9, 30, 4, 0); // 12:00 on the 30th in Manila
  const days = bucketCreations([
    Date.UTC(2026, 9, 30, 1, 0), Date.UTC(2026, 9, 29, 17, 0), // both the 30th in Manila
    Date.UTC(2026, 9, 29, 3, 0),
    Date.UTC(2026, 6, 1, 0, 0), // older than 90 days
  ], now);
  assert.equal(days.length, GROWTH_DAYS);
  assert.equal(days[days.length - 1].date, '2026-10-30');
  assert.equal(days[days.length - 1].count, 2);
  assert.equal(days[days.length - 2].count, 1);
  assert.equal(days.reduce((sum, d) => sum + d.count, 0), 3);
});

test('the endpoint is admin-only, read-only, and returns totals only', () => {
  const source = readFileSync('api/admin-growth.js', 'utf8');
  assert.match(source, /requireAdmin\(db, decoded\)/);
  assert.match(source, /req\.method !== 'GET'/);
  assert.match(source, /no-store/);
  // Nothing identifying is put in the response.
  const body = source.slice(source.indexOf('const body = {'), source.indexOf('cache = {'));
  assert.doesNotMatch(body, /uid|email|displayName|providerData|users\b/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { ANALYTICS_CACHE_MS, clearAnalyticsCache, computeRetention, remember, sumLast } from './adminGrowthService.ts';
import { addDays } from '../utils/acquisition.ts';

test('addDays walks across month and year ends', () => {
  assert.equal(addDays(20261030, 3), 20261102);
  assert.equal(addDays(20261231, 1), 20270101);
  assert.equal(addDays(20260301, -1), 20260228);
});

test('sumLast adds the newest N days', () => {
  const days = [1, 2, 3, 4].map((count, i) => ({ day: i, count }));
  assert.equal(sumLast(days, 2), 7);
  assert.equal(sumLast(days, 10), 10);
});

// Cohort week 20261001-20261007: 10 members start per day (70), 5 of each day's members return on day 7.
const lookups = (calls: string[]) => ({
  cohortSize: async (day: number) => { calls.push(`size ${day}`); return day >= 20261001 && day <= 20261007 ? 10 : 0; },
  retained: async (day: number, n: number) => { calls.push(`kept ${day} +${n}`); return n === 7 ? 5 : n === 1 ? 8 : 2; },
});

test('retention is only worked out once every day of the cohort has lived through the window', async () => {
  // Today is Oct 14: yesterday is Oct 13. Last cohort day Oct 7: day 1 and day 7 (Oct 14) ... Oct 14 is not over yet.
  const calls: string[] = [];
  const rows = await computeRetention(20261001, 20261014, lookups(calls));
  const week1 = rows[0];
  assert.equal(week1.size, 70);
  assert.equal(week1.rates[1], 80); // Oct 8 is over
  assert.equal(week1.rates[7], null); // Oct 14 is today: still open
  assert.equal(week1.rates[14], null);
  assert.equal(week1.rates[30], null);
});

test('a later day completes the 7-day window, and empty or partial cohorts never invent a rate', async () => {
  const rows = await computeRetention(20261001, 20261016, lookups([]));
  assert.equal(rows[0].rates[7], 50);
  const partial = await computeRetention(20261004, 20261008, lookups([]));
  // Oct 4 to Oct 7 is a partial week (only 4 days exist so far): no rates yet.
  assert.deepEqual(Object.values(partial[0].rates), [null, null, null, null]);
  const none = await computeRetention(20261101, 20261120, lookups([]));
  assert.equal(none[0].size, 0);
  assert.equal(none[0].rates[1], null);
});

test('the 5-minute analytics cache serves repeats, refreshes on demand and after expiry, and keeps ranges apart', async () => {
  clearAnalyticsCache();
  const realNow = Date.now;
  let clock = 1_000_000;
  Date.now = () => clock;
  try {
    let loads = 0;
    const load = async () => ++loads;
    assert.equal(await remember('a', false, load), 1);
    assert.equal(await remember('a', false, load), 1);            // cached
    clock += ANALYTICS_CACHE_MS - 1;
    assert.equal(await remember('a', false, load), 1);            // still inside 5 minutes
    assert.equal(await remember('b', false, load), 2);            // another key (another range) loads once
    assert.equal(await remember('a', true, load), 3);             // Refresh forces a reload
    assert.equal(await remember('a', false, load), 3);            // ... and that result is cached again
    clock += ANALYTICS_CACHE_MS;
    assert.equal(await remember('a', false, load), 4);            // expired
    assert.equal(ANALYTICS_CACHE_MS, 5 * 60_000);
  } finally {
    Date.now = realNow;
    clearAnalyticsCache();
  }
});

test('analytics use one-off reads only: no live listeners anywhere in the growth code', async () => {
  const fs = await import('node:fs');
  for (const file of ['src/services/adminGrowthService.ts', 'src/services/activityService.ts', 'src/admin/GrowthPanel.tsx', 'api/admin-growth.js']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /onSnapshot|\.listen\(/, file);
  }
});

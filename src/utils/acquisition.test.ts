import test from 'node:test';
import assert from 'node:assert/strict';
import { activityDayKey, activityDayNumber, normalizeRef, resolveSource, sourceFromReferrer } from './acquisition.ts';

test('activity days follow Philippine time (UTC+8)', () => {
  // 2026-10-30 15:59 UTC is still 23:59 on the 30th in Manila; one minute later it is the 31st.
  assert.equal(activityDayNumber(Date.UTC(2026, 9, 30, 15, 59)), 20261030);
  assert.equal(activityDayNumber(Date.UTC(2026, 9, 30, 16, 0)), 20261031);
  assert.equal(activityDayKey(Date.UTC(2026, 11, 31, 20, 0)), 'd20270101');
});

test('?ref values are normalized to the allowed sources', () => {
  assert.equal(normalizeRef('TikTok'), 'tiktok');
  assert.equal(normalizeRef('fb'), 'facebook');
  assert.equal(normalizeRef(' reddit '), 'reddit');
  assert.equal(normalizeRef('community'), 'referral');
  assert.equal(normalizeRef('some-blog'), 'other');
  assert.equal(normalizeRef(''), null);
  assert.equal(normalizeRef(null), null);
});

test('the referring site is used only when there is no ?ref', () => {
  assert.equal(sourceFromReferrer('https://www.tiktok.com/@x', 'queerspaceph.com'), 'tiktok');
  assert.equal(sourceFromReferrer('https://l.facebook.com/l.php?u=1', 'queerspaceph.com'), 'facebook');
  assert.equal(sourceFromReferrer('https://old.reddit.com/r/lgbt', 'queerspaceph.com'), 'reddit');
  assert.equal(sourceFromReferrer('https://example.org/', 'queerspaceph.com'), 'other');
  assert.equal(sourceFromReferrer('https://www.queerspaceph.com/about', 'www.queerspaceph.com'), null);
  assert.equal(sourceFromReferrer('', 'queerspaceph.com'), null);
  assert.equal(resolveSource('?ref=tiktok', 'https://example.org/', 'queerspaceph.com'), 'tiktok');
  assert.equal(resolveSource('', 'https://example.org/', 'queerspaceph.com'), 'other');
  assert.equal(resolveSource('', '', 'queerspaceph.com'), 'direct');
  assert.equal(resolveSource('?ref=<script>', '', 'queerspaceph.com'), 'other');
});

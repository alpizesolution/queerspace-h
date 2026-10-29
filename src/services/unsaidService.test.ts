import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPostedAgo,
  mergeUnsaidPages,
  toUnsaidPost,
  isUnsaidVisible,
  needsCrisisSupport,
  toUnsaidKind,
  UNSAID_MAX_LENGTH,
  UnsaidPost,
  validateUnsaidText,
} from './unsaidService.ts';

test('validateUnsaidText accepts plain feelings and trims them', () => {
  assert.deepEqual(validateUnsaidText('  I miss her more than I admit  '), {
    ok: true,
    text: 'I miss her more than I admit',
  });
});

test('validateUnsaidText rejects empty, too long and identifying text', () => {
  assert.equal(validateUnsaidText('   ').ok, false);
  assert.equal(validateUnsaidText('a'.repeat(UNSAID_MAX_LENGTH + 1)).ok, false);
  assert.equal(validateUnsaidText('dm me @sapphic.girl').ok, false);
  assert.equal(validateUnsaidText('text me 0917 123 4567').ok, false);
  assert.equal(validateUnsaidText('see https://example.com').ok, false);
});

test('needsCrisisSupport catches English and Tagalog crisis phrases', () => {
  assert.equal(needsCrisisSupport('sometimes I want to die'), true);
  assert.equal(needsCrisisSupport('gusto ko nang magpakamatay'), true);
  assert.equal(needsCrisisSupport('I have been hurting myself again'), true);
  assert.equal(needsCrisisSupport('I came out to my mom today'), false);
});

const HOUR = 3_600_000;
const echo = (over: Partial<UnsaidPost> = {}): UnsaidPost => ({ id: 'a', kind: 'vent', text: 't', createdAt: 0, expiresAt: null, hugs: 0, same: 0, felt: 0, strong: 0, proud: 0, cry: 0, flags: 0, ...over });

test('an Echo older than 48 hours is still visible when it has no expiry', () => {
  const now = 100 * 24 * HOUR;
  assert.equal(isUnsaidVisible(echo({ createdAt: now - 3 * 24 * HOUR }), now), true);
  assert.equal(isUnsaidVisible(echo({ createdAt: now - 90 * 24 * HOUR }), now), true);
});

test('old-style Echoes still fade at their own expiry; heavily flagged ones are hidden', () => {
  const now = 1_000_000;
  assert.equal(isUnsaidVisible(echo({ expiresAt: now + 1000 }), now), true);
  assert.equal(isUnsaidVisible(echo({ expiresAt: now - 1 }), now), false);
  assert.equal(isUnsaidVisible(echo({ flags: 3 }), now), false);
  assert.equal(isUnsaidVisible(echo({ flags: 2 }), now), true);
});

test('feeds are newest first, de-duplicated across the live page and older pages', () => {
  const live = [echo({ id: 'new', createdAt: 300 }), echo({ id: 'mid', createdAt: 200 })];
  const older = [echo({ id: 'mid', createdAt: 200 }), echo({ id: 'oldest', createdAt: 100 })];
  assert.deepEqual(mergeUnsaidPages(older, live).map((p) => p.id), ['new', 'mid', 'oldest']);
  assert.deepEqual(mergeUnsaidPages([], []), []);
});

test('formatPostedAgo gives relative times', () => {
  const now = 1_000 * HOUR;
  assert.equal(formatPostedAgo(now - 20_000, now), 'just now');
  assert.equal(formatPostedAgo(now - 12 * 60_000, now), '12m ago');
  assert.equal(formatPostedAgo(now - 2 * HOUR, now), '2h ago');
  assert.equal(formatPostedAgo(now - 24 * HOUR, now), '1 day ago');
  assert.equal(formatPostedAgo(now - 5 * 24 * HOUR, now), '5 days ago');
  assert.equal(formatPostedAgo(now - 65 * 24 * HOUR, now), '2 months ago');
});

test('the public Echo shape carries no author or owner information', () => {
  const post = toUnsaidPost('x', { kind: 'confession', text: 'hi', createdAt: { toMillis: () => 5 }, authorId: 'secret', ownerId: 'secret', email: 'a@b.c', hugs: 2 });
  assert.deepEqual(Object.keys(post).sort(), ['createdAt', 'cry', 'expiresAt', 'felt', 'flags', 'hugs', 'id', 'kind', 'proud', 'same', 'strong', 'text']);
  assert.equal(post.expiresAt, null);
  assert.equal(JSON.stringify(post).includes('secret'), false);
});

test('new Echoes are written without an expiry, and nothing deletes them on a schedule', async () => {
  const fs = await import('node:fs');
  const service = fs.readFileSync('src/services/unsaidService.ts', 'utf8');
  assert.equal(/expiresAt:\s*Timestamp\.fromMillis/.test(service), false, 'postUnsaid must not set an expiry');
  assert.equal(/where\('expiresAt'/.test(service), false, 'the feed must not filter on expiresAt');
  assert.equal(fs.existsSync('functions'), false, 'no scheduled cleanup functions');
  assert.equal(/cron/i.test(fs.readFileSync('vercel.json', 'utf8')), false, 'no cron jobs');
  const indexes = JSON.parse(fs.readFileSync('firestore.indexes.json', 'utf8'));
  assert.equal(JSON.stringify(indexes).includes('unsaid'), false);
});

test('toUnsaidKind falls back to vent for unknown values', () => {
  assert.equal(toUnsaidKind('confession'), 'confession');
  assert.equal(toUnsaidKind('vent'), 'vent');
  assert.equal(toUnsaidKind(undefined), 'vent');
});

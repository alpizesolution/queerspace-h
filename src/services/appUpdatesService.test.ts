import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase/firestore';
import {
  APP_UPDATE_BODY_MAX,
  APP_UPDATE_TITLE_MAX,
  categoryLabel,
  normalizeAppUpdateLink,
  toAppUpdate,
  unreadUpdateIds,
  validateAppUpdate,
} from './appUpdatesService.ts';

const input = (over: Record<string, string> = {}) => ({ title: 'Dark mode', body: 'It is here.', category: 'feature', ...over });
const snap = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });

test('validateAppUpdate trims text and accepts a minimal update', () => {
  const r = validateAppUpdate(input({ title: '  Dark mode  ', body: ' Now in Settings. ' }));
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.value, { title: 'Dark mode', body: 'Now in Settings.', category: 'feature', link: null });
});

test('validateAppUpdate rejects bad titles, bodies and categories', () => {
  assert.equal(validateAppUpdate(input({ title: 'hi' })).ok, false);
  assert.equal(validateAppUpdate(input({ title: 'x'.repeat(APP_UPDATE_TITLE_MAX + 1) })).ok, false);
  assert.equal(validateAppUpdate(input({ body: '   ' })).ok, false);
  assert.equal(validateAppUpdate(input({ body: 'x'.repeat(APP_UPDATE_BODY_MAX + 1) })).ok, false);
  assert.equal(validateAppUpdate(input({ category: 'spam' })).ok, false);
});

test('links must be https with a label, both or neither', () => {
  assert.equal(normalizeAppUpdateLink('', ''), null);
  assert.deepEqual(normalizeAppUpdateLink(' https://example.com/a ', ' Read more '), { url: 'https://example.com/a', label: 'Read more' });
  for (const bad of ['http://example.com', 'javascript:alert(1)', 'data:text/html,hi', 'example.com', 'https://a b.com', '//x.com']) {
    assert.equal(normalizeAppUpdateLink(bad, 'Go'), 'invalid', bad);
  }
  assert.equal(normalizeAppUpdateLink('https://example.com', ''), 'invalid');
  assert.equal(normalizeAppUpdateLink('', 'Go'), 'invalid');
  assert.equal(validateAppUpdate(input({ linkUrl: 'http://x.com', linkLabel: 'Go' })).ok, false);
});

test('markup in text is kept as text (it is rendered as plain text, never as HTML)', () => {
  const r = validateAppUpdate(input({ title: '<b>Hi</b> there' }));
  assert.ok(r.ok && r.value.title === '<b>Hi</b> there');
});

test('unreadUpdateIds only counts published updates the member has not opened', () => {
  const list = [
    { id: 'a', status: 'published' as const },
    { id: 'b', status: 'published' as const },
    { id: 'c', status: 'draft' as const },
  ];
  assert.deepEqual(unreadUpdateIds(list, new Set()), ['a', 'b']);
  assert.deepEqual(unreadUpdateIds(list, new Set(['a'])), ['b']);
  assert.deepEqual(unreadUpdateIds(list, new Set(['a', 'b'])), []);
  assert.deepEqual(unreadUpdateIds([], new Set()), []);
  // A newly published update brings the indicator back.
  assert.deepEqual(unreadUpdateIds([...list, { id: 'd', status: 'published' as const }], new Set(['a', 'b'])), ['d']);
});

test('toAppUpdate maps a document and skips malformed ones', () => {
  const t = Timestamp.fromMillis(1_700_000_000_000);
  const ok = toAppUpdate(snap('u1', {
    title: 'T', body: 'B', category: 'fix', status: 'published', createdAt: t, updatedAt: t, publishedAt: t,
    link: { url: 'https://x.com', label: 'X' },
  }));
  assert.equal(ok?.publishedAt, 1_700_000_000_000);
  assert.deepEqual(ok?.link, { url: 'https://x.com', label: 'X' });
  assert.equal(toAppUpdate(snap('u2', { title: 'T', body: 'B', category: 'nope', status: 'published' })), null);
  assert.equal(toAppUpdate(snap('u3', { title: 5, body: 'B', category: 'fix', status: 'draft' })), null);
});

test('categoryLabel names each category', () => {
  assert.equal(categoryLabel('feature'), 'New Feature');
  assert.equal(categoryLabel('announcement'), 'Community Announcement');
  assert.equal(categoryLabel('???'), 'Update');
});

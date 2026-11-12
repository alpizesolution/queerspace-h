import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMON_EMOJI,
  VIBE_MESSAGE_MAX,
  VIBE_TTL_HOURS,
  VIBE_VISIBILITY_OPTIONS,
  expiresIn,
  hasContent,
  isLive,
  manilaDateTime,
  messageLength,
  messageProblem,
  parseVibe,
  tidyMessage,
  updatedAgo,
  vibeAccessibleSummary,
  vibeTimes,
  visibilityLabel,
} from './currentVibe.ts';
import * as server from '../../api/_vibe.js';
import { parseProfileResponse } from './profileView.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.parse('2026-11-12T12:00:00.000Z');
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

test('the quick-pick emoji are all single emoji the server accepts, with no repeats', () => {
  assert.ok(COMMON_EMOJI.length >= 24 && COMMON_EMOJI.length <= 48, 'a compact set');
  assert.equal(new Set(COMMON_EMOJI).size, COMMON_EMOJI.length);
  for (const emoji of COMMON_EMOJI) assert.equal(server.isSingleEmoji(emoji), true, emoji);
});

test('the limits and visibility choices agree between the app and the server', () => {
  assert.equal(server.VIBE_MESSAGE_MAX, VIBE_MESSAGE_MAX);
  assert.equal(VIBE_MESSAGE_MAX, 60);
  assert.equal(server.VIBE_TTL_MS, VIBE_TTL_HOURS * HOUR);
  assert.deepEqual(server.VIBE_VISIBILITIES, VIBE_VISIBILITY_OPTIONS.map((o) => o.id));
  for (const text of ['', 'hi', 'x'.repeat(60), 'x'.repeat(61), '🌱'.repeat(60), '🌱'.repeat(61), 'bell\u0007']) {
    assert.equal(messageProblem(text) === null, server.parseVibeInput({ emoji: '🌙', message: text }).ok, JSON.stringify(text));
  }
});

test('the message is optional, tidied to one line, and limited to 60 characters with an emoji counting as one', () => {
  assert.equal(messageProblem(''), null);
  assert.equal(messageProblem('   '), null);
  assert.equal(messageProblem('x'.repeat(60)), null);
  assert.ok(messageProblem('x'.repeat(61)));
  assert.equal(messageProblem('🌱'.repeat(60)), null);
  assert.ok(messageProblem('🌱'.repeat(61)));
  assert.equal(tidyMessage('  lots \n of\t space  '), 'lots of space');
  assert.equal(messageLength('a🌱b'), 3);
});

test('a status needs an emoji, a message, or both, but not neither', () => {
  assert.equal(hasContent('🌙', ''), true);
  assert.equal(hasContent('', 'taking it slow'), true);
  assert.equal(hasContent('🌙', 'taking it slow'), true);
  assert.equal(hasContent('', ''), false);
  assert.equal(hasContent('', '   '), false);
});

test('a status from the server is read defensively and keeps whatever words and emoji it carries', () => {
  const good = parseVibe({ emoji: '🌙', message: ' taking it slow ', updatedAt: iso(-HOUR), expiresAt: iso(23 * HOUR), visibility: 'connections' });
  assert.deepEqual(good, { emoji: '🌙', message: 'taking it slow', updatedAt: iso(-HOUR), expiresAt: iso(23 * HOUR), visibility: 'connections' });
  assert.deepEqual(parseVibe({ emoji: '☕', updatedAt: iso(0), expiresAt: iso(HOUR) }), { emoji: '☕', message: null, updatedAt: iso(0), expiresAt: iso(HOUR) }, 'an emoji alone');
  assert.deepEqual(parseVibe({ message: 'need coffee', updatedAt: iso(0), expiresAt: iso(HOUR) }), { emoji: '', message: 'need coffee', updatedAt: iso(0), expiresAt: iso(HOUR) }, 'words alone');
  assert.equal(parseVibe({ emoji: '🌙', message: 'x'.repeat(61), updatedAt: iso(0), expiresAt: iso(HOUR) })!.message, null, 'an over-long message is not shown');
  assert.equal('visibility' in parseVibe({ emoji: '🌙', updatedAt: iso(0), expiresAt: iso(HOUR) })!, false, 'others never get the setting');
  for (const bad of [null, undefined, 'x', {}, { updatedAt: iso(0), expiresAt: iso(HOUR) }, { emoji: '🌙', updatedAt: 'x', expiresAt: iso(HOUR) }, { emoji: '🌙', updatedAt: iso(0) }, { emoji: '🌙', updatedAt: iso(0), expiresAt: 5 }]) {
    assert.equal(parseVibe(bad), null, JSON.stringify(bad));
  }
});

test('a profile answer keeps working with a bad, missing or older status', () => {
  const base = { self: false, relation: { state: 'none' }, blocked: null, member: { id: 'abcdefgh', displayName: 'Luna', pronouns: null, avatar: null, about: null, vibe: null, style: null, intention: null, interests: [], location: null, orientation: null, identity: null, expression: [], showsAge: false } };
  assert.equal(parseProfileResponse(base)!.currentVibe, null, 'an older answer has no status');
  assert.equal(parseProfileResponse({ ...base, currentVibe: { moodId: 'nope' } })!.currentVibe, null);
  assert.equal(parseProfileResponse({ ...base, currentVibe: { emoji: '🦋', message: 'healing quietly', updatedAt: iso(0), expiresAt: iso(HOUR) } })!.currentVibe!.message, 'healing quietly');
});

test('isLive follows the expiry time exactly', () => {
  assert.equal(isLive({ expiresAt: iso(1) }, NOW), true);
  assert.equal(isLive({ expiresAt: iso(0) }, NOW), false, 'at the expiry moment it is over');
  assert.equal(isLive({ expiresAt: iso(-1) }, NOW), false);
  assert.equal(isLive(null, NOW), false);
  assert.equal(isLive({ expiresAt: 'garbage' }, NOW), false);
});

test('"Updated … ago" and "Clears in …": the wording, rounding and edges', () => {
  assert.equal(updatedAgo(iso(0), NOW), 'just now');
  assert.equal(updatedAgo(iso(-MIN), NOW), '1 minute ago');
  assert.equal(updatedAgo(iso(-59 * MIN), NOW), '59 minutes ago');
  assert.equal(updatedAgo(iso(-HOUR), NOW), '1 hour ago');
  assert.equal(updatedAgo(iso(-2 * HOUR - 5 * MIN), NOW), '2 hours ago');
  assert.equal(updatedAgo(iso(HOUR), NOW), 'just now', 'a time in the future never reads as negative');
  assert.equal(expiresIn(iso(24 * HOUR), NOW), '24 hours');
  assert.equal(expiresIn(iso(22 * HOUR - MIN), NOW), '22 hours');
  assert.equal(expiresIn(iso(HOUR), NOW), '1 hour');
  assert.equal(expiresIn(iso(45 * MIN), NOW), '45 minutes');
  assert.equal(expiresIn(iso(MIN), NOW), 'less than a minute');
  assert.equal(expiresIn(iso(-HOUR), NOW), 'less than a minute', 'never negative');
  assert.equal(vibeTimes({ updatedAt: iso(-2 * HOUR), expiresAt: iso(22 * HOUR) }, NOW), 'Updated 2 hours ago · Clears in 22 hours');
});

test('exact times are shown in Manila time', () => {
  assert.match(manilaDateTime('2026-11-12T12:00:00.000Z'), /Nov 12, 2026/);
  assert.match(manilaDateTime('2026-11-12T12:00:00.000Z'), /8:00\s?PM/i);
  assert.match(manilaDateTime('2026-11-12T17:00:00.000Z'), /Nov 13, 2026/, 'it crosses midnight in Manila before it does in UTC');
  assert.equal(manilaDateTime('garbage'), '');
});

test('the spoken summary has the emoji, the words and the time left', () => {
  const vibe = parseVibe({ emoji: '🦋', message: 'healing quietly', updatedAt: iso(-2 * HOUR), expiresAt: iso(22 * HOUR) })!;
  assert.equal(vibeAccessibleSummary(vibe, NOW), 'Status: 🦋 healing quietly. Updated 2 hours ago · Clears in 22 hours');
  assert.equal(vibeAccessibleSummary(parseVibe({ message: 'need coffee', updatedAt: iso(0), expiresAt: iso(HOUR) })!, NOW).startsWith('Status: need coffee.'), true);
});

test('the three visibility choices have names, and an unknown one falls back to the widest', () => {
  assert.deepEqual(VIBE_VISIBILITY_OPTIONS.map((o) => o.label), ['Everyone who can view my profile', 'Approved connections only', 'Nobody']);
  assert.equal(visibilityLabel('nobody'), 'Nobody');
  assert.equal(visibilityLabel('weird' as never), 'Everyone who can view my profile');
});

// ---- the server's side of the same rules
const ts = (ms: number) => ({ toMillis: () => ms });
const stored = (over: Record<string, unknown> = {}) => ({ emoji: '🌙', message: 'taking it slow', visibility: 'everyone', updatedAt: ts(NOW - MIN), expiresAt: ts(NOW + HOUR), ...over });

test('server: input is one emoji and up to 60 characters, at least one of them, and nothing else', () => {
  const ok = (body: Record<string, unknown>) => server.parseVibeInput(body);
  assert.deepEqual(ok({ emoji: '🌙', message: '  taking   it slow ' }), { ok: true, emoji: '🌙', message: 'taking it slow', visibility: 'everyone' });
  assert.equal(ok({ emoji: '🌙' }).ok, true, 'an emoji alone');
  assert.equal(ok({ message: 'need coffee' }).ok, true, 'words alone');
  assert.deepEqual(ok({}), { ok: false, error: 'empty_status' });
  assert.deepEqual(ok({ emoji: '', message: '   ' }), { ok: false, error: 'empty_status' });
  assert.deepEqual(ok({ emoji: 'ab' }), { ok: false, error: 'invalid_emoji' });
  assert.deepEqual(ok({ emoji: '😊😊' }), { ok: false, error: 'invalid_emoji' });
  assert.deepEqual(ok({ message: 'x'.repeat(61) }), { ok: false, error: 'invalid_message' });
  assert.deepEqual(ok({ emoji: '🌙', moodId: 'happy' }), { ok: false, error: 'invalid_vibe' }, 'the old mood field is no longer accepted');
  assert.deepEqual(ok({ emoji: '🌙', visibility: 'friends' }), { ok: false, error: 'invalid_visibility' });
});

test('server: a record saved in the old mood shape still reads, as its emoji with its message or its mood name, until it expires', () => {
  const old = { moodId: 'healing', emoji: '🌱', label: 'Healing', message: '', visibility: 'everyone', updatedAt: ts(NOW - MIN), expiresAt: ts(NOW + HOUR) };
  assert.deepEqual(server.vibeFor(old, NOW, {}), { emoji: '🌱', message: 'Healing', updatedAt: iso(-MIN), expiresAt: iso(HOUR) });
  assert.equal(server.vibeFor({ ...old, message: 'one day at a time' }, NOW, {})!.message, 'one day at a time');
  assert.equal(server.vibeFor({ ...old, message: 'x'.repeat(100) }, NOW, {})!.message!.length, 60, 'an old long message is cut to the new limit');
  assert.equal(server.vibeFor(old, NOW + 2 * HOUR, {}), null, 'and it expires like any other');
});

test('server: what a viewer may see follows the setting and the connection, and expiry always wins', () => {
  const see = (visibility: string, opts: { self?: boolean; connected?: boolean } = {}, expiresInMs = HOUR) => server.vibeFor(stored({ visibility, expiresAt: ts(NOW + expiresInMs) }), NOW, opts);
  assert.ok(see('everyone'));
  assert.equal(see('connections'), null);
  assert.ok(see('connections', { connected: true }));
  assert.equal(see('nobody', { connected: true }), null);
  assert.equal(see('something-else', { connected: true }), null, 'an unknown setting is private');
  assert.equal(see('everyone', {}, 0), null);
  assert.equal(see('everyone', { self: true }, -1), null, 'not even the owner sees an expired one');
  assert.equal(see('nobody', { self: true })!.visibility, 'nobody', 'the owner sees their own, with its setting');
  assert.equal('visibility' in see('everyone')!, false);
});

test('server: a stored status with no usable emoji or words, or a bad emoji, is never shown', () => {
  assert.equal(server.vibeFor(stored({ emoji: '', message: '' }), NOW, {}), null);
  assert.equal(server.vibeFor(stored({ emoji: 'not an emoji', message: '' }), NOW, {}), null);
  assert.equal(server.vibeFor(stored({ emoji: 'not an emoji' }), NOW, {})!.emoji, '', 'a bad emoji is dropped, the words stay');
  assert.equal(server.vibeFor(stored({ expiresAt: 'tomorrow' }), NOW, {}), null);
  assert.equal(server.vibeFor(stored({ message: 'two\nlines' }), NOW, {})!.message, null, 'a message with a line break is not shown');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VIBE_MESSAGE_MAX,
  VIBE_MOODS,
  VIBE_TTL_HOURS,
  VIBE_VISIBILITY_OPTIONS,
  expiresIn,
  isLive,
  manilaDateTime,
  messageLength,
  messageProblem,
  moodById,
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

test('the fourteen moods, in order, each with its own emoji and name', () => {
  assert.deepEqual(VIBE_MOODS.map((m) => `${m.emoji} ${m.label}`), [
    '😊 Happy', '🥰 Loved', '🦋 Excited', '🌙 Dreamy', '😌 Peaceful', '🥺 Sensitive', '😔 Sad', '😵‍💫 Overwhelmed', '🔥 Motivated', '🫠 Exhausted', '💭 Thoughtful', '🌱 Healing', '☁️ Lonely', '💜 Grateful',
  ]);
  assert.equal(new Set(VIBE_MOODS.map((m) => m.id)).size, 14);
  for (const mood of VIBE_MOODS) assert.deepEqual(moodById(mood.id), mood);
  for (const bad of ['angry', '', 7, null, undefined, 'HAPPY']) assert.equal(moodById(bad), null);
});

test('the app and the server agree on the moods, the limit, the lifetime and the visibility choices', () => {
  assert.deepEqual(server.VIBE_MOODS, VIBE_MOODS.map((m) => ({ ...m })));
  assert.equal(server.VIBE_MESSAGE_MAX, VIBE_MESSAGE_MAX);
  assert.equal(server.VIBE_TTL_MS, VIBE_TTL_HOURS * HOUR);
  assert.deepEqual(server.VIBE_VISIBILITIES, VIBE_VISIBILITY_OPTIONS.map((o) => o.id));
  for (const text of ['', 'hi', 'x'.repeat(100), 'x'.repeat(101), '🌱'.repeat(100), '🌱'.repeat(101), 'a\nb', 'tab\there', 'bell\u0007']) {
    const here = messageProblem(text) === null;
    const there = server.parseVibeInput({ moodId: 'happy', message: text }).ok;
    // The app tidies line breaks and tabs into spaces before sending; the server refuses them outright, so a control character
    // other than whitespace must be refused by both.
    if (/[\n\t]/.test(text)) continue;
    assert.equal(here, there, JSON.stringify(text));
  }
});

test('the message is optional, tidied to one line, and limited to 100 characters with an emoji counting as one', () => {
  assert.equal(messageProblem(''), null);
  assert.equal(messageProblem('   '), null);
  assert.equal(messageProblem('x'.repeat(100)), null);
  assert.ok(messageProblem('x'.repeat(101)));
  assert.equal(messageProblem('🌱'.repeat(100)), null);
  assert.ok(messageProblem('🌱'.repeat(101)));
  assert.equal(tidyMessage('  lots \n of\t space  '), 'lots of space');
  assert.equal(messageLength('a🌱b'), 3);
  assert.equal(messageLength('😵‍💫'), 3, 'a joined emoji is several characters, the same way the server counts them');
  assert.equal(messageLength(tidyMessage('x'.repeat(98) + '   ')), 98, 'spaces on the end do not count against the limit');
});

test('a status from the server is read defensively: the mood comes from the list, and anything malformed is no status', () => {
  const good = parseVibe({ moodId: 'healing', emoji: '💀', label: 'Hacked', message: ' Taking it slow ', updatedAt: iso(-HOUR), expiresAt: iso(23 * HOUR), visibility: 'connections' });
  assert.deepEqual(good, { moodId: 'healing', emoji: '🌱', label: 'Healing', message: 'Taking it slow', updatedAt: iso(-HOUR), expiresAt: iso(23 * HOUR), visibility: 'connections' });
  assert.equal(parseVibe({ moodId: 'happy', updatedAt: iso(0), expiresAt: iso(HOUR) })!.message, null);
  assert.equal(parseVibe({ moodId: 'happy', message: 'x'.repeat(101), updatedAt: iso(0), expiresAt: iso(HOUR) })!.message, null, 'an over-long message is not shown');
  assert.equal('visibility' in parseVibe({ moodId: 'happy', updatedAt: iso(0), expiresAt: iso(HOUR) })!, false, 'others never get the setting');
  for (const bad of [null, undefined, 'x', {}, { moodId: 'angry', updatedAt: iso(0), expiresAt: iso(HOUR) }, { moodId: 'happy', updatedAt: 'x', expiresAt: iso(HOUR) }, { moodId: 'happy', updatedAt: iso(0) }, { moodId: 'happy', updatedAt: iso(0), expiresAt: 5 }]) {
    assert.equal(parseVibe(bad), null, JSON.stringify(bad));
  }
});

test('a profile answer keeps working with a bad, missing or older status', () => {
  const base = { self: false, relation: { state: 'none' }, blocked: null, member: { id: 'abcdefgh', displayName: 'Luna', pronouns: null, avatar: null, about: null, vibe: null, style: null, intention: null, interests: [], location: null, orientation: null, identity: null, expression: [], showsAge: false } };
  assert.equal(parseProfileResponse(base)!.currentVibe, null, 'an older answer has no status');
  assert.equal(parseProfileResponse({ ...base, currentVibe: { moodId: 'nope' } })!.currentVibe, null);
  assert.equal(parseProfileResponse({ ...base, currentVibe: { moodId: 'happy', updatedAt: iso(0), expiresAt: iso(HOUR) } })!.currentVibe!.label, 'Happy');
});

test('isLive follows the expiry time exactly', () => {
  assert.equal(isLive({ expiresAt: iso(1) }, NOW), true);
  assert.equal(isLive({ expiresAt: iso(0) }, NOW), false, 'at the expiry moment it is over');
  assert.equal(isLive({ expiresAt: iso(-1) }, NOW), false);
  assert.equal(isLive(null, NOW), false);
  assert.equal(isLive({ expiresAt: 'garbage' }, NOW), false);
});

test('"Updated … ago" and "Expires in …": the wording, rounding and edges', () => {
  assert.equal(updatedAgo(iso(0), NOW), 'just now');
  assert.equal(updatedAgo(iso(-30_000), NOW), 'just now');
  assert.equal(updatedAgo(iso(-MIN), NOW), '1 minute ago');
  assert.equal(updatedAgo(iso(-59 * MIN), NOW), '59 minutes ago');
  assert.equal(updatedAgo(iso(-HOUR), NOW), '1 hour ago');
  assert.equal(updatedAgo(iso(-2 * HOUR - 5 * MIN), NOW), '2 hours ago');
  assert.equal(updatedAgo(iso(HOUR), NOW), 'just now', 'a time in the future never reads as negative');
  assert.equal(expiresIn(iso(24 * HOUR), NOW), '24 hours');
  assert.equal(expiresIn(iso(22 * HOUR - MIN), NOW), '22 hours', 'rounded up, so 2 hours ago + 22 hours reads naturally');
  assert.equal(expiresIn(iso(HOUR), NOW), '1 hour');
  assert.equal(expiresIn(iso(45 * MIN), NOW), '45 minutes');
  assert.equal(expiresIn(iso(MIN), NOW), 'less than a minute');
  assert.equal(expiresIn(iso(10_000), NOW), 'less than a minute');
  assert.equal(expiresIn(iso(-HOUR), NOW), 'less than a minute', 'never negative');
  assert.equal(vibeTimes({ updatedAt: iso(-2 * HOUR), expiresAt: iso(22 * HOUR) }, NOW), 'Updated 2 hours ago · Expires in 22 hours');
});

test('exact times are shown in Manila time', () => {
  // 2026-11-12 12:00 UTC is 20:00 in Manila (UTC+8, no daylight saving).
  assert.match(manilaDateTime('2026-11-12T12:00:00.000Z'), /Nov 12, 2026/);
  assert.match(manilaDateTime('2026-11-12T12:00:00.000Z'), /8:00\s?PM/i);
  assert.match(manilaDateTime('2026-11-12T17:00:00.000Z'), /Nov 13, 2026/, 'it crosses midnight in Manila before it does in UTC');
  assert.equal(manilaDateTime('garbage'), '');
});

test('the spoken summary has the mood, the message and the times', () => {
  const vibe = parseVibe({ moodId: 'healing', message: 'One day at a time', updatedAt: iso(-2 * HOUR), expiresAt: iso(22 * HOUR) })!;
  assert.equal(vibeAccessibleSummary(vibe, NOW), 'Current Vibe: Healing. “One day at a time”. Updated 2 hours ago · Expires in 22 hours');
});

test('the three visibility choices have names, and an unknown one falls back to the widest', () => {
  assert.deepEqual(VIBE_VISIBILITY_OPTIONS.map((o) => o.label), ['Everyone who can view my profile', 'Approved connections only', 'Nobody']);
  assert.equal(visibilityLabel('nobody'), 'Nobody');
  assert.equal(visibilityLabel('weird' as never), 'Everyone who can view my profile');
});

test('server: what a viewer may see follows the setting and the connection, and expiry always wins', () => {
  const stored = (visibility: string, expiresInMs = HOUR) => ({ moodId: 'happy', message: 'hi', visibility, updatedAt: { toMillis: () => NOW - MIN }, expiresAt: { toMillis: () => NOW + expiresInMs } });
  const see = (visibility: string, opts: { self?: boolean; connected?: boolean } = {}, expiresInMs = HOUR) => server.vibeFor(stored(visibility, expiresInMs), NOW, opts);
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

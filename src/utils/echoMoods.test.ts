import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MOODS, MOOD_GROUPS, MOOD_IDS, MOOD_MAX, moodsInGroup, toMoodTags, toggleMood } from './echoMoods.ts';
import { toUnsaidPost } from '../services/unsaidService.ts';

const service = fs.readFileSync('src/services/unsaidService.ts', 'utf8').replace(/\r\n/g, '\n');

test('there are 24 moods in four groups of six, with unique ids, labels and an emoji each', () => {
  assert.equal(MOODS.length, 24);
  assert.deepEqual(MOOD_GROUPS.map((g) => g.label), ['Emotional', 'Positive', 'Love & Connection', 'Casual & Fun']);
  for (const g of MOOD_GROUPS) assert.equal(moodsInGroup(g.id).length, 6, g.label);
  assert.equal(new Set(MOOD_IDS).size, 24);
  assert.equal(new Set(MOODS.map((m) => m.label)).size, 24);
  for (const m of MOODS) assert.ok(m.emoji.length > 0, m.label);
  assert.deepEqual(MOODS.map((m) => m.label), [
    'Vulnerable', 'Melancholic', 'Overwhelmed', 'Healing', 'Lonely', 'Reflective',
    'Hopeful', 'Happy', 'Grateful', 'Growing', 'Loved', 'Proud',
    'In Love', 'Crushing', 'Missing Someone', 'Dreaming', 'Connected', 'Longing',
    'Daydreaming', 'Confused', 'Silly', 'Chill', 'Excited', 'Feeling Myself',
  ]);
});

test('at most two moods can be selected: a third is refused, and a chosen one can be removed or swapped', () => {
  assert.equal(MOOD_MAX, 2);
  let sel: string[] = [];
  sel = toggleMood(sel, 'happy');
  sel = toggleMood(sel, 'silly');
  assert.deepEqual(sel, ['happy', 'silly']);
  assert.deepEqual(toggleMood(sel, 'chill'), ['happy', 'silly'], 'no third mood');
  sel = toggleMood(sel, 'happy');
  assert.deepEqual(sel, ['silly'], 'removed');
  assert.deepEqual(toggleMood(sel, 'chill'), ['silly', 'chill'], 'a different one can now be picked');
  assert.deepEqual(toggleMood([], 'not-a-mood'), [], 'unknown moods are ignored');
});

test('stored moods are cleaned: unknown, repeated, extra or malformed values never get through', () => {
  assert.deepEqual(toMoodTags(undefined), []);
  assert.deepEqual(toMoodTags(null), []);
  assert.deepEqual(toMoodTags('happy'), []);
  assert.deepEqual(toMoodTags(['happy', 'happy', 'nope', 7, 'silly', 'chill']), ['happy', 'silly']);
});

test('Echoes without moodTags (every older Echo) read as having none', () => {
  assert.deepEqual(toUnsaidPost('old', { kind: 'vent', text: 'from before moods' }).moodTags, []);
  assert.deepEqual(toUnsaidPost('new', { kind: 'wins', text: 'x', moodTags: ['proud', 'happy'] }).moodTags, ['proud', 'happy']);
  assert.deepEqual(toUnsaidPost('bad', { kind: 'wins', text: 'x', moodTags: ['proud', 'x', 'happy', 'chill'] }).moodTags, ['proud', 'happy']);
});

test('the service writes moodTags only when chosen, on the public post, and nothing else about the write changes', () => {
  const post = service.slice(service.indexOf('export async function postUnsaid'), service.indexOf('/** IDs of the current user'));
  assert.match(post, /const moods = toMoodTags\(moodTags\)/);
  assert.match(post, /\.\.\.\(moods\.length \? \{ moodTags: moods \} : \{\}\)/);
  assert.match(post, /unsaid_owners', postRef\.id\), takesReplies \? \{ authorId: uid, kind, seenReplies: 0 \} : \{ authorId: uid \}/, 'the owner record is unchanged');
});

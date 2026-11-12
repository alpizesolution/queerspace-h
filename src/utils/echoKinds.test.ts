import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ECHO_GROUPS,
  UNSAID_KINDS,
  UNSAID_KIND_IDS,
  UNSAID_REPLY_KINDS,
  UNSAID_REPLY_MAX_LENGTH,
  groupOfKind,
  kindAllowsReplies,
  kindInfo,
  kindsInGroup,
  matchesEchoFilter,
  toUnsaidKind,
  unseenReplies,
} from './echoKinds.ts';

test('there are eight categories in three groups, in the order Release, Connect, Uplift', () => {
  assert.equal(UNSAID_KINDS.length, 8);
  assert.deepEqual(ECHO_GROUPS.map((g) => `${g.emoji} ${g.label}`), ['🌙 Release', '✨ Connect', '☀️ Uplift']);
  assert.deepEqual(kindsInGroup('release').map((k) => k.label), ['Confession', 'Vent', 'Unsent Letter']);
  assert.deepEqual(kindsInGroup('connect').map((k) => k.label), ['Need Advice', 'Random Thought']);
  assert.deepEqual(kindsInGroup('uplift').map((k) => k.label), ['Little Win', 'Gratitude', 'Daydream']);
  assert.equal(new Set(UNSAID_KIND_IDS).size, 8, 'ids are unique');
});

test('the two original categories keep their stored ids', () => {
  assert.ok(UNSAID_KIND_IDS.includes('vent'));
  assert.ok(UNSAID_KIND_IDS.includes('confession'));
  assert.equal(kindInfo('vent').label, 'Vent');
  assert.equal(kindInfo('confession').label, 'Confession');
});

test('replies are for Need Advice, Random Thoughts, Little Wins, Gratitude and Daydreams only', () => {
  assert.deepEqual([...UNSAID_REPLY_KINDS].sort(), ['advice', 'daydreams', 'gratitude', 'thoughts', 'wins']);
  for (const kind of ['advice', 'thoughts', 'wins', 'gratitude', 'daydreams']) assert.equal(kindAllowsReplies(kind), true, kind);
  for (const kind of ['confession', 'vent', 'unsent']) assert.equal(kindAllowsReplies(kind), false, kind);
  // Unknown or missing kinds read as a vent, which takes no replies.
  for (const kind of [undefined, null, '', 'rant', 42]) assert.equal(kindAllowsReplies(kind), false);
});

test('every category that takes replies says what its reply box and button say', () => {
  for (const k of UNSAID_KINDS) {
    if (k.replies) {
      assert.ok('replyPlaceholder' in k && k.replyPlaceholder, `${k.id}: a reply placeholder`);
      assert.ok('replyAction' in k && k.replyAction, `${k.id}: a reply button label`);
    } else {
      assert.equal('replyAction' in k, false, `${k.id}: reactions-only has no reply label`);
    }
  }
});

test('older posts stay readable: only vent and confession existed, and anything unknown is shown as a vent', () => {
  assert.equal(toUnsaidKind('confession'), 'confession');
  assert.equal(toUnsaidKind('vent'), 'vent');
  assert.equal(toUnsaidKind('advice'), 'advice');
  assert.equal(toUnsaidKind('something-from-the-future'), 'vent');
  assert.equal(toUnsaidKind(undefined), 'vent');
  assert.equal(groupOfKind('confession'), 'release');
});

test('the feed filter selects everything, a whole group, or one category', () => {
  assert.equal(matchesEchoFilter('wins', 'all'), true);
  assert.equal(matchesEchoFilter('wins', { group: 'uplift' }), true);
  assert.equal(matchesEchoFilter('wins', { group: 'release' }), false);
  assert.equal(matchesEchoFilter('wins', { kind: 'wins' }), true);
  assert.equal(matchesEchoFilter('wins', { kind: 'gratitude' }), false);
  // An old post of an unknown kind is a vent, so it shows under Release and under Vents.
  assert.equal(matchesEchoFilter('old-unknown', { group: 'release' }), true);
  assert.equal(matchesEchoFilter('old-unknown', { kind: 'vent' }), true);
});

test('replies are short, and "new replies" is never negative', () => {
  assert.equal(UNSAID_REPLY_MAX_LENGTH, 300);
  assert.equal(unseenReplies(5, 2), 3);
  assert.equal(unseenReplies(2, 2), 0);
  assert.equal(unseenReplies(1, 4), 0, 'a deleted reply cannot make it negative');
  assert.equal(unseenReplies(3.9, 1.2), 2);
});

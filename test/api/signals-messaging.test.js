import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ALLOWED_REACTIONS, DELTA_OVERLAP_MS, deltaCursor, toggleReaction } from '../../api/signals.js';

test('the server accepts every cat reaction the MATCHING chat offers, plus the earlier set so old reactions can be removed', () => {
  const source = fs.readFileSync('src/utils/reactions.ts', 'utf8');
  const offered = [...source.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(offered.length >= 6);
  for (const emoji of offered) assert.ok(ALLOWED_REACTIONS.includes(emoji), `${emoji} must be accepted by the API`);
  for (const emoji of ['💜', '🥹', '😂', '✨']) assert.ok(ALLOWED_REACTIONS.includes(emoji));
});

test('one reaction per member per message: add, change, remove, and never two from the same member', () => {
  let { reactions, selected } = toggleReaction({}, 'u1', '😻');
  assert.deepEqual(reactions, { '😻': ['u1'] });
  assert.equal(selected, '😻');
  // The partner joins the same emoji, then u1 changes to another one.
  ({ reactions } = toggleReaction(reactions, 'u2', '😻'));
  assert.deepEqual(reactions, { '😻': ['u1', 'u2'] });
  ({ reactions, selected } = toggleReaction(reactions, 'u1', '🙀'));
  assert.deepEqual(reactions, { '😻': ['u2'], '🙀': ['u1'] });
  assert.equal(selected, '🙀');
  // The same emoji again removes it, and an empty emoji disappears from the map.
  ({ reactions, selected } = toggleReaction(reactions, 'u1', '🙀'));
  assert.deepEqual(reactions, { '😻': ['u2'] });
  assert.equal(selected, null);
});

test('older messages where a member reacted with several emoji are tidied to a single reaction', () => {
  const legacy = { '💜': ['u1', 'u2'], '✨': ['u1'] };
  const { reactions, selected } = toggleReaction(legacy, 'u1', '😹');
  assert.deepEqual(reactions, { '💜': ['u2'], '😹': ['u1'] });
  assert.equal(selected, '😹');
});

test('the polling cursor is the moment the server read the messages, and the overlap stays under the poll interval', () => {
  assert.equal(deltaCursor(5000), new Date(5000).toISOString());
  assert.ok(DELTA_OVERLAP_MS >= 1000, 'a poll looks slightly behind the cursor so a late write is never missed');
  assert.ok(DELTA_OVERLAP_MS < 4000, 'shorter than the 4-second poll interval, so an idle conversation costs nothing');
});

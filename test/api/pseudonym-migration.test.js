// The migration plan is pure: who keeps a name, who is renamed, what gets registered. No database involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planMigration } from '../../scripts/migrate-pseudonyms.mjs';
import { pseudonymKey } from '../../api/_pseudonym.js';

const p = (uid, displayName, createdAt = null) => ({ uid, displayName, createdAt });
let seed = 7;
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('names that are already unique are kept exactly as they are and only registered', () => {
  const plan = planMigration([p('a', 'Lavender Lark', 1), p('b', 'VelvetMuse', 2), p('c', 'cozy_witch', 3)], new Map(), random);
  assert.equal(plan.rename.length, 0);
  assert.equal(plan.duplicateGroups.length, 0);
  assert.deepEqual(plan.register.map((r) => [r.uid, r.name]), [['a', 'Lavender Lark'], ['b', 'VelvetMuse'], ['c', 'cozy_witch']]);
});

test('in a group of duplicates the oldest account keeps the name and the rest get new, unused ones', () => {
  const profiles = [p('new1', 'velvetmuse', 30), p('old', 'VelvetMuse', 10), p('mid', 'Velvet_Muse', 20), p('solo', 'DreamyFox', 5)];
  const plan = planMigration(profiles, new Map(), random);
  assert.deepEqual(plan.duplicateGroups.map((g) => g.accounts), [3]);
  assert.deepEqual(plan.rename.map((r) => r.uid).sort(), ['mid', 'new1']);
  assert.deepEqual(plan.register.map((r) => r.uid).sort(), ['old', 'solo']);
  const finalKeys = [...plan.register.map((r) => r.key), ...plan.rename.map((r) => pseudonymKey(r.to))];
  assert.equal(new Set(finalKeys).size, 4);
  for (const r of plan.rename) assert.match(r.to, /^[A-Za-z]+$/);
});

test('accounts with no join time lose to accounts with one, and ties are settled by account id', () => {
  const a = planMigration([p('z', 'SoftMuse'), p('m', 'SoftMuse', 5)], new Map(), random);
  assert.deepEqual(a.rename.map((r) => r.uid), ['z']);
  const b = planMigration([p('b', 'SoftMuse', 5), p('a', 'SoftMuse', 5)], new Map(), random);
  assert.deepEqual(b.rename.map((r) => r.uid), ['b']);
});

test('an existing claim by an account in the group decides the keeper; a claim by anyone else renames them all', () => {
  const profiles = [p('old', 'SoftMuse', 1), p('claimant', 'softmuse', 2)];
  const kept = planMigration(profiles, new Map([['softmuse', 'claimant']]), random);
  assert.deepEqual(kept.rename.map((r) => r.uid), ['old']);
  assert.equal(kept.register.length, 0);
  const outsider = planMigration(profiles, new Map([['softmuse', 'someone-else']]), random);
  assert.deepEqual(outsider.rename.map((r) => r.uid).sort(), ['claimant', 'old']);
});

test('new names never collide with claimed names or with each other, even for a large group', () => {
  const profiles = Array.from({ length: 300 }, (_, i) => p(`u${String(i).padStart(3, '0')}`, 'SoftMuse', i));
  const claims = new Map([['dreamyfox', 'x'], ['chaoticcupid', 'y']]);
  const plan = planMigration(profiles, claims, random);
  assert.equal(plan.rename.length, 299);
  const keys = new Set([pseudonymKey('SoftMuse'), ...plan.rename.map((r) => pseudonymKey(r.to))]);
  assert.equal(keys.size, 300);
  assert.equal(keys.has('dreamyfox') || keys.has('chaoticcupid'), false);
});

test('accounts without a usable name are left alone and counted', () => {
  const plan = planMigration([p('a', ''), p('b', ' '), p('c', 'x'), p('d', 'VelvetMuse', 1)], new Map(), random);
  assert.equal(plan.totals.withoutUsableName, 3);
  assert.equal(plan.rename.length, 0);
});

test('re-running after names are registered plans nothing', () => {
  const profiles = [p('a', 'VelvetMuse', 1), p('b', 'DreamyFox', 2)];
  const claims = new Map([['velvetmuse', 'a'], ['dreamyfox', 'b']]);
  const plan = planMigration(profiles, claims, random);
  assert.deepEqual(plan.totals, { accounts: 2, withoutUsableName: 0, distinctNames: 2, duplicateGroups: 0, accountsToRename: 0, alreadyRegistered: 2, toRegister: 0 });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { agesCompatible } from '../../api/_matching.js';

const person = (age, min, max) => ({ age, range: min === undefined ? null : { ageMin: min, ageMax: max } });

test('mutual compatibility: the five scenarios, whichever person asks', () => {
  const scenarios = [
    [person(30, 25, 35), person(19, 18, 25), false], // B is outside A's range, and A is outside B's
    [person(30, 25, 35), person(27, 25, 35), true],
    [person(30, 25, 35), person(24, 18, 25), false], // B outside A's range (24 < 25) and A outside B's (30 > 25)
    [person(28, 25, 35), person(32, 25, 40), true],
    [person(22, 18, 25), person(30, 25, 35), false],
  ];
  for (const [a, b, expected] of scenarios) {
    assert.equal(agesCompatible(a, b), expected, `${JSON.stringify(a)} with ${JSON.stringify(b)}`);
    assert.equal(agesCompatible(b, a), expected, 'the answer is the same from the other side');
  }
});

test('both conditions are needed: a fit in only one direction is a rejection', () => {
  // A (30, wants 25-35) would take B (27), but B only wants 18-25: A is outside B's range.
  assert.equal(agesCompatible(person(30, 25, 35), person(27, 18, 25)), false);
  // The reverse: B would take A (B wants 25-40) but A only wants 18-25 and B is 32.
  assert.equal(agesCompatible(person(30, 18, 25), person(32, 25, 40)), false);
  // Someone with no range accepts anyone themselves, but the other person's range still applies.
  assert.equal(agesCompatible(person(19), person(30, 25, 35)), false);
  assert.equal(agesCompatible(person(30, 25, 35), person(19)), false);
  assert.equal(agesCompatible(person(28), person(30, 25, 35)), true);
});

test('every boundary, both directions: the answer is exactly "each age is inside the other\'s range, inclusive"', () => {
  const inside = (age, r) => !r || (Number.isInteger(age) && age >= r.ageMin && age <= r.ageMax);
  const ranges = [undefined, [25, 35], [30, 30], [18, 25], [35, 99], [18, 99], [26, 34]];
  let checked = 0;
  for (let ageA = 17; ageA <= 40; ageA++) {
    for (let ageB = 17; ageB <= 40; ageB++) {
      for (const ra of ranges) {
        for (const rb of ranges) {
          const a = ra ? person(ageA, ...ra) : person(ageA);
          const b = rb ? person(ageB, ...rb) : person(ageB);
          const expected = inside(ageB, a.range) && inside(ageA, b.range);
          assert.equal(agesCompatible(a, b), expected, `A ${ageA} ${JSON.stringify(ra)} / B ${ageB} ${JSON.stringify(rb)}`);
          assert.equal(agesCompatible(b, a), expected, 'symmetric');
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 10000);
});

test('an unknown age fails closed whenever either side has a range', () => {
  for (const unknown of [null, undefined, NaN, '30', 29.5]) {
    assert.equal(agesCompatible(person(30, 25, 35), { age: unknown, range: null }), false, `partner age ${unknown}`);
    assert.equal(agesCompatible({ age: unknown, range: null }, person(30, 25, 35)), false, `my age ${unknown}`);
    assert.equal(agesCompatible({ age: unknown, range: { ageMin: 18, ageMax: 99 } }, person(30)), true, 'my own range only constrains the other person');
  }
});

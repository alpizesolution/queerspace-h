import test from 'node:test';
import assert from 'node:assert/strict';
import { ageFromDate, parseBirthDate } from '../../api/_lib.js';
import { ageFits, agesCompatible, orderCandidates, queueFiltersCompatible } from '../../api/_matching.js';
import * as jsLocations from '../../api/_locations.js';
import * as tsLocations from '../../src/utils/philippines-locations.ts';
import { calculateAge, isValidBirthDate } from '../../src/utils/ageEligibility.ts';
import { filtersCompatible, pickQueueCandidates } from '../../src/services/liveMatchService.ts';

test('server age calculation matches the client for every day around a birthday', () => {
  const dates = ['2000-02-29', '1999-12-31', '2007-06-15', '1980-01-01', '2008-03-01'];
  const nows = ['2026-03-01', '2026-06-14', '2026-06-15', '2026-12-31', '2027-01-01', '2028-02-29'];
  for (const birth of dates) {
    for (const now of nows) {
      const at = new Date(`${now}T12:00:00.000Z`);
      assert.equal(ageFromDate(parseBirthDate(birth, at), at), calculateAge(birth, at), `${birth} at ${now}`);
    }
  }
});

test('birthday parsing rejects impossible and future dates like the client does', () => {
  const now = new Date('2026-10-28T00:00:00.000Z');
  for (const bad of ['2026-02-30', '2027-01-01', '1999-13-01', 'nope', '', null, 5]) {
    assert.equal(parseBirthDate(bad, now), null, String(bad));
    assert.equal(isValidBirthDate(bad, now), false, String(bad));
  }
  assert.ok(parseBirthDate('2000-02-29', now));
});

test('age ranges are private and apply both ways; a range needs a known age', () => {
  const me = { age: 25, range: { ageMin: 20, ageMax: 30 } };
  assert.equal(agesCompatible(me, { age: 28, range: null }), true);
  assert.equal(agesCompatible(me, { age: 40, range: null }), false);
  assert.equal(agesCompatible({ age: 25, range: null }, { age: 28, range: { ageMin: 30, ageMax: 40 } }), false, 'their range must fit me too');
  assert.equal(agesCompatible(me, { age: null, range: null }), false);
  assert.equal(ageFits(null, undefined), true);
  assert.equal(ageFits({ ageMin: 18, ageMax: 99 }, 18), true);
  assert.equal(ageFits({ ageMin: 18, ageMax: 99 }, 17), false);
});

test('the server location data and overlap rules match the TypeScript source', () => {
  assert.deepEqual(jsLocations.PHILIPPINE_ISLAND_GROUPS, [...tsLocations.PHILIPPINE_ISLAND_GROUPS]);
  assert.equal(jsLocations.NATIONWIDE_OPTION, tsLocations.NATIONWIDE_OPTION);
  assert.deepEqual(jsLocations.PHILIPPINE_REGIONS_AND_LOCATIONS, tsLocations.PHILIPPINE_REGIONS_AND_LOCATIONS);
  const names = [
    tsLocations.NATIONWIDE_OPTION,
    ...tsLocations.PHILIPPINE_ISLAND_GROUPS,
    ...tsLocations.PHILIPPINE_REGIONS_AND_LOCATIONS.flatMap((g) => [g.region, ...g.provincesAndCities.slice(0, 3)]),
    'Somewhere unknown',
  ];
  for (const a of names) for (const b of names) assert.equal(jsLocations.locationsOverlap(a, b), tsLocations.locationsOverlap(a, b), `${a} / ${b}`);
});

const ts = (ms) => ({ toMillis: () => ms }); // Firestore Timestamp stand-in

test('server queue filters and candidate order agree with the client (age aside)', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const some = (list) => (rnd() < 0.4 ? undefined : list.filter(() => rnd() < 0.5));
  const places = ['Cebu City', 'Visayas', 'Quezon City', 'Luzon', 'Bohol', 'Davao City'];
  const topics = ['books', 'cats', 'music'];
  const exprs = ['Femme', 'Andro', 'Soft & Sweet'];
  const entry = () => ({
    intent: pick(['open', 'dating', 'friendship', undefined]),
    topics: some(topics),
    areas: some(places),
    wantAreas: some(places),
    expr: some(exprs),
    wantExpr: some(exprs),
  });
  for (let i = 0; i < 300; i++) {
    const a = entry();
    const b = entry();
    assert.equal(queueFiltersCompatible(a, b), filtersCompatible(a, b), JSON.stringify([a, b]));
  }
  const now = Date.now();
  const entries = Array.from({ length: 12 }, (_, i) => ({
    id: `u${i}`,
    data: { ...entry(), status: i % 5 === 0 ? 'matched' : 'waiting', heartbeatAt: ts(now - (i % 4 === 0 ? 60_000 : 1_000)), createdAt: ts(now - i * 1_000) },
  }));
  const mine = entry();
  assert.deepEqual(orderCandidates(entries, 'u3', ['u7'], mine, now), pickQueueCandidates(entries, 'u3', ['u7'], now, mine));
});

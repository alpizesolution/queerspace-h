import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase/firestore';
import { ageRangeFromPrefs, filtersCompatible, isFreshQueueEntry, nextClaimDelay, pickQueueCandidates, queueMatchFields } from './liveMatchService.ts';

const now = 1_800_000_000_000;
const ts = (msAgo: number) => Timestamp.fromMillis(now - msAgo);

test('isFreshQueueEntry treats recent and pending heartbeats as live, old ones as stale', () => {
  assert.equal(isFreshQueueEntry({ heartbeatAt: ts(5_000) }, now), true);
  assert.equal(isFreshQueueEntry({ heartbeatAt: null }, now), true);
  assert.equal(isFreshQueueEntry({ heartbeatAt: ts(60_000) }, now), false);
});

test('pickQueueCandidates skips self, blocked, matched and stale entries, oldest first', () => {
  const entries = [
    { id: 'me', data: { status: 'waiting', heartbeatAt: ts(1_000), createdAt: ts(9_000) } },
    { id: 'newer', data: { status: 'waiting', heartbeatAt: ts(1_000), createdAt: ts(2_000) } },
    { id: 'older', data: { status: 'waiting', heartbeatAt: ts(1_000), createdAt: ts(8_000) } },
    { id: 'blocked', data: { status: 'waiting', heartbeatAt: ts(1_000), createdAt: ts(9_500) } },
    { id: 'taken', data: { status: 'matched', heartbeatAt: ts(1_000), createdAt: ts(9_900) } },
    { id: 'ghost', data: { status: 'waiting', heartbeatAt: ts(120_000), createdAt: ts(130_000) } },
  ];
  assert.deepEqual(pickQueueCandidates(entries, 'me', ['blocked'], now), ['older', 'newer']);
});

test('pickQueueCandidates returns nothing when no one else is waiting', () => {
  assert.deepEqual(
    pickQueueCandidates([{ id: 'me', data: { status: 'waiting', heartbeatAt: ts(0), createdAt: ts(0) } }], 'me', [], now),
    []
  );
});

test('nextClaimDelay backs off while the queue is empty and stays capped', () => {
  assert.equal(nextClaimDelay(0, 0.5), 3000);
  assert.equal(nextClaimDelay(2, 0.5), 6750);
  assert.equal(nextClaimDelay(20, 0.5), 12000);
  assert.ok(nextClaimDelay(0, 0) >= 2500 && nextClaimDelay(0, 1) <= 3500);
});

test('the readable queue entry never carries an age or an age range', () => {
  const fields = queueMatchFields({ applyAgeFilter: true, ageMin: 25, ageMax: 35, intention: 'dating' } as never);
  assert.deepEqual(fields, { intent: 'dating' });
  assert.equal(JSON.stringify(queueMatchFields({ ageMin: 20, ageMax: 30, applyAgeFilter: true } as never)).includes('age'), false);
});

test('ageRangeFromPrefs keeps a valid private range only when the filter is on', () => {
  assert.equal(ageRangeFromPrefs({}), null);
  assert.equal(ageRangeFromPrefs({ applyAgeFilter: false, ageMin: 20, ageMax: 30 }), null);
  assert.deepEqual(ageRangeFromPrefs({ applyAgeFilter: true, ageMin: 25, ageMax: 35 }), { ageMin: 25, ageMax: 35 });
  assert.equal(ageRangeFromPrefs({ applyAgeFilter: true, ageMin: 35, ageMax: 25 }), null);
  assert.equal(ageRangeFromPrefs({ applyAgeFilter: true, ageMin: 16, ageMax: 30 }), null, 'below 18 is never a valid range');
});

test('filtersCompatible: location filters match containing areas, both ways', () => {
  const cebu = { areas: ['Cebu City'] };
  assert.equal(filtersCompatible({ wantAreas: ['Visayas'] }, cebu), true);
  assert.equal(filtersCompatible({ wantAreas: ['Region VII (Central Visayas)'] }, cebu), true);
  assert.equal(filtersCompatible({ wantAreas: ['Quezon City'] }, cebu), false);
  assert.equal(filtersCompatible({ wantAreas: ['Quezon City'] }, {}), true, 'no shared location is never excluded');
  assert.equal(filtersCompatible({ areas: ['Quezon City'] }, { areas: ['Cebu City'], wantAreas: ['Cebu City'] }), false, 'their filter counts too');
  assert.equal(filtersCompatible({ wantAreas: ['Luzon'] }, { areas: ['Bohol', 'Makati City'] }), true);
});

test('filtersCompatible: gender expression filters, both ways, never excluding the unshared', () => {
  assert.equal(filtersCompatible({ wantExpr: ['Butch'] }, { expr: ['Butch', 'Stem'] }), true);
  assert.equal(filtersCompatible({ wantExpr: ['Butch'] }, { expr: ['Femme'] }), true, 'My Type is a soft preference');
  assert.equal(filtersCompatible({ wantExpr: ['Butch'] }, {}), true);
  assert.equal(filtersCompatible({ expr: ['Femme'] }, { wantExpr: ['Andro'] }), true, 'their preference is soft too');
  assert.equal(filtersCompatible({ expr: ['Femme'] }, { wantExpr: ['Femme'] }), true);
});

test('queueMatchFields shares location and expression only when shown, and filters only when on', () => {
  assert.deepEqual(
    queueMatchFields({
      locationSelection: ['Cebu City'],
      applyLocationFilter: true,
      genderExpression: ['Femme'],
      myVibe: 'Cozy',
      applyGenderExpressionFilter: true,
      preferredGenderExpressions: ['Butch'],
    }),
    { areas: ['Cebu City'], wantAreas: ['Cebu City'], expr: ['Cozy'], wantExpr: ['Butch'] }
  );
  assert.deepEqual(
    queueMatchFields({
      locationSelection: ['Cebu City'],
      showLocationOnProfile: false,
      genderExpression: ['Femme'],
      showGenderExpressionOnProfile: false,
      applyGenderExpressionFilter: true,
      preferredGenderExpressions: ['Any / No preference'],
    }),
    {}
  );
  assert.deepEqual(queueMatchFields({ locationSelection: ['Anywhere in the Philippines'], applyLocationFilter: true }), {});
  assert.deepEqual(queueMatchFields({ genderExpression: ['Prefer not to say'] }), {});
});

test('filtersCompatible: picking topics needs a shared topic; no topics only meets no topics', () => {
  assert.equal(filtersCompatible({}, {}), true);
  assert.equal(filtersCompatible({ topics: ['cats & dogs', 'tech & work life'] }, { topics: ['tech & work life'] }), true);
  assert.equal(filtersCompatible({ topics: ['cats & dogs'] }, { topics: ['anime & cozy games'] }), false);
  assert.equal(filtersCompatible({ topics: ['cats & dogs'] }, {}), false, 'open to anything does not land in a topic match');
  assert.equal(filtersCompatible({}, { topics: ['cats & dogs'] }), false);
});

test('queueMatchFields lowercases and dedupes topics', () => {
  assert.deepEqual(queueMatchFields({ topics: ['Cats & Dogs', 'cats & dogs ', ' '] }), { topics: ['cats & dogs'] });
  assert.deepEqual(queueMatchFields({ topics: [] }), {});
});

test('filtersCompatible: only the same intention matches; no intention counts as open', () => {
  assert.equal(filtersCompatible({ intent: 'deep_talk' }, { intent: 'deep_talk' }), true);
  assert.equal(filtersCompatible({ intent: 'deep_talk' }, { intent: 'open' }), false);
  assert.equal(filtersCompatible({ intent: 'deep_talk' }, {}), false);
  assert.equal(filtersCompatible({ intent: 'open' }, {}), true);
  assert.deepEqual(queueMatchFields({ intention: 'dating' }), { intent: 'dating' });
});

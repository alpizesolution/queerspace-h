// Trusted matching rules. The non-age rules mirror filtersCompatible/pickQueueCandidates in
// src/services/liveMatchService.ts (api/matching.test.js checks they agree); age rules use server-side ages only.
import { locationsOverlap } from './_locations.js';

export const STALE_AFTER_MS = 30_000;
const INTENTIONS = ['friendship', 'dating', 'casual', 'deep_talk', 'open'];

export function toMillis(value) {
  if (typeof value === 'number') return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  return 0;
}

/** Fresh = heartbeat within the stale window (a missing heartbeat counts as fresh, as on the client). */
export function isFreshQueueEntry(data, now = Date.now()) {
  const beat = toMillis(data?.heartbeatAt);
  return beat === 0 || now - beat < STALE_AFTER_MS;
}

/** The youngest and oldest age a range may name (the app is 18+; MINIMUM_AGE in _lib.js is the same 18, checked by a test). */
export const RANGE_MIN_AGE = 18;
export const RANGE_MAX_AGE = 99;

/** A usable range: whole numbers inside 18-99, youngest not above oldest. */
export function validAgeRange(ageMin, ageMax) {
  return Number.isInteger(ageMin) && Number.isInteger(ageMax)
    && ageMin >= RANGE_MIN_AGE && ageMax <= RANGE_MAX_AGE && ageMin <= ageMax;
}

/**
 * Reads a stored matchPrefs document. A document that exists but holds no usable range (damaged or edited by hand)
 * is reported as invalid so the caller can refuse to match that member, instead of reading it as "no age filter".
 */
export function storedRange(data) {
  const { ageMin, ageMax } = data ?? {};
  return validAgeRange(ageMin, ageMax) ? { valid: true, range: { ageMin, ageMax } } : { valid: false, range: null };
}

export function sameRange(a, b) {
  if (!a || !b) return !a && !b;
  return a.ageMin === b.ageMin && a.ageMax === b.ageMax;
}

/** Both people fit each other's private age range (when either has one). A range needs a known age. */
export function ageFits(range, age) {
  if (!range || !Number.isInteger(range.ageMin) || !Number.isInteger(range.ageMax)) return true;
  return Number.isInteger(age) && age >= range.ageMin && age <= range.ageMax;
}

export function agesCompatible(a, b) {
  return ageFits(a.range, b.age) && ageFits(b.range, a.age);
}

/** Intention, topics and location filters from two queue entries (no age). */
export function queueFiltersCompatible(a, b) {
  const fitsArea = (want, theirs) =>
    !want?.length || !theirs?.length || theirs.some((area) => want.some((w) => locationsOverlap(w, area)));
  const sharesTopic = () => (!a.topics?.length && !b.topics?.length) || (a.topics ?? []).some((t) => b.topics?.includes(t));
  const intent = (x) => (INTENTIONS.includes(x.intent) ? x.intent : 'open');
  return intent(a) === intent(b) && sharesTopic() && fitsArea(a.wantAreas, b.areas) && fitsArea(b.wantAreas, a.areas);
}

/**
 * Candidate ids in claim order: fresh waiting entries other than the caller and excluded ids that pass the
 * non-age filters, best "My Type" fit first, then oldest first. Age and eligibility are checked afterwards
 * (lazily) with private data.
 */
export function orderCandidates(entries, selfUid, excludeIds, mine, now = Date.now()) {
  const excluded = new Set([selfUid, ...excludeIds]);
  const typeScore = (candidate) =>
    Number(Boolean(mine.wantExpr?.length && candidate.expr?.some((v) => mine.wantExpr.includes(v)))) +
    Number(Boolean(candidate.wantExpr?.length && mine.expr?.some((v) => candidate.wantExpr.includes(v))));
  return entries
    .filter((e) => e.data.status === 'waiting' && !excluded.has(e.id) && isFreshQueueEntry(e.data, now))
    .filter((e) => queueFiltersCompatible(mine, e.data))
    .sort((a, b) => typeScore(b.data) - typeScore(a.data) || toMillis(a.data.createdAt) - toMillis(b.data.createdAt))
    .map((e) => e.id);
}

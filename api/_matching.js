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

/** Both people fit each other's private age range (when either has one). A range needs a known age. */
export function ageFits(range, age) {
  if (!range || !Number.isInteger(range.ageMin) || !Number.isInteger(range.ageMax)) return true;
  return typeof age === 'number' && age >= range.ageMin && age <= range.ageMax;
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

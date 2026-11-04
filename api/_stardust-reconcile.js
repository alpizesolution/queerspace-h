// Daily Stardust reconciliation: an author's profile total is the sum of the Stardust on the posts they have NOW.
//
// Why it exists: giving and removing keep the total in step with the post they touch, but deleting a post is a plain client
// delete that nothing on the server sees. This puts the total right again afterwards. The policy (docs/stardust.md):
// Stardust follows active posts; a deleted post stops counting, and a recreated post starts from zero.
//
// Resumable scan. A run walks three lists in a fixed order: community_posts, looking_for_posts, then stardust_totals (which
// finds authors whose posts are all gone). Each run starts where the last one stopped (a cursor in stardust_meta/reconcile,
// a server-only document), goes on until it runs out of time or reaches the end, and at the end the cursor wraps to the
// beginning. So a collection too big for one run is covered over several runs instead of the same first part every day.
//
// Why an interrupted or partial scan can never write a wrong total: the scan only chooses WHICH authors to check. Each author
// is settled in ONE transaction that sums ALL of that author's current posts on the server (both collections) and reads the
// total document, then writes only if the total differs. The scan's view of the posts is never used as a number.
//
// The cursor moves only over a prefix of fully checked authors: it stops at the first post whose author could not be settled
// (deferred, failed, or out of time), so that author is retried first next time. An author that keeps failing three runs in a
// row is skipped for that cycle (and reported) so it cannot block the rest. Checking an author twice is harmless, so a run
// that dies after its work but before saving the cursor just repeats that work.
//
// How it avoids racing with live give/remove:
//   - Every give/remove also writes the author's total document (and a post of the same author). Firestore therefore runs
//     the two one after the other, so a reconcile can neither overwrite a newer give/remove nor be overwritten by one.
//   - On a server instance that also serves give/remove, reconcile and give/remove for one author take turns (same lane).
//   - A transaction that cannot get its turn within the retry budget is deferred, not forced.
//   - A commit whose answer was lost is retried safely: the retry re-reads and re-sums.
//
// Cost per run (Firestore reads): one per post or total document scanned, plus per author checked two sum queries (about one
// read per 1,000 posts each, minimum one) and the total document. Writes: one per author whose total is wrong, plus one cursor
// write per page of progress. Underscore-prefixed files in api/ are not deployed as separate functions.
import { AggregateField, FieldValue } from 'firebase-admin/firestore';
import { withContentionRetry } from './_requests.js';
import { inAuthorLane } from './_stardust.js';

export const POST_COLLECTIONS = ['community_posts', 'looking_for_posts'];
/** The scan order. The last list holds the totals themselves: its document ids are author ids. */
const PHASES = [
  { collection: 'community_posts', field: 'authorId' },
  { collection: 'looking_for_posts', field: 'authorId' },
  { collection: 'stardust_totals', field: 'total' },
];
export const CURSOR_PATH = 'stardust_meta/reconcile';
const PAGE = 200;
const CONCURRENCY = 8;
/** An author that blocks the cursor this many runs in a row is skipped for the cycle. */
export const STUCK_RUNS = 3;
const MAX_LISTED = 50;
/** Time kept for one batch of author checks: no batch is started unless this much of the budget is left. */
const ATTEMPT_RESERVE_MS = 1500;

const count = value => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
const validTotal = value => Number.isFinite(value) && value >= 0 && Number.isInteger(value);
const validUid = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('/');

export async function readCursor(db) {
  const data = (await db.doc(CURSOR_PATH).get()).data() ?? {};
  // A cursor that does not make sense simply means "start from the beginning".
  const sane = Number.isInteger(data.phase) && data.phase >= 0 && data.phase < PHASES.length && (data.after === null || data.after === undefined || validUid(data.after));
  return {
    phase: sane ? data.phase : 0, after: sane && data.after ? data.after : null, cycle: count(data.cycle),
    stuckAuthor: validUid(data.stuckAuthor) ? data.stuckAuthor : null, stuckRuns: count(data.stuckRuns),
  };
}

const saveCursor = (db, cursor) => db.doc(CURSOR_PATH).set({
  phase: cursor.phase, after: cursor.after, cycle: cursor.cycle,
  stuckAuthor: cursor.stuckAuthor, stuckRuns: cursor.stuckRuns, updatedAt: FieldValue.serverTimestamp(),
});

/** The author's current Stardust: a server-side sum over their posts in both collections, read inside the transaction. */
async function liveSum(tx, db, authorId) {
  const snaps = await Promise.all(POST_COLLECTIONS.map(collection =>
    tx.get(db.collection(collection).where('authorId', '==', authorId).aggregate({ stardust: AggregateField.sum('stardustCount') }))));
  return snaps.reduce((sum, snap) => sum + count(snap.data().stardust), 0);
}

/** Settles one author's total in one transaction. Returns { status: 'ok', changed, was, now } | { status: 'deferred' } | { status: 'failed', error }. */
async function settleAuthor(db, authorId, { dryRun, budgetLeft, retryBudgetMs }) {
  try {
    const outcome = await inAuthorLane(authorId, () => withContentionRetry(
      () => db.runTransaction(async (tx) => {
        const totalRef = db.doc(`stardust_totals/${authorId}`);
        const [totalSnap, expected] = await Promise.all([tx.get(totalRef), liveSum(tx, db, authorId)]);
        const stored = totalSnap.exists ? totalSnap.data()?.total : undefined;
        const correct = stored === undefined ? expected === 0 : validTotal(stored) && stored === expected;
        if (correct) return { changed: false };
        if (!dryRun) tx.set(totalRef, { total: expected, updatedAt: FieldValue.serverTimestamp(), reconciledAt: FieldValue.serverTimestamp() }, { merge: true });
        return { changed: true, was: stored === undefined ? null : stored, now: expected };
      }, { maxAttempts: 1 }),
      // Never retry past the run's own budget: the response of the whole cron must still go out in time.
      { budgetMs: Math.min(retryBudgetMs, Math.max(0, budgetLeft())), attemptMs: ATTEMPT_RESERVE_MS },
    ));
    return { status: 'ok', ...outcome };
  } catch (error) {
    const retryable = /ABORTED|lock timeout|contention|DEADLINE|UNAVAILABLE/i.test(String(error?.message ?? '')) || [4, 10, 14].includes(error?.code);
    return retryable ? { status: 'deferred' } : { status: 'failed', error: String(error?.message ?? error).slice(0, 160) };
  }
}

/**
 * Continues the scan from the saved cursor and settles the authors it meets, until the time budget is used or the end of the
 * last list is reached (then the cursor wraps). `dryRun` reports without writing anything (the cursor included) and always
 * scans from the beginning. Never throws for one author's failure. See the notes at the top of this file.
 */
export async function reconcileStardust(db, { dryRun = false, budgetMs = 5000, now = Date.now, retryBudgetMs = 4500, pageSize = PAGE, concurrency = CONCURRENCY } = {}) {
  const started = now();
  const elapsed = () => now() - started;
  const hasTime = () => elapsed() + ATTEMPT_RESERVE_MS <= budgetMs;
  const saved = dryRun ? { phase: 0, after: null, cycle: 0, stuckAuthor: null, stuckRuns: 0 } : await readCursor(db);
  const cursor = { ...saved };
  const report = {
    mode: dryRun ? 'dry-run' : 'repair', startedAt: { phase: saved.phase, after: saved.after }, startedAtBeginning: saved.phase === 0 && saved.after === null,
    pagesProcessed: 0, postsScanned: 0, totalsScanned: 0, authorsChecked: 0, repaired: 0, unchanged: 0, deferred: 0, failed: 0,
    cycleComplete: false, truncated: true, skippedStuck: [], cursor: null, discrepancies: [], errors: [],
  };
  // An author that blocked the cursor for several runs in a row is passed over this time, so it cannot hold everything back.
  const skip = new Set();
  if (cursor.stuckAuthor && cursor.stuckRuns >= STUCK_RUNS) {
    skip.add(cursor.stuckAuthor);
    report.skippedStuck.push(cursor.stuckAuthor);
    cursor.stuckAuthor = null; cursor.stuckRuns = 0;
  }
  const done = new Set(); // authors settled during this run (an author seen again on a later page is not checked again)

  while (hasTime()) {
    const phase = PHASES[cursor.phase];
    let query = db.collection(phase.collection).select(phase.field).orderBy('__name__').limit(pageSize);
    if (cursor.after) query = query.startAfter(db.collection(phase.collection).doc(cursor.after));
    const page = await query.get();
    report.pagesProcessed++;
    // For each document: which author it asks us to check (null = nothing to check).
    const items = page.docs.map((doc) => {
      if (phase.field === 'authorId') { report.postsScanned++; return { id: doc.id, author: validUid(doc.data().authorId) ? doc.data().authorId : null }; }
      report.totalsScanned++;
      const total = doc.data().total;
      // A zero total is only wrong if the author has Stardust, and the post lists find that author; so it needs no check here.
      return { id: doc.id, author: validTotal(total) && total === 0 ? null : doc.id };
    });
    const order = [];
    for (const { author } of items) if (author && !done.has(author) && !skip.has(author) && !order.includes(author)) order.push(author);

    // Settle the authors in order, a few at a time, while there is time.
    const results = new Map();
    for (let i = 0; i < order.length && hasTime(); i += concurrency) {
      const batch = order.slice(i, i + concurrency);
      const settled = await Promise.all(batch.map(author => settleAuthor(db, author, { dryRun, budgetLeft: () => budgetMs - elapsed(), retryBudgetMs })));
      batch.forEach((author, k) => results.set(author, settled[k]));
    }
    for (const [author, r] of results) {
      if (r.status === 'ok') {
        done.add(author); report.authorsChecked++;
        if (!r.changed) report.unchanged++;
        else { report.repaired++; if (report.discrepancies.length < MAX_LISTED) report.discrepancies.push({ authorId: author, was: r.was, now: r.now }); }
      } else if (r.status === 'deferred') report.deferred++;
      else { report.failed++; if (report.errors.length < MAX_LISTED) report.errors.push({ authorId: author, error: r.error }); }
    }

    // The cursor moves over the longest prefix of this page whose authors are all settled.
    let upTo = 0;
    let blocker = null;
    while (upTo < items.length) {
      const { author } = items[upTo];
      if (!author || done.has(author) || skip.has(author)) { upTo++; continue; }
      blocker = author;
      break;
    }
    if (upTo > 0) cursor.after = items[upTo - 1].id;
    if (upTo === items.length) {
      if (page.size < pageSize) { // the end of this list: on to the next, and after the last one back to the first
        cursor.after = null;
        cursor.phase += 1;
        if (cursor.phase === PHASES.length) { cursor.phase = 0; cursor.cycle += 1; report.cycleComplete = true; report.truncated = false; }
      }
    } else {
      // Stopped inside the page: out of time, or an author that could not be settled. Remember a repeat offender.
      const blockedBy = results.get(blocker);
      if (blockedBy && blockedBy.status !== 'ok') {
        cursor.stuckRuns = cursor.stuckAuthor === blocker ? cursor.stuckRuns + 1 : 1;
        cursor.stuckAuthor = blocker;
      }
    }
    if (upTo === items.length) { cursor.stuckAuthor = null; cursor.stuckRuns = 0; }
    if (!dryRun && (upTo > 0 || report.cycleComplete || cursor.stuckAuthor !== saved.stuckAuthor || cursor.stuckRuns !== saved.stuckRuns)) await saveCursor(db, cursor);
    if (upTo < items.length || report.cycleComplete) break;
  }
  report.cursor = { phase: cursor.phase, after: cursor.after, cycle: cursor.cycle };
  return report;
}

// Test helper: the reconcile continues from a saved cursor, so one run may cover only part of the lists. Tests that want
// "everything is settled" run it until a run that started at the beginning has completed a cycle, and merge the reports.
import { reconcileStardust } from '../../api/_stardust-reconcile.js';

export async function reconcileFully(db, options = {}, maxRuns = 40) {
  const total = {
    runs: 0, pagesProcessed: 0, authorsChecked: 0, repaired: 0, unchanged: 0, deferred: 0, failed: 0,
    cycleComplete: false, discrepancies: [], errors: [], skippedStuck: [], cursor: null,
  };
  for (let i = 0; i < maxRuns; i += 1) {
    const run = await reconcileStardust(db, options);
    total.runs += 1;
    for (const key of ['pagesProcessed', 'authorsChecked', 'repaired', 'unchanged', 'deferred', 'failed']) total[key] += run[key];
    total.discrepancies.push(...run.discrepancies);
    total.errors.push(...run.errors);
    total.skippedStuck.push(...run.skippedStuck);
    total.cursor = run.cursor;
    total.mode = run.mode;
    if (options.dryRun) { total.cycleComplete = run.cycleComplete; break; }
    if (run.startedAtBeginning && run.cycleComplete) { total.cycleComplete = true; break; }
    if (run.failed || run.deferred) break; // a blocked cursor will not move; the caller decides what that means
  }
  return total;
}

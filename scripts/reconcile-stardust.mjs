// Puts every author's Stardust total right: the sum of the Stardust on the posts they have now (deleted posts stop counting).
// The same code runs daily inside /api/media-cleanup (a few seconds each time, resuming from a saved cursor); by hand it keeps
// going from the saved cursor until it has been all the way round once.
//
//   node scripts/reconcile-stardust.mjs --dry-run     report only
//   node scripts/reconcile-stardust.mjs               repair
//
// Credentials: FIREBASE_SERVICE_ACCOUNT_JSON (never printed) or the Firestore emulator. Safe to repeat and to run next to live traffic.
import { pathToFileURL } from 'node:url';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { reconcileStardust } from '../api/_stardust-reconcile.js';

function getDb() {
  if (getApps().length) return getFirestore();
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return getFirestore(initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-queerspace-test' }));
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Set FIREBASE_SERVICE_ACCOUNT_JSON (or use the emulator).');
  const credentials = JSON.parse(raw);
  return getFirestore(initializeApp({ credential: cert(credentials), projectId: credentials.project_id }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  const options = { dryRun, budgetMs: 10 * 60_000, retryBudgetMs: 30_000 };
  (async () => {
    const db = getDb();
    const total = { runs: 0, pagesProcessed: 0, authorsChecked: 0, repaired: 0, unchanged: 0, deferred: 0, failed: 0, skippedStuck: [], discrepancies: [], errors: [] };
    for (let i = 0; i < 100; i += 1) {
      const run = await reconcileStardust(db, options);
      total.runs += 1;
      for (const key of ['pagesProcessed', 'authorsChecked', 'repaired', 'unchanged', 'deferred', 'failed']) total[key] += run[key];
      total.skippedStuck.push(...run.skippedStuck); total.discrepancies.push(...run.discrepancies); total.errors.push(...run.errors);
      total.cursor = run.cursor;
      if (dryRun || (run.startedAtBeginning && run.cycleComplete) || run.failed || run.deferred) break;
    }
    console.log(JSON.stringify({ mode: dryRun ? 'dry-run' : 'repair', ...total }, null, 2));
    if (total.failed || total.deferred) process.exitCode = 1;
  })().catch((error) => {
    console.error('Reconcile failed:', error.message);
    process.exitCode = 1;
  });
}

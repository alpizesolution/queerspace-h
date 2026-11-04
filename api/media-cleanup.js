// Deletes the objects and records of timed photos that are due (expired, never opened for a day, or a failed upload).
// Runs on a schedule (see "crons" in vercel.json). The same daily run also reconciles Stardust totals (see below). Photos are already unreachable the moment they expire, because every
// open is judged by the server clock; this only removes what is left behind. Safe to run twice, and safe to retry.
import { timingSafeEqual } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { getAdminApp, send } from './_lib.js';
import { checkStorage, createMediaHandlers } from './_media.js';
import { reconcileStardust } from './_stardust-reconcile.js';

const BATCHES = 8;
/** The photo sweep runs first; Stardust reconciliation only starts if this much of the run is still left, and stops at the budget. */
const RECONCILE_MIN_LEFT_MS = 2000;
const RUN_BUDGET_MS = 8000;
const media = createMediaHandlers();

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  const given = /^Bearer (.+)$/.exec(req.headers?.authorization || '')?.[1] || '';
  if (!secret || secret.length < 16 || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }
  res.setHeader('Cache-Control', 'no-store');
  if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });
  try {
    // ?check=1: confirm the storage settings work by writing, reading and deleting a tiny object. Answers with steps and
    // error codes only, never a credential, an endpoint or a URL.
    const wantsCheck = (req.query?.check ?? new URL(req.url || '/', 'http://localhost').searchParams.get('check')) === '1';
    if (wantsCheck) return send(res, 200, await checkStorage(media.currentStore()));
    const db = getFirestore(getAdminApp());
    const startedAt = Date.now();
    const total = { due: 0, deleted: 0, failed: 0 };
    for (let i = 0; i < BATCHES; i += 1) {
      const result = await media.sweep(db, { limit: 50 });
      total.due += result.due;
      total.deleted += result.deleted;
      total.failed += result.failed;
      if (result.due < 50) break;
    }
    // Stardust follows active posts: put each author's total right after any deletions. A failure here is logged and never
    // turns the photo cleanup's answer into an error (the answer's shape is unchanged); the next run simply tries again.
    try {
      const left = RUN_BUDGET_MS - (Date.now() - startedAt);
      if (left >= RECONCILE_MIN_LEFT_MS) {
        const report = await reconcileStardust(db, { budgetMs: left - 1000, retryBudgetMs: Math.min(4500, left) });
        console.log('[Stardust reconcile]', JSON.stringify(report));
      } else {
        console.warn('[Stardust reconcile] skipped: no time left after the photo cleanup');
      }
    } catch (error) {
      console.error('[Stardust reconcile] failed:', error?.message);
    }
    return send(res, 200, total);
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    if (status === 500) console.error('[Media cleanup]', error);
    return send(res, status, { error: status === 500 ? 'internal_error' : error.message });
  }
}

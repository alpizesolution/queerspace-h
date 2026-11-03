// Deletes the objects and records of timed photos that are due (expired, never opened for a day, or a failed upload).
// Runs on a schedule (see "crons" in vercel.json). Photos are already unreachable the moment they expire, because every
// open is judged by the server clock; this only removes what is left behind. Safe to run twice, and safe to retry.
import { timingSafeEqual } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { getAdminApp, send } from './_lib.js';
import { createMediaHandlers } from './_media.js';

const BATCHES = 8;
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
    const db = getFirestore(getAdminApp());
    const total = { due: 0, deleted: 0, failed: 0 };
    for (let i = 0; i < BATCHES; i += 1) {
      const result = await media.sweep(db, { limit: 50 });
      total.due += result.due;
      total.deleted += result.deleted;
      total.failed += result.failed;
      if (result.due < 50) break;
    }
    return send(res, 200, total);
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    if (status === 500) console.error('[Media cleanup]', error);
    return send(res, status, { error: status === 500 ? 'internal_error' : error.message });
  }
}

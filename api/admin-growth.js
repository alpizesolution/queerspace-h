// Admin-only growth numbers from Firebase Authentication: how many accounts exist and how many were created
// each day. Only totals leave this function: no uid, email, name or provider detail is ever returned.
import { getAuth } from 'firebase-admin/auth';
import { HttpError, authenticate, getAdminApp, requireAdmin, send, sendError } from './_lib.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
export const GROWTH_DAYS = 90;
const CACHE_MS = 5 * 60 * 1000;

/** "2026-10-30": the calendar day in Philippine time, the same day the member app uses for activity. */
export function manilaDate(ms) {
  return new Date(ms + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Counts accounts created per Manila day for the last `days` days (oldest first). Pure, so it is easy to test. */
export function bucketCreations(creationTimes, now = Date.now(), days = GROWTH_DAYS) {
  const labels = Array.from({ length: days }, (_, i) => manilaDate(now - (days - 1 - i) * DAY_MS));
  const counts = new Map(labels.map((label) => [label, 0]));
  for (const ms of creationTimes) {
    const label = manilaDate(ms);
    if (counts.has(label)) counts.set(label, counts.get(label) + 1);
  }
  return labels.map((date) => ({ date, count: counts.get(date) }));
}

let cache = null;

/** Walks every Auth user a page at a time (1,000 per call) and keeps only creation times. */
async function readAccounts() {
  const auth = getAuth(getAdminApp());
  const creationTimes = [];
  let anonymous = 0;
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) {
      const created = Date.parse(user.metadata.creationTime);
      if (Number.isFinite(created)) creationTimes.push(created);
      if (user.providerData.length === 0) anonymous += 1;
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return { creationTimes, anonymous };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader?.('Allow', 'GET');
    return send(res, 405, { error: 'method_not_allowed' });
  }
  res.setHeader?.('Cache-Control', 'no-store');
  try {
    const { decoded, db } = await authenticate(req);
    await requireAdmin(db, decoded);
    const force = req.query?.force === '1';
    if (!force && cache && Date.now() - cache.at < CACHE_MS) return send(res, 200, cache.body);
    const { creationTimes, anonymous } = await readAccounts();
    const body = {
      total: creationTimes.length,
      anonymous,
      days: bucketCreations(creationTimes),
      timezone: 'Asia/Manila',
      generatedAt: Date.now(),
    };
    cache = { at: Date.now(), body };
    return send(res, 200, body);
  } catch (error) {
    if (!(error instanceof HttpError) && error?.code === 'auth/id-token-revoked') return send(res, 401, { error: 'unauthenticated' });
    return sendError(res, error);
  }
}

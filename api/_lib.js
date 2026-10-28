// Shared helpers for the trusted (Firebase Admin) endpoints. Files starting with "_" are not routes on Vercel.
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

export const MINIMUM_AGE = 18;

export function getAdminApp() {
  if (getApps().length) return getApps()[0];
  // Emulator mode is opt-in and needs both hosts; production requires the server-only service account.
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-queerspace-test' });
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON');
  const credentials = JSON.parse(raw);
  return initializeApp({ credential: cert(credentials), projectId: credentials.project_id });
}

export function send(res, status, body) {
  return res.status(status).json(body);
}

export function safeId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

export class HttpError extends Error {
  constructor(statusCode, code) {
    super(code);
    this.statusCode = statusCode;
  }
}

/** Verifies the Firebase ID token from the Authorization header. */
export async function authenticate(req) {
  const match = /^Bearer (.+)$/.exec(req.headers?.authorization || '');
  if (!match) throw new HttpError(401, 'unauthenticated');
  const app = getAdminApp();
  const decoded = await getAuth(app).verifyIdToken(match[1], true);
  return { uid: decoded.uid, decoded, db: getFirestore(app) };
}

/** Same rule as firestore.rules isAdmin(): Google sign-in plus an admins/{uid} document. */
export async function requireAdmin(db, decoded) {
  const isGoogle = decoded.firebase?.sign_in_provider === 'google.com';
  if (!isGoogle) throw new HttpError(403, 'not_allowed');
  const snap = await db.doc(`admins/${decoded.uid}`).get();
  if (!snap.exists) throw new HttpError(403, 'not_allowed');
}

/**
 * Whole years between a calendar birthday and now, using UTC calendar dates (the birthday is stored as
 * UTC midnight). Matches calculateAge in src/utils/ageEligibility.ts. Returns null for an invalid date.
 */
export function ageFromDate(birth, now = new Date()) {
  if (!(birth instanceof Date) || Number.isNaN(birth.getTime()) || birth.getTime() > now.getTime()) return null;
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())) age--;
  return age;
}

/** Age from a Firestore birthDate (Timestamp), or null when missing or invalid. */
export function ageFromTimestamp(value, now = new Date()) {
  return value instanceof Timestamp ? ageFromDate(value.toDate(), now) : null;
}

/** 'YYYY-MM-DD' to a UTC Date, or null when it is not a real calendar date in the past. */
export function parseBirthDate(value, now = new Date()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.getTime() <= now.getTime() ? date : null;
}

/**
 * Fixed-window rate limit per member and bucket, kept in a server-only collection.
 * Throws HttpError(429) once `max` calls have been made inside `windowMs`.
 */
export async function rateLimit(db, uid, bucket, max, windowMs, now = Date.now()) {
  const ref = db.doc(`apiRateLimits/${uid}_${bucket}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data || now - data.start >= windowMs) {
      tx.set(ref, { start: now, count: 1 });
    } else if (data.count >= max) {
      throw new HttpError(429, 'rate_limited');
    } else {
      tx.update(ref, { count: data.count + 1 });
    }
  });
}

/** Maps a thrown error to an HTTP response without leaking internals. */
export function sendError(res, error) {
  const status = Number(error?.statusCode) || (typeof error?.code === 'string' && error.code.startsWith('auth/') ? 401 : 500);
  if (status === 500) console.error('[API]', error);
  return send(res, status, { error: status === 500 ? 'internal_error' : error.message || 'request_failed' });
}

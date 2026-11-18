// Server-side helpers for the age review workflow (used by api/age.js). Files starting with "_" are not routes on Vercel.
//
// Server-only collections (clients have no access, see firestore.rules):
//   ageAttempts/{uid}        the under-18 birthday a member typed in, kept only so an admin can review it. It is never
//                            copied into users/{uid}/private/settings.birthDate.
//   ageRecords/{uid}         originalBirthDate, previousBirthDates, correctionCount, rejectedCount, manualReview.
//   birthdayCorrections/{uid} the member's current request (one at a time), with its status and decision reason.
//   ageAudit/{id}            who decided what and when. It never holds a birthday or a free-text reason.
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { MINIMUM_AGE, ageFromDate, ageFromTimestamp, parseBirthDate } from './_lib.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const positiveInt = (raw, fallback) => {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Approved corrections allowed over an account's lifetime. */
export const MAX_APPROVED_CORRECTIONS = 2;
/** Rejected requests (they do not use up the allowance) after which the member is flagged for manual review. */
export const REJECTIONS_BEFORE_REVIEW = positiveInt(process.env.AGE_REJECTION_REVIEW_THRESHOLD, 2);
/** Days a decided request or an under-18 attempt is kept before the purge removes it. See docs/age-review.md. */
export const RETENTION_DAYS = positiveInt(process.env.AGE_RECORD_RETENTION_DAYS, 90);
/** A correction this soon after an approved one is flagged. */
const RECENT_CORRECTION_DAYS = 30;
/** A requested birthday this many years away from the approved one is flagged. */
const LARGE_CHANGE_YEARS = 2;

export const OPEN_CORRECTION_STATUSES = ['pending', 'info-requested'];

export const isoDate = (date) => date.toISOString().slice(0, 10);
const toDate = (value) => (value instanceof Timestamp ? value.toDate() : null);

/** Flags that make an admin look twice at a request. Never blocks it by itself. */
export function suspiciousFlags({ record = {}, current = null, requested = null, now = new Date() }) {
  const flags = [];
  if (record.manualReview === true || (record.rejectedCount || 0) >= REJECTIONS_BEFORE_REVIEW) flags.push('repeated-rejections');
  const last = toDate(record.lastCorrectionAt);
  if (last && now.getTime() - last.getTime() < RECENT_CORRECTION_DAYS * DAY_MS) flags.push('recent-correction');
  if (current && requested && Math.abs(requested.getTime() - current.getTime()) > LARGE_CHANGE_YEARS * 365.25 * DAY_MS) flags.push('large-change');
  if ((record.correctionCount || 0) >= MAX_APPROVED_CORRECTIONS - 1 && current) flags.push('last-correction');
  return flags;
}

/** Audit entries record who decided what and when, never a birthday. */
export function audit(tx, db, entry) {
  tx.set(db.collection('ageAudit').doc(), { ...entry, at: FieldValue.serverTimestamp() });
}

/** Keeps an admin's free text from carrying a date into a notification. */
export function redactDates(text) {
  return String(text || '').replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, '[date]').trim().slice(0, 300);
}

/**
 * Tells the member through their existing support thread (written by the team, as the team's own replies are). The preview
 * shown in lists is generic; the full text may carry the admin's reason (dates removed). Never throws: a failed notice must not
 * undo a decision.
 */
export async function notifyMember(db, uid, { preview, text }) {
  try {
    const thread = db.doc(`support_threads/${uid}`);
    const batch = db.batch();
    batch.set(thread.collection('messages').doc(), { from: 'team', text: String(text).slice(0, 1000), timestamp: FieldValue.serverTimestamp() });
    batch.set(thread, {
      lastMessage: String(preview).slice(0, 140), lastFrom: 'team', updatedAt: FieldValue.serverTimestamp(),
      unreadForUser: true, unreadForTeam: false, teamMessageCount: FieldValue.increment(1),
    }, { merge: true });
    await batch.commit();
    return true;
  } catch (error) {
    console.warn('[AgeReview] Could not notify member:', error?.message || 'unknown');
    return false;
  }
}

export const NOTICES = {
  submitted: { preview: 'We received your birthday request', text: 'We received your birthday request. The team will review it and write back here. Your birthday stays private.' },
  approved: { preview: 'Your birthday request was approved', text: 'Your birthday request was approved. Thank you for your patience.' },
  rejected: (reason) => ({ preview: 'Update on your birthday request', text: `Your birthday request was not approved.${reason ? ` Reason: ${reason}` : ''} You can reply here if you have questions.` }),
  info: (reason) => ({ preview: 'We need more information', text: `We need a little more information about your birthday request.${reason ? ` ${reason}` : ''} Please reply here.` }),
};

/**
 * Everything an admin is allowed to see about one member's age review, from the server-only records. Returns the state the
 * admin interface labels: correction-pending, under18-attempt, adult-on-file or legacy (no birthday recorded).
 */
export async function memberReviewState(db, uid, now = new Date()) {
  const [settings, recordSnap, attemptSnap, requestSnap] = await Promise.all([
    db.doc(`users/${uid}/private/settings`).get(),
    db.doc(`ageRecords/${uid}`).get(),
    db.doc(`ageAttempts/${uid}`).get(),
    db.doc(`birthdayCorrections/${uid}`).get(),
  ]);
  const birth = toDate(settings.data()?.birthDate);
  const age = birth ? ageFromDate(birth, now) : null;
  const record = recordSnap.data() || {};
  const attempt = attemptSnap.data();
  const request = requestSnap.data();
  const open = request && OPEN_CORRECTION_STATUSES.includes(request.status);
  const requested = request?.requestedBirthDate ? parseBirthDate(request.requestedBirthDate) : null;
  const attemptDate = attempt?.attemptedBirthDate ? parseBirthDate(attempt.attemptedBirthDate) : null;
  const eligible = age !== null && age >= MINIMUM_AGE;

  let state = 'legacy';
  if (open) state = 'correction-pending';
  else if (attempt && !eligible) state = 'under18-attempt';
  else if (eligible) state = 'adult-on-file';

  return {
    uid,
    state,
    approvedBirthDate: birth ? isoDate(birth) : null,
    currentAge: age,
    eligible,
    attempt: attempt ? {
      birthDate: attempt.attemptedBirthDate || null,
      age: attemptDate ? ageFromDate(attemptDate, now) : null,
      count: attempt.attemptCount || 1,
      at: attempt.updatedAt?.toDate?.().toISOString?.() || null,
    } : null,
    correction: request ? {
      status: request.status,
      kind: request.kind || (birth ? 'correction' : 'initial'),
      requestedBirthDate: request.requestedBirthDate || null,
      requestedAge: requested ? ageFromDate(requested, now) : null,
      requestedEligible: requested ? (ageFromDate(requested, now) ?? 0) >= MINIMUM_AGE : null,
      reason: request.reason || '',
      decisionReason: request.decisionReason || '',
      flags: Array.isArray(request.flags) ? request.flags : [],
      createdAt: request.createdAt?.toDate?.().toISOString?.() || null,
      decidedAt: request.decidedAt?.toDate?.().toISOString?.() || null,
    } : null,
    record: {
      originalBirthDate: record.originalBirthDate || null,
      previousBirthDates: Array.isArray(record.previousBirthDates)
        ? record.previousBirthDates.map((p) => ({ birthDate: p.birthDate, replacedAt: p.replacedAt?.toDate?.().toISOString?.() || null }))
        : [],
      correctionCount: record.correctionCount || 0,
      correctionsRemaining: Math.max(0, MAX_APPROVED_CORRECTIONS - (record.correctionCount || 0)),
      rejectedCount: record.rejectedCount || 0,
      manualReview: record.manualReview === true,
    },
  };
}

/**
 * Retention: removes under-18 attempts and decided requests older than `days`. Open requests are never touched. A dry run only
 * counts. Counts are all that is returned.
 */
export async function purgeExpiredAgeRecords(db, { dryRun = true, days = RETENTION_DAYS, now = Date.now() } = {}) {
  const cutoff = Timestamp.fromMillis(now - days * DAY_MS);
  const attempts = await db.collection('ageAttempts').where('updatedAt', '<', cutoff).get();
  const decided = await db.collection('birthdayCorrections').where('decidedAt', '<', cutoff).get();
  const stale = decided.docs.filter((d) => !OPEN_CORRECTION_STATUSES.includes(d.data().status));
  if (!dryRun) {
    // A Firestore batch holds at most 500 writes, so delete in chunks.
    const refs = [...attempts.docs, ...stale].map((d) => d.ref);
    for (let i = 0; i < refs.length; i += 400) {
      const batch = db.batch();
      refs.slice(i, i + 400).forEach((ref) => batch.delete(ref));
      await batch.commit();
    }
  }
  return { dryRun, retentionDays: days, attempts: attempts.size, requests: stale.length };
}

export { ageFromTimestamp };

import React from 'react';
import { MessageCircleHeart, UserCheck } from 'lucide-react';
import type { ReviewState } from '../services/birthdayCorrectionService.ts';
import { AGE_FLAG_LABELS, AGE_REVIEW_LABELS } from '../utils/ageReview.ts';

/** Label for an age-review item in the Reports list. */
export const AgeReviewTag: React.FC = () => (
  <span className="tag !text-berry !bg-berry/10">Age review</span>
);

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex gap-2">
    <dt className="w-32 shrink-0 text-subtle">{label}</dt>
    <dd className="min-w-0 text-fg">{value}</dd>
  </div>
);

/** What the server holds about this member's age review, for admins only. Nothing here says a birthday was verified. */
export const AgeReviewDetails: React.FC<{ review: ReviewState }> = ({ review }) => {
  const { attempt, correction, record } = review;
  return (
    <div className="mt-2">
      <span className={`tag ${review.state === 'legacy' || review.state === 'under18-attempt' ? '!text-danger !bg-danger/10' : '!text-lavender'}`}>
        {AGE_REVIEW_LABELS[review.state]}
      </span>
      <dl className="mt-2 space-y-1 text-[length:calc(12px_*_var(--fs,1))]">
        {review.state === 'legacy' && (
          <Row label="Birthday" value="None recorded. Nothing was approved automatically." />
        )}
        {review.approvedBirthDate && (
          <Row label="Approved birthday" value={`${review.approvedBirthDate}${review.currentAge !== null ? ` · age ${review.currentAge}` : ''} · self-reported, not verified`} />
        )}
        {attempt && (
          <Row label="Under-18 entry" value={`${attempt.birthDate ?? 'unknown'}${attempt.age !== null ? ` · age ${attempt.age}` : ''} · tried ${attempt.count}×, never saved as their birthday`} />
        )}
        {correction?.requestedBirthDate && (
          <Row label="Requested" value={`${correction.requestedBirthDate}${correction.requestedAge !== null ? ` · age ${correction.requestedAge}` : ''} · ${correction.requestedEligible ? 'would be eligible' : 'not eligible'}`} />
        )}
        <Row label="Eligibility" value={review.eligible ? 'Eligible (adult birthday saved)' : 'Not eligible: no adult birthday saved'} />
        {record.originalBirthDate && <Row label="Original" value={record.originalBirthDate} />}
        <Row label="Corrections" value={`${record.correctionCount} of ${record.correctionCount + record.correctionsRemaining} used · ${record.rejectedCount} rejected`} />
        {record.previousBirthDates.length > 0 && (
          <Row label="Previous" value={record.previousBirthDates.map((p) => p.birthDate).join(', ')} />
        )}
        {correction?.reason && <Row label="Reason" value={correction.reason} />}
      </dl>
      {(record.manualReview || (correction?.flags.length ?? 0) > 0) && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {record.manualReview && <li className="tag !text-danger !bg-danger/10">{AGE_FLAG_LABELS['repeated-rejections']}</li>}
          {correction?.flags.filter((f) => !(record.manualReview && f === 'repeated-rejections')).map((f) => (
            <li key={f} className="tag !text-danger !bg-danger/10">{AGE_FLAG_LABELS[f] ?? f}</li>
          ))}
        </ul>
      )}
    </div>
  );
};

/** What the admin can do with an age-review item, and the way to the member's support thread. */
export const AgeReviewHelp: React.FC<{ review?: ReviewState | null; onOpenSupport: () => void; onAllow?: () => void }> = ({ review, onOpenSupport, onAllow }) => (
  <div className="mt-2 rounded-xl bg-raised px-3 py-2.5">
    {review ? (
      <AgeReviewDetails review={review} />
    ) : (
      <p className="text-[length:calc(13px_*_var(--fs,1))] leading-snug text-muted">
        {review === undefined ? 'Checking what is on file…' : 'Could not load the birthday status. Try reloading.'}
      </p>
    )}
    <p className="mt-2 text-[length:calc(12px_*_var(--fs,1))] leading-snug text-subtle">
      A submitted birthday is not verified. If they message us, follow up in their support chat. “Allow another try” brings the
      birthday form back for them once.
    </p>
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" onClick={onOpenSupport} className="btn btn-secondary btn-sm">
        <MessageCircleHeart className="w-4 h-4" /> Open support chat
      </button>
      {onAllow && (
        <button type="button" onClick={onAllow} className="btn btn-secondary btn-sm">
          <UserCheck className="w-4 h-4" /> Allow another try
        </button>
      )}
    </div>
  </div>
);

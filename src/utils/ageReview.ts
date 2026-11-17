/** Text of the Reports item a member's age-eligibility review request creates (see ageReviewService.ts). */
export const AGE_REVIEW_REASON =
  'Age eligibility review requested by member after birthday entry. Please review the member’s access eligibility.';

/** True for an age-review item, so the admin Reports list can label it. */
export function isAgeReview(reason: string): boolean {
  return reason.startsWith('Age eligibility review requested');
}

/** The four states an admin sees on an age review, from the server's review state (never from guesses). */
export type AgeReviewStateName = 'correction-pending' | 'under18-attempt' | 'adult-on-file' | 'legacy';

export const AGE_REVIEW_LABELS: Record<AgeReviewStateName, string> = {
  legacy: 'LEGACY / BIRTHDAY NOT RECORDED',
  'under18-attempt': 'UNDER-18 ATTEMPT RECORDED',
  'adult-on-file': 'ADULT BIRTHDAY ON FILE',
  'correction-pending': 'BIRTHDAY CORRECTION PENDING',
};

/** Labels for the flags the server raises on a request. */
export const AGE_FLAG_LABELS: Record<string, string> = {
  'repeated-rejections': 'Repeated rejections: manual review',
  'recent-correction': 'Corrected within the last 30 days',
  'large-change': 'Large change from the approved birthday',
  'last-correction': 'Uses the last allowed correction',
};

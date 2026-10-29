/** Text of the Reports item a member's age-eligibility review request creates (see ageReviewService.ts). */
export const AGE_REVIEW_REASON =
  'Age eligibility review requested by member after birthday entry. Please review the member’s access eligibility.';

/** True for an age-review item, so the admin Reports list can label it. */
export function isAgeReview(reason: string): boolean {
  return reason.startsWith('Age eligibility review requested');
}

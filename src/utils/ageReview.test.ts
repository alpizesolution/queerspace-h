import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AGE_REVIEW_REASON, isAgeReview } from './ageReview.ts';

test('the age-review request text is recognised as an age review', () => {
  assert.equal(isAgeReview(AGE_REVIEW_REASON), true);
});

test('other reports are not labelled as age reviews', () => {
  for (const reason of ['Spam', 'Unsaid: rude post', 'Underage user', 'Please review my age', '']) assert.equal(isAgeReview(reason), false, reason);
});

test('the member app sends exactly the text the admin list looks for', () => {
  const src = fs.readFileSync('src/services/ageReviewService.ts', 'utf8');
  assert.ok(src.includes('reason: AGE_REVIEW_REASON'));
  assert.ok(isAgeReview(AGE_REVIEW_REASON));
});

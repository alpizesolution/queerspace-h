import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AGE_REVIEW_LABELS, AGE_REVIEW_REASON, isAgeReview } from './ageReview.ts';

test('every review state the server can return has a label, and the unconditional "not stored" wording is gone', () => {
  assert.deepEqual(Object.keys(AGE_REVIEW_LABELS).sort(), ['adult-on-file', 'correction-pending', 'legacy', 'under18-attempt']);
  assert.equal(AGE_REVIEW_LABELS.legacy, 'LEGACY / BIRTHDAY NOT RECORDED');
  const marks = fs.readFileSync('src/admin/AgeReviewMarks.tsx', 'utf8');
  assert.equal(/stored, so it can.t be checked/.test(marks), false);
});

test('the age gate sends an under-18 birthday to the server, never to the cloud birthday', () => {
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  assert.ok(app.includes('submitUnderageAttempt(birthDate)'));
  assert.equal(/saveBirthDateOnly\(birthDate\)/.test(app.slice(app.indexOf('age < 18'), app.indexOf('const next = { ...userPrefs, birthDate'))), false);
});

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

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const service = read('src/services/ageReviewService.ts');
const app = read('src/App.tsx');
const inbox = read('src/admin/InboxPages.tsx');
const marks = read('src/admin/AgeReviewMarks.tsx');
const rules = read('firestore.rules');

test('an admin can allow another try from an age-review card, and the report is resolved with it', () => {
  assert.match(marks, /Allow another try/);
  assert.match(inbox, /onAllow=\{\(\) => confirmAllowRetry\(r\)\}/);
  assert.match(inbox, /<AgeReviewHelp[^>]*isAgeReview|isAgeReview\(r\.reason\) && <AgeReviewHelp/, 'only on age-review cards');
  const confirm = inbox.slice(inbox.indexOf('const confirmAllowRetry'), inbox.indexOf('const setStatus'));
  assert.match(confirm, /confirmLabel: 'Allow another try'/, 'asks first');
  assert.match(confirm, /grantAgeReviewClearance\(r\.targetId, r\.id\)/);
  assert.match(confirm, /throw new Error/, 'a failed grant is shown as a failure, not as success');
  assert.ok(confirm.indexOf('grantAgeReviewClearance') < confirm.indexOf("setInboxStatus('reports', r.id, 'resolved')"), 'resolved only after the grant worked');
});

test('the locked member listens for it, and it brings back the birthday form once', () => {
  assert.match(app, /if \(!ageRestricted\) return;\s*return watchAgeReviewClearance\(/);
  const cleared = app.slice(app.indexOf('return watchAgeReviewClearance('), app.indexOf('}, [ageRestricted]);'));
  assert.match(cleared, /setAgeRestricted\(false\)/);
  assert.match(cleared, /setStorageItem\('queerspace_age_restricted', 'false'\)/);
  assert.match(cleared, /setStorageItem\('queerspace_age_review_requested', 'false'\)/, 'a new failure asks the team again');
  assert.match(cleared, /setAgeGateOpen\(true\)/, 'the birthday form, not the app');
  assert.doesNotMatch(cleared, /profileComplete|persistPrefs|birthDate/, 'it never grants access by itself');
});

test('the clearance is used up before it unlocks anything, and only for the member it is for', () => {
  assert.match(service, /deleteDoc\(ref\)\.then\(onCleared,/, 'unlock only after the delete worked');
  assert.match(service, /doc\(db, 'age_review_clearances', user\.uid\)/, 'the member reads only their own');
  assert.match(service, /if \(!snap\.exists\(\) \|\| used\) return;/, 'no double use');
});

test('the rules: admin-signed grant, own-use delete, no listing, and the age rule is untouched', () => {
  const block = rules.slice(rules.indexOf('match /age_review_clearances/{userId}'), rules.indexOf('// 5b. ECHOES'));
  assert.match(block, /allow get: if isOwner\(userId\) \|\| isAdmin\(\);/);
  assert.match(block, /allow create: if isAdmin\(\)/);
  assert.match(block, /clearedBy == request\.auth\.uid/);
  assert.match(block, /clearedAt == request\.time/);
  assert.match(block, /allow delete: if isOwner\(userId\) \|\| isAdmin\(\);/);
  assert.doesNotMatch(block, /allow (read|list|update|write)/, 'no listing, no editing');
  assert.match(rules, /function isAgeEligible\(userId\) \{[^}]*6575, 'd'/, 'an adult birthday is still required to get in');
});

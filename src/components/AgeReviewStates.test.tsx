import '../../test/dom-setup.ts';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { AgeReviewHelp } from '../admin/AgeReviewMarks.tsx';
import type { ReviewState } from '../services/birthdayCorrectionService.ts';

afterEach(cleanup);

const noop = () => {};
const base: ReviewState = {
  uid: 'u1', state: 'legacy', approvedBirthDate: null, currentAge: null, eligible: false, attempt: null, correction: null,
  record: { originalBirthDate: null, previousBirthDates: [], correctionCount: 0, correctionsRemaining: 2, rejectedCount: 0, manualReview: false },
};
const show = (review: ReviewState | null | undefined) => render(<AgeReviewHelp review={review} onOpenSupport={noop} />);
const page = () => document.body.textContent ?? '';

test('the admin card never claims the birthday is not stored without checking: it shows the real state', () => {
  show(base);
  assert.ok(screen.getByText('LEGACY / BIRTHDAY NOT RECORDED'));
  assert.doesNotMatch(page(), /stored, so it can.t be checked/);
  assert.match(page(), /Nothing was approved automatically/);
});

test('under-18 attempt: shows what was typed, says it was never saved, and is labelled', () => {
  show({ ...base, state: 'under18-attempt', attempt: { birthDate: '2012-05-01', age: 14, count: 2, at: null } });
  assert.ok(screen.getByText('UNDER-18 ATTEMPT RECORDED'));
  assert.match(page(), /2012-05-01/);
  assert.match(page(), /never saved as their birthday/);
  assert.match(page(), /Not eligible/);
});

test('adult birthday on file: shows it as self-reported, never as verified', () => {
  show({ ...base, state: 'adult-on-file', approvedBirthDate: '1990-01-01', currentAge: 36, eligible: true });
  assert.ok(screen.getByText('ADULT BIRTHDAY ON FILE'));
  assert.match(page(), /self-reported, not verified/);
  assert.match(page(), /A submitted birthday is not verified/);
});

test('correction pending: shows original, requested, history, counts and flags', () => {
  show({
    ...base, state: 'correction-pending', approvedBirthDate: '1990-01-01', currentAge: 36, eligible: true,
    correction: { status: 'pending', kind: 'correction', requestedBirthDate: '1989-01-01', requestedAge: 37, requestedEligible: true, reason: 'typo', decisionReason: '', flags: ['recent-correction'], createdAt: null, decidedAt: null },
    record: { originalBirthDate: '1991-01-01', previousBirthDates: [{ birthDate: '1991-01-01', replacedAt: null }], correctionCount: 1, correctionsRemaining: 1, rejectedCount: 2, manualReview: true },
  });
  assert.ok(screen.getByText('BIRTHDAY CORRECTION PENDING'));
  for (const part of ['1990-01-01', '1989-01-01', '1991-01-01', '1 of 2 used', '2 rejected', 'typo', 'Repeated rejections: manual review', 'within the last 30 days']) {
    assert.ok(page().includes(part), part);
  }
});

test('loading and failure are stated honestly', () => {
  show(undefined);
  assert.match(page(), /Checking what is on file/);
  cleanup();
  show(null);
  assert.match(page(), /Could not load/);
});

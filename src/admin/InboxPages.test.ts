import test from 'node:test';
import assert from 'node:assert/strict';
import { isUrgentReport, URGENT_REPORT_COUNT } from './InboxPages.tsx';
import type { AdminReport } from '../services/adminInboxService.ts';

const report = (over: Partial<AdminReport> = {}): AdminReport => ({
  id: 'r', reporterId: 'x', targetId: 'u1', targetType: 'user', reason: 'Spammed the room', createdAt: 1, status: 'open', ...over,
});
const AGE = 'Age eligibility review requested by member after birthday entry. Please review the member’s access eligibility.';

test('age reviews, repeat reports and crisis wording are urgent', () => {
  assert.equal(isUrgentReport(report(), 1), false);
  assert.equal(isUrgentReport(report({ reason: AGE }), 1), true);
  assert.equal(isUrgentReport(report(), URGENT_REPORT_COUNT), true);
  assert.equal(isUrgentReport(report({ targetType: 'post', reason: 'they said they want to die' }), 1), true);
});

test('resolved and dismissed reports are never urgent', () => {
  assert.equal(isUrgentReport(report({ reason: AGE, status: 'resolved' }), 5), false);
  assert.equal(isUrgentReport(report({ reason: AGE, status: 'dismissed' }), 5), false);
  assert.equal(isUrgentReport(report({ reason: AGE, status: 'reviewing' }), 1), true);
});

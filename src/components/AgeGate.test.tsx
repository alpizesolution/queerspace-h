import '../../test/dom-setup.ts';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AgeEligibilityGate } from './AgeEligibilityGate.tsx';
import { AgeReviewHelp } from '../admin/AgeReviewMarks.tsx';

afterEach(cleanup);

const noop = () => {};
const yearsAgo = (years: number) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('the birthday step: an empty birthday is refused, a real one is handed on', () => {
  const submitted: string[] = [];
  render(<AgeEligibilityGate onSubmit={(b) => submitted.push(b)} onContactSupport={noop} />);
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));
  assert.deepEqual(submitted, [], 'nothing is sent without a birthday');

  const input = screen.getByLabelText('Birthday');
  fireEvent.change(input, { target: { value: yearsAgo(25) } });
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));
  assert.deepEqual(submitted, [yearsAgo(25)]);
});

test('locked out: no birthday form is offered, only the way to contact the team, and the message says whether a review was sent', () => {
  let contacted = 0;
  const { rerender } = render(<AgeEligibilityGate restricted reviewSubmitted onSubmit={noop} onContactSupport={() => { contacted++; }} />);
  assert.ok(screen.getByText('Not quite yet'));
  assert.equal(screen.queryByLabelText('Birthday'), null, 'no way to type another birthday while locked');
  assert.ok(screen.getByText(/A review request has been sent to our team\./));
  fireEvent.click(screen.getByRole('button', { name: /contact the team/i }));
  assert.equal(contacted, 1);

  rerender(<AgeEligibilityGate restricted reviewSubmitted={false} onSubmit={noop} onContactSupport={noop} />);
  assert.ok(screen.getByText(/We could not submit a review request automatically\./), 'honest when the report did not go through');
});

test('when the team allows another try the same gate shows the birthday form again (restricted off)', () => {
  const { rerender } = render(<AgeEligibilityGate restricted onSubmit={noop} onContactSupport={noop} />);
  assert.equal(screen.queryByLabelText('Birthday'), null);
  rerender(<AgeEligibilityGate restricted={false} onSubmit={noop} onContactSupport={noop} />);
  assert.ok(screen.getByLabelText('Birthday'));
});

test('admin age-review card: "Allow another try" appears only when it can be used, and calls through once per click', () => {
  let opened = 0;
  let allowed = 0;
  const { rerender } = render(<AgeReviewHelp onOpenSupport={() => { opened++; }} />);
  assert.equal(screen.queryByRole('button', { name: /allow another try/i }), null, 'no handler, no button');
  fireEvent.click(screen.getByRole('button', { name: /open support chat/i }));
  assert.equal(opened, 1);

  rerender(<AgeReviewHelp onOpenSupport={() => { opened++; }} onAllow={() => { allowed++; }} />);
  fireEvent.click(screen.getByRole('button', { name: /allow another try/i }));
  assert.equal(allowed, 1);
  assert.equal(opened, 1, 'the two buttons are independent');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SupportUnreadBadge, supportBadgeText } from './SupportUnreadBadge.tsx';

test('badge text: nothing at zero, the number to 9, then 9+', () => {
  assert.equal(supportBadgeText(0), '');
  assert.equal(supportBadgeText(-2), '');
  assert.equal(supportBadgeText(NaN), '');
  assert.equal(supportBadgeText(1), '1');
  assert.equal(supportBadgeText(9), '9');
  assert.equal(supportBadgeText(10), '9+');
  assert.equal(supportBadgeText(250), '9+');
});

test('the badge renders nothing with no unread replies, and a small violet count with them', () => {
  assert.equal(renderToStaticMarkup(<SupportUnreadBadge count={0} />), '');
  const html = renderToStaticMarkup(<SupportUnreadBadge count={3} />);
  assert.match(html, /data-testid="support-unread-badge"/);
  assert.match(html, />3</);
  assert.match(html, /bg-lavender/);
  assert.match(html, /3 new replies from the team/);
  assert.doesNotMatch(html, /animate-/);
});

test('the badge reads "9+" with an accessible name for more than nine', () => {
  const html = renderToStaticMarkup(<SupportUnreadBadge count={14} />);
  assert.match(html, />9\+</);
  assert.match(html, /More than 9 new replies from the team/);
  assert.match(renderToStaticMarkup(<SupportUnreadBadge count={1} />), /1 new reply from the team/);
});

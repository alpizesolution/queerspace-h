import '../../test/dom-setup.ts';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemberAvatar, MemberName, ProfileNavProvider } from './ProfileNav.tsx';

afterEach(cleanup);
const read = (f: string) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const ID = 'uid_Abc12345';

const withNav = (ui: React.ReactElement, opened: string[] = [], onCard?: () => void) =>
  render(
    <ProfileNavProvider value={{ openProfile: (id) => opened.push(id), openPost: () => {} }}>
      <div onClick={onCard} data-testid="card">{ui}</div>
    </ProfileNavProvider>,
  );

test('the name opens that member’s profile, and tapping it does not also trigger the card behind it', () => {
  const opened: string[] = [];
  let cardClicks = 0;
  withNav(<MemberName memberId={ID} name="Luna" />, opened, () => { cardClicks++; });
  fireEvent.click(screen.getByRole('button', { name: 'View Luna’s profile' }));
  assert.deepEqual(opened, [ID]);
  assert.equal(cardClicks, 0, 'no click leaks to the post card');
});

test('the avatar opens the same profile', () => {
  const opened: string[] = [];
  withNav(<MemberAvatar memberId={ID} avatar={null} seed={ID} name="Luna" />, opened);
  fireEvent.click(screen.getByRole('button', { name: 'View Luna’s profile' }));
  assert.deepEqual(opened, [ID]);
});

test('with no usable id (a team message, a missing or malformed author id) or no app around it, the name is plain text', () => {
  for (const id of [null, undefined, '', 'short', 'has spaces and symbols!!']) {
    const view = withNav(<MemberName memberId={id} name="Luna" />);
    assert.equal(screen.queryByRole('button'), null, String(id));
    assert.ok(screen.getByText('Luna'));
    view.unmount();
  }
  render(<MemberName memberId={ID} name="Luna" />);
  assert.equal(screen.queryByRole('button'), null, 'no provider, no button');
});

test('the name keeps its styling classes and gets pointer, hover and focus states', () => {
  withNav(<MemberName memberId={ID} name="Luna" className="min-w-0 truncate font-semibold text-fg" />);
  const cls = screen.getByRole('button').className;
  assert.match(cls, /truncate/);
  assert.match(cls, /cursor-pointer/);
  assert.match(cls, /hover:underline/);
  assert.match(cls, /focus-visible:ring-2/);
});

test('Galaxy posts, replies, Looking For posts and Galaxy room messages all link name and avatar to the existing profile', () => {
  const feed = read('src/components/CommunityFeedView.tsx');
  assert.match(feed, /<MemberName memberId=\{post\.authorId\}/);
  assert.match(feed, /<MemberName memberId=\{reply\.authorId\}/);
  assert.match(feed, /<MemberAvatar memberId=\{post\.authorId\}/);
  assert.match(read('src/components/LookingForView.tsx'), /<MemberName memberId=\{post\.authorId\}/);
  const room = read('src/components/PublicRoomView.tsx');
  assert.match(room, /<MemberAvatar memberId=\{msg\.authorId\}/);
  assert.match(room, /<MemberName memberId=\{msg\.team \? null : msg\.authorId\}/, 'team messages are never linked');
});

test('no new profile page, route or data source: navigation goes through the one existing opener', () => {
  const nav = read('src/components/ProfileNav.tsx');
  assert.doesNotMatch(nav, /fetch\(|firestore|getDoc|collection\(/i);
  assert.equal((nav.match(/nav\.openProfile/g) || []).length, 2, 'avatar and name both call the existing opener');
});

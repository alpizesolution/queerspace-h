import '../../test/dom-setup.ts';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LookingForComposer } from './LookingForComposer.tsx';
import { PostTypeChooser } from './PostTypeChooser.tsx';

afterEach(cleanup);

const prefs = { displayName: 'Me', pronouns: 'she/her', intention: 'open', topics: [], region: 'Anywhere', birthDate: '1995-01-01', profileComplete: true } as never;

test('the chooser names both kinds with the agreed descriptions and marks the current one', () => {
  const picked: string[] = [];
  render(<PostTypeChooser value="community" onChange={(k) => picked.push(k)} />);
  assert.ok(screen.getByText('Share something, start a discussion, or tell the community about an event.'));
  assert.ok(screen.getByText('Find friends, dates, activity partners, or someone to connect with.'));
  assert.equal(screen.getByRole('radio', { name: /Community Post/ }).getAttribute('aria-checked'), 'true');
  fireEvent.click(screen.getByRole('radio', { name: /Community Post/ }));
  assert.deepEqual(picked, [], 'choosing the current kind does nothing');
  fireEvent.click(screen.getByRole('radio', { name: /Looking For Post/ }));
  assert.deepEqual(picked, ['lookingFor']);
});

test('the Looking For composer starts from carried-over words and offers the new intents', () => {
  render(<LookingForComposer userPrefs={prefs} editing={null} initial={{ title: 'Book club', intro: 'I love sapphic novels' }} ownPostIds={[]} uid="me" onClose={() => {}} onSaved={() => {}} onSwitchToCommunity={() => {}} />);
  assert.equal((screen.getByLabelText('Title') as HTMLInputElement).value, 'Book club');
  assert.equal((screen.getByLabelText('About me') as HTMLTextAreaElement).value, 'I love sapphic novels');
  const intents = screen.getAllByRole('radio', { name: /Friendship|Dating|Activity buddy|Gaming buddy|Travel buddy/ }).map((r) => r.textContent);
  assert.deepEqual(intents, ['Friendship', 'Dating / R4R', 'Activity buddy', 'Gaming buddy', 'Travel buddy']);
});

test('switching to Community from Looking For hands back what was typed', () => {
  let carried: { title: string; content: string } | null = null;
  render(<LookingForComposer userPrefs={prefs} editing={null} ownPostIds={[]} uid="me" onClose={() => {}} onSaved={() => {}} onSwitchToCommunity={(d) => { carried = d; }} />);
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Movie night' } });
  fireEvent.change(screen.getByLabelText('About me'), { target: { value: 'I host cozy nights' } });
  fireEvent.change(screen.getByLabelText('About you'), { target: { value: 'Bring snacks' } });
  fireEvent.click(screen.getByRole('radio', { name: /Community Post/ }));
  assert.deepEqual(carried, { title: 'Movie night', content: 'I host cozy nights\n\nBring snacks' });
});

test('editing an existing post does not offer a switch, and an older intention stays selectable on that post', () => {
  const post = { id: 'me_talk', authorId: 'me', author: 'Me', authorPronouns: '', title: 'Hi', intro: 'x'.repeat(100), lookingFor: 'y'.repeat(100), intention: 'talk', tags: [], isNsfw: false, contentWarning: null, requestsPaused: false, timestamp: 1 } as never;
  render(<LookingForComposer userPrefs={prefs} editing={post} ownPostIds={['me_talk']} uid="me" onClose={() => {}} onSaved={() => {}} onSwitchToCommunity={() => {}} />);
  assert.equal(screen.queryByRole('radio', { name: /Community Post/ }), null);
  assert.equal(screen.getByRole('radio', { name: 'Someone to talk to' }).getAttribute('aria-checked'), 'true');
});

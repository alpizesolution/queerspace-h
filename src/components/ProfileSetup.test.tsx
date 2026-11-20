import '../../test/dom-setup.ts';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProfileEditorSheet } from './ProfileEditorSheet.tsx';
import { ProfileSetupGate } from './ProfileSetupGate.tsx';
import type { UserPreferences } from '../types.ts';

afterEach(cleanup);
const read = (f: string) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

const prefs: UserPreferences = { displayName: 'Violet Lark', pronouns: 'she/her', intention: 'open', topics: [], region: 'Anywhere / Worldwide' };

test('setup mode shows the generated name at once and a Save and continue button, with no close button and no Edit-only sections', () => {
  render(<ProfileEditorSheet mode="setup" currentPrefs={prefs} onClose={() => {}} onSave={() => {}} />);
  assert.equal((screen.getByLabelText('Display name') as HTMLInputElement).value, 'Violet Lark');
  assert.ok(screen.getByRole('button', { name: 'Save and continue' }));
  assert.equal(screen.queryByRole('button', { name: /close/i }), null, 'cannot be dismissed');
  assert.ok(screen.getByTestId('profile-setup-intro'));
  assert.ok(screen.getByRole('button', { name: /Generate a random pseudonym/ }), 'the name can be re-rolled');
  assert.ok(screen.getByLabelText(/About Me/), 'bio is there, optional');
  assert.ok(screen.getByRole('button', { name: /Shuffle your anonymous avatar/ }), 'avatar is there');
  assert.equal(screen.queryByText('Personal Style'), null);
  assert.equal(screen.queryByText('SOGIE', { exact: false, selector: 'p.label' }), null);
});

test('edit mode is unchanged: it can be closed, says Save profile and still has every section', () => {
  let closed = 0;
  render(<ProfileEditorSheet currentPrefs={prefs} onClose={() => { closed++; }} onSave={() => {}} />);
  assert.ok(screen.getByRole('button', { name: 'Save profile' }));
  assert.ok(screen.getByText('Personal Style'));
  assert.ok(screen.getByText('SOGIE', { exact: false, selector: 'p.label' }));
  fireEvent.keyDown(window, { key: 'Escape' });
  assert.equal(closed, 1);
});

test('Escape does not dismiss setup', () => {
  let closed = 0;
  render(<ProfileEditorSheet mode="setup" currentPrefs={prefs} onClose={() => { closed++; }} onSave={() => {}} />);
  fireEvent.keyDown(window, { key: 'Escape' });
  assert.equal(closed, 0);
  assert.ok(screen.getByRole('button', { name: 'Save and continue' }));
});

test('the display name is required: too short is refused and nothing is saved', () => {
  const saved: unknown[] = [];
  render(<ProfileEditorSheet mode="setup" currentPrefs={prefs} onClose={() => {}} onSave={(p) => { saved.push(p); }} />);
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: ' a ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
  assert.match(screen.getByRole('alert').textContent ?? '', /at least 2 characters/);
  assert.equal(saved.length, 0);
});

test('a valid, edited name is saved with the optional bio left empty if skipped', () => {
  const saved: Array<{ displayName: string; aboutMe: string }> = [];
  render(<ProfileEditorSheet mode="setup" currentPrefs={prefs} onClose={() => {}} onSave={(p) => { saved.push(p as never); }} />);
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Moon Fern' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].displayName, 'Moon Fern');
  assert.equal(saved[0].aboutMe, '');
});

test('a failed save keeps the form open with the reason, and Save and continue works again afterwards', async () => {
  let calls = 0;
  render(<ProfileEditorSheet mode="setup" currentPrefs={prefs} onClose={() => {}} onSave={async () => { calls++; return calls === 1 ? 'That name is taken.' : undefined; }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
  await waitFor(() => assert.match(screen.getByRole('alert').textContent ?? '', /That name is taken/));
  await waitFor(() => assert.equal((screen.getByTestId('profile-save') as HTMLButtonElement).disabled, false));
  fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
  await waitFor(() => assert.equal(calls, 2));
});

test('the gate shows the form when the account has been checked, a wait screen while it is being checked, and a retry (never a form) when the check failed', () => {
  const props = { prefs, onSave: async () => {} };
  const { rerender } = render(<ProfileSetupGate {...props} load="loading" />);
  assert.ok(screen.getByTestId('profile-setup-wait'));
  assert.equal(screen.queryByLabelText('Display name'), null);
  rerender(<ProfileSetupGate {...props} load="failed" />);
  assert.ok(screen.getByRole('button', { name: /Try again/ }));
  assert.equal(screen.queryByLabelText('Display name'), null, 'no form that could overwrite an existing profile');
  rerender(<ProfileSetupGate {...props} load="ready" />);
  assert.ok(screen.getByLabelText('Display name'));
});

test('the app is guarded as a whole: with no saved profile, nothing but the setup screen is rendered, and no sign-in method was added', () => {
  const app = read('src/App.tsx');
  assert.match(app, /const profileSetupRequired = !ageGateOpen && !ageRestricted && userPrefs\.profileComplete !== true;/);
  const guard = app.indexOf('if (profileSetupRequired) {');
  const tree = app.indexOf('<ProfileNavProvider value={profileNav}>');
  assert.ok(guard > 0 && guard < tree, 'the guard returns before the app tree is built');
  const guarded = app.slice(guard, tree);
  assert.match(guarded, /<ProfileSetupGate/);
  assert.equal(/<Header|<BottomNavigation|<AtlasPage|<SignalsView|<main/.test(guarded), false, 'no app screen behind the guard');
  // the age gate still comes first and an unreadable account is never treated as a new one
  assert.match(app, /setProfileLoad\(res\.cloudError \? 'failed' : 'ready'\)/);
  assert.equal(/GoogleAuthProvider|createUserWithEmailAndPassword|signInWithPopup/.test(app + read('src/components/ProfileSetupGate.tsx') + read('src/components/ProfileEditorSheet.tsx')), false);
});

test('an unreadable cloud account is reported as an error, not as "no profile yet"', () => {
  const svc = read('src/services/profilePersistence.ts');
  assert.match(svc, /fromCloudSuccess: false,\n\s+cloudError: true,/);
});

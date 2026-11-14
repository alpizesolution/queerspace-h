import '../../test/dom-setup.ts';
import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * Pictures in Support Chat on the real components, with only the services replaced: an attach button with a preview, Send and Remove,
 * a sending state, NO timer anywhere, pictures shown in the conversation for both the member and the team, and the Signals
 * timed-photo timer left exactly as it was.
 */
let messages: Array<Record<string, unknown>> = [];
const sends: Array<{ id: string; threadId?: string; size: number }> = [];
let outcome: { ok: true; id: string } | { ok: false; reason: string } = { ok: true, id: 'x' };
let hold: Promise<void> | null = null;

mock.module('../lib/firebase.ts', { namedExports: { auth: { currentUser: { uid: 'me-member-1', getIdToken: async () => 'token' } }, db: null, ensureAnonymousAuth: async () => null } });
mock.module('../services/supportService.ts', {
  namedExports: {
    SUPPORT_MAX_LENGTH: 1000, TEAM_NAME: 'QUEERSPACE Team',
    getMySupportThreadId: async () => 'me-member-1',
    markSupportReadByUser: async () => {},
    sendSupportMessage: async () => 'sent',
    subscribeToSupportMessages: (_id: string, onMessages: (m: unknown[]) => void) => { onMessages(messages); return () => {}; },
  },
});
mock.module('../services/supportImageService.ts', {
  namedExports: {
    SUPPORT_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
    prepareSupportImage: async (file: Blob) => (['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ? file : null),
    sendSupportImage: async (blob: Blob, id: string, threadId?: string) => { sends.push({ id, threadId, size: blob.size }); if (hold) await hold; return outcome; },
    supportImageProblemText: (r: string) => `problem:${r}`,
    fetchSupportImage: async (thread: string, message: string) => `blob:${thread}/${message}`,
  },
});
const { SupportChat } = await import('./SupportChat.tsx');
const { SupportImageAttach } = await import('./SupportImage.tsx');

afterEach(() => { cleanup(); sends.length = 0; hold = null; outcome = { ok: true, id: 'x' }; });
(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
URL.createObjectURL = () => 'blob:preview';
URL.revokeObjectURL = () => {};

const chat = () => render(<SupportChat userPrefs={{ displayName: 'Luna' } as never} onClose={() => {}} onOpenSuggestions={() => {}} />);
const pick = async (file: File) => { fireEvent.change(await screen.findByTestId('support-file'), { target: { files: [file] } }); };
const png = () => new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' });

test('Support Chat has an attach button; choosing a picture shows a preview with Send and Remove, and NO timer or duration choice', async () => {
  messages = [];
  chat();
  assert.ok(await screen.findByRole('button', { name: 'Attach a picture' }));
  await pick(png());
  const preview = await screen.findByTestId('support-preview');
  assert.ok(preview.querySelector('img'));
  assert.ok(screen.getByRole('button', { name: 'Send the picture' }));
  assert.ok(screen.getByRole('button', { name: 'Remove the picture' }));
  assert.match(preview.textContent ?? '', /stays in the chat/);
  const page = document.body.textContent ?? '';
  assert.doesNotMatch(page, /\b\d+\s?s(ec|econds)?\b|timer|self-destruct|disappear|expire/i, 'no duration selector, no expiry wording');
  assert.equal(document.querySelectorAll('[role=radiogroup], [role=radio]').length, 0);
});

test('Send hands the picture over once with a stable id; the preview shows a sending state and clears on success', async () => {
  messages = [];
  let release: () => void = () => {};
  hold = new Promise<void>((resolve) => { release = resolve; });
  chat();
  await pick(png());
  const send = await screen.findByRole('button', { name: 'Send the picture' });
  fireEvent.click(send);
  fireEvent.click(send);
  assert.equal(sends.length, 1, 'a second tap while sending does nothing');
  assert.match(screen.getByTestId('support-preview').textContent ?? '', /Sending your picture/);
  assert.equal((screen.getByRole('button', { name: 'Send the picture' }) as HTMLButtonElement).disabled, true);
  await act(async () => { release(); });
  await waitFor(() => assert.equal(screen.queryAllByTestId('support-preview').length, 0));
  assert.equal(sends[0].threadId, undefined, 'a member sends into their own thread');
  assert.ok(sends[0].id.length >= 8);
});

test('a failed send shows the reason, keeps the picture, and the retry reuses the same message id', async () => {
  messages = [];
  outcome = { ok: false, reason: 'failed' };
  chat();
  await pick(png());
  fireEvent.click(await screen.findByRole('button', { name: 'Send the picture' }));
  await screen.findByText('problem:failed');
  assert.ok(screen.getByTestId('support-preview'), 'the picture is still there to retry');
  outcome = { ok: true, id: 'x' };
  fireEvent.click(screen.getByRole('button', { name: 'Send the picture' }));
  await waitFor(() => assert.equal(sends.length, 2));
  assert.equal(sends[0].id, sends[1].id);
});

test('a file that is not a JPEG, PNG or WebP is refused with a message and nothing is previewed or sent', async () => {
  messages = [];
  chat();
  await pick(new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }));
  await screen.findByText('problem:type');
  assert.equal(screen.queryAllByTestId('support-preview').length, 0);
  assert.equal(sends.length, 0);
});

test('Remove discards the chosen picture without sending', async () => {
  messages = [];
  chat();
  await pick(png());
  fireEvent.click(await screen.findByRole('button', { name: 'Remove the picture' }));
  assert.equal(screen.queryAllByTestId('support-preview').length, 0);
  assert.equal(sends.length, 0);
});

test('pictures in the conversation show for the member\'s own messages and the team\'s, alongside ordinary text', async () => {
  messages = [
    { id: 'm1', from: 'user', text: '📷 Photo', timestamp: 1, image: { width: 8, height: 8 } },
    { id: 'm2', from: 'team', text: '📷 Photo', timestamp: 2, image: { width: 8, height: 8 } },
    { id: 'm3', from: 'team', text: 'Thanks, we can see it.', timestamp: 3 },
  ];
  chat();
  const images = await screen.findAllByTestId('support-image');
  assert.equal(images.length, 2);
  assert.deepEqual(images.map((i) => i.getAttribute('src')), ['blob:me-member-1/m1', 'blob:me-member-1/m2']);
  assert.ok(await screen.findByText('Thanks, we can see it.'));
  assert.equal(screen.queryAllByText('📷 Photo').length, 0, 'the picture, not the placeholder text');
});

test('the team side sends into the chosen member\'s thread', async () => {
  render(<SupportImageAttach threadId="member-thread-9" onProblem={() => {}} />);
  await pick(png());
  fireEvent.click(await screen.findByRole('button', { name: 'Send the picture' }));
  await waitFor(() => assert.equal(sends.length, 1));
  assert.equal(sends[0].threadId, 'member-thread-9');
});

test('the admin Support tab uses the same attach control and shows pictures, and the Signals timed-photo timer is untouched', () => {
  const admin = fs.readFileSync('src/admin/SupportTab.tsx', 'utf8');
  assert.match(admin, /<SupportImageAttach threadId=\{thread\.id\}/);
  assert.match(admin, /<SupportImage threadId=\{thread\.id\}/);
  const attach = fs.readFileSync('src/components/SupportImage.tsx', 'utf8');
  assert.equal(/timer|duration|PHOTO_TIMERS|timerSeconds/i.test(attach.replace(/\/\*[\s\S]*?\*\//g, '')), false, 'no timer code in the support attach control');
  const conversation = fs.readFileSync('src/components/SignalsConversation.tsx', 'utf8');
  assert.match(conversation, /<TimedPhotoComposer/, 'Signals still uses the timed photo composer');
  const composer = fs.readFileSync('src/components/TimedPhotoComposer.tsx', 'utf8');
  assert.match(composer, /timer/i, 'with its timer');
});

import '../../test/dom-setup.ts';
import test, { mock, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';

/** GIFs in Signals stand alone on the conversation background; text, photos, cards and everything else keep their bubbles. */
mock.module('../lib/firebase.ts', { namedExports: { auth: { currentUser: { uid: 'alice', getIdToken: async () => 'token' } }, db: null } });
mock.module('../utils/sound.ts', { namedExports: { soundEffects: { playMessageSent() {}, playMessageReceived() {} } } });
const { SignalsConversation } = await import('./SignalsConversation.tsx');
const { GifBubble, bubbleWidth } = await import('./GifPicker.tsx');

const gif = { id: 'abc123XYZ', url: 'https://media.giphy.com/media/abc123XYZ/giphy.gif', previewUrl: 'https://media.giphy.com/media/abc123XYZ/200w.gif', stillUrl: 'https://media.giphy.com/media/abc123XYZ/480w_s.jpg', width: 400, height: 300, previewWidth: 200, previewHeight: 150, title: 'dance' };
const msg = (id: string, senderId: string, extra: Record<string, unknown> = {}) => ({ id, senderId, text: 'hi', createdAt: `2026-01-01T10:0${id.length}:00.000Z`, replyTo: null, reactions: [], ...extra });
let messages: Record<string, unknown>[] = [];

beforeEach(() => {
  (Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};
  (window as unknown as { matchMedia: unknown }).matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.fetch = (async (url: string) => ({ ok: true, status: 200, json: async () => (String(url).includes('view=messages') ? { messages, cursor: new Date().toISOString() } : {}) })) as unknown as typeof fetch;
});
afterEach(cleanup);

const show = async () => {
  render(<SignalsConversation pairId="pair-12345678" partner={{ displayName: 'Luna', avatar: null }} onBack={() => {}} />);
  await screen.findAllByRole('button', { name: /message: .*Show actions/ }, { timeout: 5000 });
};
const bubbleOf = (label: RegExp) => screen.getByRole('button', { name: label });
const hasSurface = (el: HTMLElement) => /bg-berry|bg-raised|border-line|px-3|py-1\.5/.test(el.className.replace(/focus-visible:[^ ]+/g, ''));

test('a sent and a received GIF have no coloured bubble, padding or border; the picture, its attribution and the time are all still there', async () => {
  messages = [msg('m1', 'alice', { kind: 'gif', text: 'GIF', gif }), msg('m22', 'bob', { kind: 'gif', text: 'GIF', gif })];
  await show();
  const [mine, theirs] = screen.getAllByRole('button', { name: /message: GIF\. Show actions/ });
  for (const bubble of [mine, theirs]) {
    assert.equal(hasSurface(bubble), false, bubble.className);
    assert.ok(within(bubble).getByAltText('GIF: dance'));
    assert.ok(within(bubble).getByText('GIF · via GIPHY'));
    assert.match(bubble.textContent ?? '', /\d{1,2}:\d{2}/, 'the time stays with the GIF');
  }
});

test('the GIF keeps its own size, ratio and rounded corners', async () => {
  messages = [msg('m1', 'alice', { kind: 'gif', text: 'GIF', gif })];
  await show();
  const frame = screen.getByAltText('GIF: dance').parentElement as HTMLElement;
  assert.match(frame.className, /rounded-xl/);
  assert.equal(frame.style.aspectRatio.replace(/\s/g, ''), '400/300');
  assert.equal(frame.style.width, `${bubbleWidth(gif)}px`, 'the same width as before (the existing sizing rule)');
});

test('alignment: a sent GIF and its time sit to the right, a received one to the left', async () => {
  messages = [msg('m1', 'alice', { kind: 'gif', text: 'GIF', gif }), msg('m22', 'bob', { kind: 'gif', text: 'GIF', gif })];
  await show();
  const [mine, theirs] = screen.getAllByRole('button', { name: /message: GIF\. Show actions/ });
  assert.match((mine.firstElementChild as HTMLElement).className, /items-end/);
  assert.match((theirs.firstElementChild as HTMLElement).className, /items-start/);
  assert.match(mine.closest('.flex.justify-end') ? 'end' : '', /end/);
  assert.ok(theirs.closest('.flex.justify-start'));
});

test('the time and the attribution are readable on the plain background (muted text, not text meant for a coloured bubble)', async () => {
  messages = [msg('m1', 'alice', { kind: 'gif', text: 'GIF', gif })];
  await show();
  const bubble = bubbleOf(/message: GIF\. Show actions/);
  const time = [...bubble.querySelectorAll('span')].find((s) => /^\d{1,2}:\d{2}/.test(s.textContent ?? ''))!;
  assert.match(time.className, /text-muted/);
  assert.doesNotMatch(time.className, /text-ink/, 'ink-on-pink text would vanish on the dark background');
  assert.match(within(bubble).getByText('GIF · via GIPHY').className, /text-muted/);
});

test('text messages keep their bubbles, both sent and received', async () => {
  messages = [msg('m1', 'alice', { text: 'hello' }), msg('m22', 'bob', { text: 'hi there' })];
  await show();
  assert.match(bubbleOf(/Your message: hello/).className, /bg-berry/);
  assert.match(bubbleOf(/Luna's message: hi there/).className, /bg-raised/);
});

test('a GIF that answers another message keeps its bubble, so the quote has a surface', async () => {
  messages = [msg('m1', 'bob', { text: 'look at this' }), msg('m22', 'alice', { kind: 'gif', text: 'GIF', gif, replyTo: { messageId: 'm1', senderId: 'bob', text: 'look at this' } })];
  await show();
  const bubble = bubbleOf(/message: GIF\. Show actions/);
  assert.match(bubble.className, /bg-berry/);
  assert.ok(within(bubble).getByAltText('GIF: dance'));
});

test('reactions and the actions row still work on a bare GIF', async () => {
  messages = [msg('m1', 'bob', { kind: 'gif', text: 'GIF', gif, reactions: [{ emoji: '💜', count: 1, userReacted: false }] })];
  await show();
  assert.ok(screen.getByRole('button', { name: /💜 reaction, 1 total/ }));
  const bubble = bubbleOf(/message: GIF\. Show actions/);
  bubble.click();
  assert.ok(await screen.findByRole('button', { name: 'Reply to message' }, { timeout: 5000 }));
});

test('a GIF that cannot load says so in plain text, still without a bubble', async () => {
  messages = [msg('m1', 'alice', { kind: 'gif', text: 'GIF', gif })];
  await show();
  screen.getByAltText('GIF: dance').dispatchEvent(new Event('error'));
  assert.ok(await screen.findByText('GIF unavailable', {}, { timeout: 5000 }));
  assert.equal(hasSurface(bubbleOf(/message: GIF\. Show actions/)), false);
});

test('Galaxy rooms are unchanged: GifBubble is only bare when asked, and keeps its faded attribution otherwise', () => {
  const { container } = render(<GifBubble gif={gif} mine={false} />);
  assert.match(container.textContent ?? '', /GIF · via GIPHY/);
  assert.match(container.querySelector('span.select-none')!.className, /opacity-60/);
  assert.doesNotMatch(fs.readFileSync('src/components/PublicRoomView.tsx', 'utf8'), /bare=/);
});

test('the change is scoped: only GIF messages without a reply take the bare path, and sending, loading and GIPHY code are untouched', () => {
  const convo = fs.readFileSync('src/components/SignalsConversation.tsx', 'utf8').replace(/\r\n/g, '\n');
  assert.match(convo, /const bareGif = message\.kind === 'gif' && Boolean\(message\.gif\) && !message\.replyTo;/);
  assert.equal((convo.match(/bareGif/g) || []).length >= 5, true);
  for (const file of ['src/services/gifService.ts', 'src/utils/gif.ts', 'api/_giphy.js']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /bare/i, `${file} is not part of this change`);
  }
});

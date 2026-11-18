import '../../test/dom-setup.ts';
import test, { mock, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

/** The sticker picker and the sticker message inside the real Signals conversation. */
mock.module('../lib/firebase.ts', { namedExports: { auth: { currentUser: { uid: 'alice', getIdToken: async () => 'token' } }, db: null } });
mock.module('../utils/sound.ts', { namedExports: { soundEffects: { playMessageSent() {}, playMessageReceived() {} } } });
const { SignalsConversation } = await import('./SignalsConversation.tsx');

const msg = (id: string, senderId: string, extra: Record<string, unknown> = {}) => ({ id, senderId, text: 'hi', createdAt: `2026-01-01T10:0${id.length}:00.000Z`, replyTo: null, reactions: [], ...extra });
let messages: Record<string, unknown>[] = [];
let posts: Record<string, unknown>[] = [];
const store = new Map<string, string>();

beforeEach(() => {
  posts = [];
  store.clear();
  (globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  (Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};
  (window as unknown as { matchMedia: unknown }).matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body ?? '{}');
      posts.push(body);
      return { ok: true, status: 201, json: async () => ({ id: body.messageId, senderId: 'alice', text: 'Sticker', kind: 'sticker', sticker: { id: body.stickerId, packId: String(body.stickerId).replace(/-\d+$/, '') }, replyTo: null, reactions: [], createdAt: new Date().toISOString() }) };
    }
    return { ok: true, status: 200, json: async () => (String(url).includes('view=messages') ? { messages, cursor: new Date().toISOString() } : {}) };
  }) as unknown as typeof fetch;
});
afterEach(cleanup);

const open = async () => {
  render(<SignalsConversation pairId="pair-12345678" partner={{ displayName: 'Luna', avatar: null }} onBack={() => {}} />);
  await screen.findByRole('button', { name: 'Send a sticker' }, { timeout: 5000 });
};

test('a received sticker is drawn as its picture from the app, with no coloured bubble; text and the GIF button are still there', async () => {
  messages = [msg('m1', 'bob', { text: 'hello there' }), msg('m22', 'bob', { kind: 'sticker', text: 'Sticker', sticker: { id: 'sapphic-feelings-02', packId: 'sapphic-feelings' } })];
  await open();
  const img = (await screen.findByAltText(/Sticker: kilig ako/)) as HTMLImageElement;
  assert.equal(img.getAttribute('src'), '/stickers/sapphic-feelings/02_kilig_ako.png');
  const bubble = screen.getByRole('button', { name: /message: Sticker\. Show actions/ });
  assert.equal(/bg-berry|bg-raised|border-line|px-3|py-1\.5/.test(bubble.className.replace(/focus-visible:[^ ]+/g, '')), false, bubble.className);
  assert.ok(screen.getByText('hello there'));
  assert.ok(screen.getByRole('button', { name: 'Send a GIF' }));
});

test('an unknown or After Dark sticker id in a stored message is never drawn', async () => {
  messages = [msg('m1', 'bob', { kind: 'sticker', text: 'x', sticker: { id: 'after-dark-01', packId: 'after-dark' } })];
  await open();
  // (The server already refuses such a record on read-back; this is the app's own second check.)
  await screen.findByText('Sticker unavailable');
  assert.equal(document.querySelectorAll('img[src*="stickers"]').length, 0);
});

test('the picker shows the two regular collections plus Recent and Favorites, and no After Dark anywhere', async () => {
  messages = [];
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Send a sticker' }));
  const tabs = within(await screen.findByRole('tablist', { name: 'Sticker collections' })).getAllByRole('tab').map((t) => t.textContent);
  assert.deepEqual(tabs, ['Recent', 'Favorites', 'Sapphic Feelings', 'Androgynous Sapphic']);
  assert.equal(/after dark|18\+|adult/i.test(document.body.textContent ?? ''), false);
  assert.equal((await screen.findAllByRole('button', { name: /^Preview sticker:/ })).length, 20);
  fireEvent.click(screen.getByRole('tab', { name: 'Androgynous Sapphic' }));
  assert.equal(screen.getAllByRole('button', { name: /^Preview sticker:/ }).length, 20);
  assert.equal(document.querySelectorAll('img[src*="after-dark"]').length, 0);
});

test('empty states for Recent and Favorites', async () => {
  messages = [];
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Send a sticker' }));
  await screen.findByRole('tablist');
  fireEvent.click(screen.getByRole('tab', { name: 'Recent' }));
  assert.ok(await screen.findByText('Stickers you send will show up here.'));
  fireEvent.click(screen.getByRole('tab', { name: 'Favorites' }));
  assert.ok(screen.getByText('No favorites yet'));
});

test('choosing a sticker previews it, sending posts ONLY the id, closes the picker and shows it at once; it then appears under Recent', async () => {
  messages = [];
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Send a sticker' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Preview sticker: delulu' }));
  assert.ok(screen.getByText('Send this sticker?'));
  fireEvent.click(screen.getByRole('button', { name: 'Send sticker' }));
  assert.equal(screen.queryByRole('dialog'), null, 'the picker closes');
  await screen.findByAltText(/Sticker: delulu/);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(posts.length, 1);
  const { messageId, ...sent } = posts[0] as Record<string, unknown>;
  assert.equal(typeof messageId, 'string');
  assert.deepEqual(sent, { action: 'send-message', pairId: 'pair-12345678', kind: 'sticker', stickerId: 'sapphic-feelings-05' });
  assert.equal(document.querySelectorAll('img[alt^="Sticker:"]').length, 1, 'no duplicate while it sends');
  fireEvent.click(screen.getByRole('button', { name: 'Send a sticker' }));
  assert.equal((await screen.findAllByRole('button', { name: /^Preview sticker:/ })).length, 1, 'Recent holds the one just sent');
});

test('a favorite can be added in the preview and is kept under Favorites', async () => {
  messages = [];
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Send a sticker' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Preview sticker: kilig ako' }));
  fireEvent.click(screen.getByRole('button', { name: /Add to favorites/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Favorites' }));
  assert.equal(screen.getAllByRole('button', { name: /^Preview sticker:/ }).length, 1);
});

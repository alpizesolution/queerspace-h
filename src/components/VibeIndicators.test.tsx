import '../../test/dom-setup.ts';
import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';

/**
 * The small Current Vibe indicator in the Signals conversation header and in Seek (the same hook). The real service and hook run
 * against a stand-in server, so what is checked is what the screen does with the server's answer: a chip only when the server
 * returned a live status, nothing when it returned none (blocked, hidden by the member's setting, expired, or never set), never on
 * individual messages, and gone the moment an open screen reaches the status's expiry.
 */
mock.module('../lib/firebase.ts', { namedExports: { auth: { currentUser: { uid: 'alice', getIdToken: async () => 'token' } }, db: null } });
mock.module('../utils/sound.ts', { namedExports: { soundEffects: { playMessageSent() {}, playMessageReceived() {} } } });
const { SignalsConversation } = await import('./SignalsConversation.tsx');
const { useMemberVibe } = await import('../hooks/useMemberVibe.ts');
const { clearVibeCache } = await import('../services/currentVibeService.ts');

const NOW = Date.now();
const vibeAnswer = (over: Record<string, unknown> = {}) => ({ emoji: '🌙', message: 'taking it slow', updatedAt: new Date(NOW - 3_600_000).toISOString(), expiresAt: new Date(NOW + 23 * 3_600_000).toISOString(), ...over });
let vibeBody: unknown = { vibe: null };
let vibeStatus = 200;
const asked: string[] = [];
const messages = [
  { id: 'm1', senderId: 'bob', text: 'hello there', createdAt: '2026-01-01T10:00:00.000Z', replyTo: null, reactions: [] },
  { id: 'm22', senderId: 'alice', text: 'hi!', createdAt: '2026-01-01T10:01:00.000Z', replyTo: null, reactions: [] },
];

beforeEach(() => {
  clearVibeCache();
  asked.length = 0; vibeBody = { vibe: null }; vibeStatus = 200;
  (Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};
  (window as unknown as { matchMedia: unknown }).matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    asked.push(u);
    const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data }) as Response;
    if (u.includes('view=vibe')) return json(vibeBody, vibeStatus);
    if (u.includes('view=messages')) return json({ messages, cursor: new Date().toISOString() });
    return json({});
  }) as typeof fetch;
});
afterEach(cleanup);

const show = async (partnerId: string | null = 'bob-member-12') => {
  render(<SignalsConversation pairId="pair-12345678" partner={{ displayName: 'Luna', avatar: null }} partnerId={partnerId ?? undefined} onBack={() => {}} />);
  await screen.findByText('hello there', {}, { timeout: 5000 });
};
const header = () => screen.getByRole('heading', { level: 1 }).parentElement as HTMLElement;

test('Signals: a live status shows as a small chip beside the name in the header only, with the full status as its tooltip', async () => {
  vibeBody = { vibe: vibeAnswer() };
  await show();
  const chip = await within(header()).findByTestId('vibe-chip', {}, { timeout: 5000 });
  assert.equal(chip.textContent, '🌙taking it slow');
  assert.match(chip.getAttribute('title') ?? '', /taking it slow/);
  assert.equal(screen.getAllByTestId('vibe-chip').length, 1, 'one chip: not one on every message');
  assert.equal(screen.getAllByText('taking it slow').length, 1, 'the status appears once on the whole screen');
  assert.ok(asked.some((u) => u.includes('view=vibe&memberId=bob-member-12')), 'asked the server about this member');
});

test('Signals: when the server returns no status (hidden by their setting, blocked, expired or never set) there is no chip and no gap', async () => {
  vibeBody = { vibe: null };
  await show();
  await waitFor(() => assert.ok(asked.some((u) => u.includes('view=vibe'))));
  assert.ok(screen.queryByTestId('vibe-chip') === null);
});

test('Signals: a failed lookup shows nothing, and a status that has already expired is never shown even if the server sent it', async () => {
  vibeBody = { error: 'internal_error' }; vibeStatus = 500;
  await show();
  await waitFor(() => assert.ok(asked.some((u) => u.includes('view=vibe'))));
  assert.ok(screen.queryByTestId('vibe-chip') === null);
  cleanup(); clearVibeCache();
  vibeStatus = 200; vibeBody = { vibe: vibeAnswer({ expiresAt: new Date(NOW - 1000).toISOString() }) };
  await show();
  await waitFor(() => assert.ok(asked.filter((u) => u.includes('view=vibe')).length >= 2));
  assert.ok(screen.queryByTestId('vibe-chip') === null);
});

test('Signals: a malformed answer shows nothing rather than a broken chip', async () => {
  vibeBody = { vibe: { emoji: '🌙', updatedAt: 'x', expiresAt: 'y' } };
  await show();
  await waitFor(() => assert.ok(asked.some((u) => u.includes('view=vibe'))));
  assert.ok(screen.queryByTestId('vibe-chip') === null);
});

test('Signals: no member id (an older caller) means no lookup at all', async () => {
  await show(null);
  assert.equal(asked.some((u) => u.includes('view=vibe')), false);
});

const Probe: React.FC<{ id: string | null }> = ({ id }) => {
  const vibe = useMemberVibe(id);
  return <p data-testid="probe">{vibe ? `${vibe.emoji} ${vibe.message}` : 'none'}</p>;
};

test('the hook (Seek and Signals): shows a live status, then drops it at the moment it expires, with no further request', async () => {
  // A real, short expiry: the status is live now and ends 700 ms from now.
  vibeBody = { vibe: vibeAnswer({ expiresAt: new Date(Date.now() + 700).toISOString() }) };
  render(<Probe id="bob-member-12" />);
  await waitFor(() => assert.equal(screen.getByTestId('probe').textContent, '🌙 taking it slow'));
  const requests = asked.length;
  await waitFor(() => assert.equal(screen.getByTestId('probe').textContent, 'none'), { timeout: 3000 });
  assert.equal(asked.length, requests, 'no new request was needed to take it down');
});

test('the hook: moving to another member never shows the previous member\'s status', async () => {
  vibeBody = { vibe: vibeAnswer() };
  const view = render(<Probe id="bob-member-12" />);
  await waitFor(() => assert.equal(screen.getByTestId('probe').textContent, '🌙 taking it slow'));
  vibeBody = { vibe: null };
  view.rerender(<Probe id="carol-member-1" />);
  assert.equal(screen.getByTestId('probe').textContent, 'none', 'cleared at once, before the new answer');
  await waitFor(() => assert.ok(asked.some((u) => u.includes('carol-member-1'))));
  assert.equal(screen.getByTestId('probe').textContent, 'none');
});

test('the hook remembers an answer for a minute, so reopening chats does not ask again each time', async () => {
  vibeBody = { vibe: vibeAnswer() };
  const first = render(<Probe id="bob-member-12" />);
  await waitFor(() => assert.equal(screen.getByTestId('probe').textContent, '🌙 taking it slow'));
  first.unmount();
  render(<Probe id="bob-member-12" />);
  await waitFor(() => assert.equal(screen.getByTestId('probe').textContent, '🌙 taking it slow'));
  assert.equal(asked.filter((u) => u.includes('view=vibe')).length, 1);
});

test('Seek: the chat header shows the partner\'s status beside their name through the same server-checked lookup, and never on messages', () => {
  const src = fs.readFileSync('src/components/ChatView.tsx', 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /const partnerVibe = useMemberVibe\(partner\.id\);/);
  assert.equal((src.match(/<VibeChip /g) || []).length, 1, 'one chip, in the header');
  const header = src.slice(src.indexOf('{partner.displayName}</h1>') - 200, src.indexOf('{partner.displayName}</h1>') + 200);
  assert.match(header, /partnerVibe && <VibeChip vibe=\{partnerVibe\}/);
  assert.doesNotMatch(src.slice(src.indexOf('messages.map')), /VibeChip/, 'not inside the message list');
});

test('no other area changes: Cosmos, Galaxy and posts carry no mood indicator, and Seek matching is untouched', () => {
  for (const file of ['src/components/CommunityFeedView.tsx', 'src/components/PublicRoomView.tsx', 'src/components/LookingForView.tsx', 'src/services/liveMatchService.ts', 'src/utils/matching-logic.ts', 'api/match.js', 'api/_matching.js']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /VibeChip|useMemberVibe|currentVibe|CurrentVibe/, file);
  }
});

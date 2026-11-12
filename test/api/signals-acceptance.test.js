import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FieldValue } from 'firebase-admin/firestore';
import { acceptedNotification, touchInbox } from '../../api/signals.js';

const api = fs.readFileSync('api/signals.js', 'utf8');
const view = fs.readFileSync('src/components/SignalsView.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const sheet = fs.readFileSync('src/components/Sheet.tsx', 'utf8');
const hook = fs.readFileSync('src/hooks/useSignalsInbox.ts', 'utf8');

test('the acceptance notification is keyed by the connection id, unread, and carries no identity', () => {
  const note = acceptedNotification('pair-1234abcd');
  assert.deepEqual(Object.keys(note), ['notifications']);
  assert.deepEqual(Object.keys(note.notifications), ['pair-1234abcd']);
  const entry = note.notifications['pair-1234abcd'];
  assert.equal(entry.type, 'accepted');
  assert.equal(entry.read, false);
  assert.ok(entry.createdAt, 'a server timestamp is set');
  assert.deepEqual(Object.keys(entry).sort(), ['createdAt', 'read', 'type']);
});

test('touchInbox adds the notification to the same write as the revision bump', () => {
  const writes = [];
  const tx = { set: (ref, data, options) => writes.push({ ref, data, options }) };
  const db = { doc: (path) => path };
  touchInbox(tx, db, 'sender1', undefined, acceptedNotification('pair-1'));
  touchInbox(tx, db, 'recipient1', { x: 1 });
  assert.equal(writes[0].ref, 'signalsInbox/sender1');
  assert.ok(writes[0].data.notifications['pair-1']);
  assert.ok(writes[0].data.rev, 'the sender is still woken by the revision bump');
  assert.deepEqual(writes[0].options, { merge: true });
  assert.equal(writes[1].data.notifications, undefined, 'the recipient gets no notification');
  assert.ok(FieldValue.increment);
});

test('only the accept branch writes the notification, in the same transaction that creates the pair', () => {
  // Defined once; used when the pair is created, and when the two already had an active conversation (which is reused, not duplicated).
  assert.equal((api.match(/acceptedNotification\(/g) || []).length, 3);
  const accept = api.slice(api.indexOf("if (action === 'accept')"), api.indexOf("const nextStatus"));
  assert.match(accept, /tx\.create\(pairRef/);
  assert.match(accept, /existingPair\.empty[\s\S]*resolved\(acceptedNotification\(existingId\)\)/, 'an existing active conversation is reused, never duplicated');
  assert.match(accept, /resolved\(acceptedNotification\(invitationId\)\)/);
  const rest = api.slice(api.indexOf("const nextStatus"));
  assert.doesNotMatch(rest, /acceptedNotification/, 'decline / revoke never notify');
  assert.match(accept, /declined[\s\S]*resolved\(\);/, 'a blocked acceptance resolves without a notification');
});

test('the invitation card is a single button that opens the dialog, with no inline Accept or Decline', () => {
  const cards = view.slice(view.indexOf('{pendingReceived.map('), view.indexOf('{pendingSent.map('));
  assert.match(cards, /<button[\s\S]*setSelectedInvitationId\(invitation\.id\)/);
  assert.match(cards, /ChevronRight/);
  assert.match(cards, /line-clamp-1/, 'a short message preview');
  assert.match(cards, /formatShortDate\(invitation\.createdAt\)/);
  assert.doesNotMatch(cards, /Accept|Decline/);
});

test('the invitation dialog shows sender, date and the full message, with Accept, Decline and Close', () => {
  const dialog = view.slice(view.indexOf('{selectedInvitation && ('), view.indexOf('{privacyOpen && ('));
  assert.match(dialog, /<Sheet[\s\S]*trapFocus/);
  assert.match(dialog, /PartnerAvatar/);
  assert.match(dialog, /nameOf\(selectedInvitation\.partner\)/);
  assert.match(dialog, /formatShortDate\(selectedInvitation\.createdAt\)/);
  assert.match(dialog, /\{selectedInvitation\.message\}/, 'the complete message, not a preview');
  assert.match(dialog, /btn btn-primary[^>]*>\s*\{invitationAction === 'accept' \? 'Accepting…' : 'Accept'\}/);
  assert.match(dialog, /btn btn-ghost[^>]*>\s*\{invitationAction === 'decline' \? 'Declining…' : 'Decline'\}/);
  assert.match(dialog, /role="alert"/);
});

test('closing the dialog (Escape, backdrop, X) never answers the invitation, and cannot interrupt a submit', () => {
  assert.match(sheet, /e\.key === 'Escape'\) onClose\(\)/);
  assert.match(sheet, /e\.target === e\.currentTarget/);
  const close = view.slice(view.indexOf('const closeInvitation'), view.indexOf('/** Opens a conversation'));
  assert.doesNotMatch(close, /signalsRequest|respondToInvitation|answerFromDialog/);
  assert.match(close, /if \(answeringRef\.current\) return;/, 'reads a ref: Sheet keeps the onClose it opened with');
  assert.match(view, /answeringRef\.current = invitationActionId !== null;/);
});

test('accept and decline reuse the existing actions, block double submits and keep the invitation on failure', () => {
  assert.equal((view.match(/signalsRequest<\{ status: string \}>\('\/api\/signals', \{ action, invitationId/g) || []).length, 1, 'one request path for accept / decline / revoke');
  assert.match(view, /if \(invitationActionId !== null\) return null;/);
  const answer = view.slice(view.indexOf('const answerFromDialog'), view.indexOf('const closeInvitation'));
  assert.match(answer, /if \(failure\) setInvitationError\(failure\);\s*else setSelectedInvitationId\(null\);/);
  assert.match(answer, /respondToInvitation\(invitation, action\)/);
});

test('the dialog traps focus only when asked, so other dialogs behave as before', () => {
  assert.match(sheet, /trapFocus = false/);
  assert.match(sheet, /trapFocus && e\.key === 'Tab'/);
});

test('a notification opens its conversation: card, banner and tab badge all lead to the connection id', () => {
  assert.match(view, /Connection request accepted!/);
  assert.match(view, /accepted your connection request\. You can now start chatting on QUEERSPACE\./);
  assert.match(view, /onClick=\{\(\) => openPair\(pair\.id\)\}/);
  assert.match(view, /action: 'ack-notification', pairId/);
  assert.match(app, /Connection request accepted!/);
  assert.match(app, /setSignalsOpenPairId\(acceptedAlert\.pairId\); handleNavigate\('signals'\)/);
  assert.match(app, /requestedPairId=\{signalsOpenPairId\}/);
  assert.equal((app.match(/signalsInbox\.pendingIds\.length \+ signalsInbox\.acceptedUnread\.length/g) || []).length, 1, 'unread acceptances count on the tab badge (one shared total)');
  assert.equal((app.match(/signals: signalsBadge/g) || []).length, 2, 'the header and the bottom navigation both show that total');
  assert.match(view, /if \(pair\.status === 'active'\) openPair\(pair\.id\);/);
});

test('the live feed announces each acceptance once and stays quiet for ones already waiting at start-up', () => {
  assert.match(hook, /takeNewIds\(next\.acceptedUnread, seenAccepted\)/);
  assert.match(hook, /if \(!first\) accepted\.forEach/);
});

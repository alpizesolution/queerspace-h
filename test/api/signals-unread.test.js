// The latest-message line and the unread counter that go with every Signals message: what is written, for whom, and where the
// app reads and shows them. (The same flow against real emulators is in signals-unread.integration.test.js.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PREVIEW_MAX, inboxWritesForMessage, previewText } from '../../api/_inbox.js';

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('a preview is one short line; GIFs and cards say what they are', () => {
  assert.equal(previewText('  hello   there\n friend ', 'text'), 'hello there friend');
  assert.equal(previewText('x'.repeat(300), 'text').length, PREVIEW_MAX);
  assert.ok(previewText('word '.repeat(60), 'text').endsWith('…'));
  assert.equal(previewText('GIF', 'gif'), 'GIF');
  assert.equal(previewText('What does home mean to you?', 'card'), 'Comfort Card: What does home mean to you?');
  assert.equal(previewText(undefined, 'text'), '');
  assert.equal(previewText('📷 Photo', 'photo'), '📷 Photo');
});

test('a message writes one unread to the OTHER person only, and the latest line to both, marked mine or not', () => {
  const increment = (n) => ({ inc: n });
  const writes = inboxWritesForMessage({ pairId: 'pair1', preview: 'hi', stamp: 'T', increment });
  assert.deepEqual(writes.recipient, { unread: { pair1: { inc: 1 } }, last: { pair1: { text: 'hi', mine: false, at: 'T' } } });
  assert.deepEqual(writes.sender, { last: { pair1: { text: 'hi', mine: true, at: 'T' } } });
  assert.equal('unread' in writes.sender, false, 'your own message never counts as unread for you');
});

test('text, GIF, card and photo sends all use the same inbox writes, in the same batch as the message', () => {
  const signals = read('api/signals.js');
  const send = signals.slice(signals.indexOf("if (action === 'send-message')"), signals.indexOf("if (action === 'mark-read')"));
  assert.ok(send.includes('batch.create(messageRef,'));
  assert.ok(send.includes("inboxWritesForMessage({ pairId, preview: previewText(text, isGif ? 'gif' : isCard ? 'card' : 'text'), stamp, increment: FieldValue.increment })"));
  assert.ok(send.includes('batch.set(db.doc(`signalsInbox/${otherUid}`), writes.recipient, { merge: true });'));
  assert.ok(send.includes('batch.set(db.doc(`signalsInbox/${uid}`), writes.sender, { merge: true });'));
  assert.ok(send.indexOf('writes.sender') < send.indexOf('await batch.commit()'), 'committed together');
  const media = read('api/_media.js');
  assert.ok(media.includes("inboxWritesForMessage({ pairId, preview: previewText(PHOTO_TEXT, 'photo')"));
  assert.ok(media.includes('writes.recipient, { merge: true }'));
});

test('reading stays what it was: opening a conversation recounts from the newest message the reader saw, in one transaction', () => {
  const signals = read('api/signals.js');
  const mark = signals.slice(signals.indexOf("if (action === 'mark-read')"), signals.indexOf("if (action === 'ack-notification')"));
  assert.ok(mark.includes('db.runTransaction'));
  assert.ok(mark.includes('countUnread(later.docs.map(snap => snap.data()), otherUid)'));
  assert.ok(mark.includes('unread: { [pairId]: unread > 0 ? unread : FieldValue.delete() }'));
  assert.equal(mark.includes('last:'), false, 'reading never rewrites the latest-message line');
});

test('the inbox row shows the preview, a compact circular count and a quiet highlight, and the list is sorted by activity', () => {
  const view = read('src/components/SignalsView.tsx');
  assert.ok(view.includes("sortByActivity(pairs.filter((pair) => pair.status === 'active'), inbox?.unread ?? {}, inbox?.last ?? {})"));
  assert.ok(view.includes('const latest = inbox?.last[pair.id];'));
  assert.ok(view.includes('{latest.mine && <span className="text-subtle">You: </span>}{latest.text}'));
  assert.ok(view.includes("unreadText ? 'bg-berry/[0.07]' : ''"), 'unread rows are tinted');
  assert.match(view, /data-testid="unread-badge"[^>]*className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-berry/, 'a compact circle');
  assert.ok(view.includes('Since {formatShortDate(pair.createdAt)}'), 'a connection with no messages yet keeps its old line');
});

test('the tab badge and the inbox read the same live listener: one listener, no message reads', () => {
  const app = read('src/App.tsx');
  assert.equal((app.match(/useSignalsInbox\(/g) || []).length, 1, 'one listener for the whole app');
  assert.ok(app.includes('totalUnread(signalsInbox.unread, openSignalsPair)'));
  assert.ok(app.includes("const openSignalsPair = currentView === 'signals' && signalsChatVisible ? signalsResumePairId : null;"));
  const inbox = read('src/services/signalsInbox.ts');
  assert.equal((inbox.match(/onSnapshot\(/g) || []).length, 1, 'the service opens exactly one snapshot');
  assert.equal(/collection\(|getDocs\(/.test(inbox), false, 'no message is ever read to count');
});

test('signalsInbox stays readable by its owner only and writable by nobody on the client', () => {
  const rules = read('firestore.rules');
  const block = rules.slice(rules.indexOf('match /signalsInbox/{userId}'), rules.indexOf('match /signalsInbox/{userId}') + 200);
  assert.match(block, /allow read: if isOwner\(userId\);\s*allow write: if false;/);
});

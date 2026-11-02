import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const view = fs.readFileSync('src/components/SignalsView.tsx', 'utf8');
const chat = fs.readFileSync('src/components/SignalsConversation.tsx', 'utf8');
const activeRows = view.slice(view.indexOf('{activePairs.map('), view.indexOf('Past" count'));

test('an Active row is one button that opens the chat, with hover, pressed and focus states', () => {
  assert.match(activeRows, /<button[^>]*onClick=\{\(\) => setOpenPairId\(pair\.id\)\}/s);
  assert.match(activeRows, /hover:bg-raised/);
  assert.match(activeRows, /active:bg-raised/);
  assert.match(activeRows, /focus-visible:ring-2/);
  assert.match(activeRows, /min-h-16/, 'comfortable touch target');
});

test('Active rows no longer carry End or Open buttons, and keep avatar, name, date and unread badge', () => {
  assert.doesNotMatch(activeRows, />\s*End\s*</);
  assert.doesNotMatch(activeRows, />\s*Open\s*</);
  assert.doesNotMatch(activeRows, /setPairToEnd/);
  assert.match(activeRows, /PartnerAvatar/);
  assert.match(activeRows, /\{name\}/);
  assert.match(activeRows, /formatShortDate\(pair\.createdAt\)/);
  assert.match(activeRows, /\{unreadText\}/);
});

test('ending is handed to the chat and reuses the existing end action', () => {
  assert.match(view, /onEnd=\{\(\) => endPair\(openPairId\)\}/);
  assert.match(view, /action: 'end',\s*pairId/);
  assert.equal((view.match(/action: 'end'/g) || []).length, 1, 'one end implementation');
  assert.doesNotMatch(view, /ConfirmDialog/);
});

test('the chat header has an options menu with a danger End Conversation item behind a confirmation', () => {
  assert.match(chat, /aria-label="Conversation options"/);
  assert.match(chat, /aria-haspopup="menu"/);
  assert.match(chat, /role="menuitem"[\s\S]*?text-danger[\s\S]*?End Conversation/);
  assert.match(chat, /setConfirmEnd\(true\)/);
  assert.match(chat, /<ConfirmDialog[\s\S]*tone="danger"/);
  // The action runs only from the dialog's confirm button, never from the menu item.
  assert.match(chat, /onConfirm=\{\(\) => void confirmEndConversation\(\)\}/);
  assert.equal((chat.match(/await onEnd\(\)/g) || []).length, 1);
  assert.match(chat, /Escape/);
});

test('ending shows progress, blocks double submits and reports failures inside the dialog', () => {
  assert.match(chat, /if \(!onEnd \|\| endBusy\) return;/);
  assert.match(chat, /busy=\{endBusy\}/);
  assert.match(chat, /role="alert"[^>]*>\{endError\}/);
});

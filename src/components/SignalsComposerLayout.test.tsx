import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync('src/components/SignalsConversation.tsx', 'utf8').replace(/\r\n/g, '\n');
const form = src.slice(src.indexOf('<form onSubmit={sendMessage}'), src.indexOf('</form>'));

test('the composer placeholder is exactly "Message..."', () => {
  assert.match(form, /placeholder="Message\.\.\."/);
  assert.doesNotMatch(src, /Write a message/);
});

test('the input is one line by default and still auto-grows up to a cap', () => {
  assert.match(form, /rows=\{1\}/);
  assert.match(form, /max-h-28/);
  assert.match(src, /Math\.min\(el\.scrollHeight, 112\)/);
});

test('attachments are one left-aligned, non-wrapping group in the order photo, GIF, Comfort Cards, Two Truths and a Lie', () => {
  const group = form.slice(form.lastIndexOf('<div', form.indexOf('role="group"')));
  assert.match(group, /flex-nowrap/);
  const photo = group.indexOf('Send a timed photo');
  const gif = group.indexOf('Send a GIF');
  const cards = group.indexOf('aria-label="Comfort Cards"');
  const game = group.indexOf('aria-label="Two Truths and a Lie"');
  assert.ok(photo > 0 && gif > photo && cards > gif && game > cards);
  assert.doesNotMatch(group, /rounded-full|border border-line/, 'no circular backgrounds around the icons');
  assert.equal((group.match(/h-10 w-10/g) || []).length, 4, 'same 40px touch target');
  assert.equal((group.match(/h-5 w-5/g) || []).length, 4, 'same icon size');
  assert.equal((group.match(/focus-visible:ring-2/g) || []).length, 4);
});

test('the send button is separate from the attachments, beside the input, and keeps its disabled state', () => {
  const send = form.indexOf('aria-label="Send message"');
  assert.ok(send > form.indexOf('id="signals-message"') && send < form.indexOf('role="group"'));
  assert.match(form, /type="submit" disabled=\{!draft\.trim\(\)\}/);
  assert.match(form, /rounded-full bg-berry text-ink/);
});

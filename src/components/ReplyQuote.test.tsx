import '../../test/dom-setup.ts';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReplyQuote } from './ReplyQuote.tsx';

afterEach(cleanup);
const read = (f: string) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const LONG = 'Starlight_Wanderer_Of_The_Quiet_Galaxy_Room_2024';

test('the quoted username and text are single-line with an ellipsis, and the full text stays in the label', () => {
  render(<ReplyQuote author={LONG} text="a very long quoted message that goes on" onClick={() => {}} />);
  const author = screen.getByTestId('reply-quote-author');
  const text = screen.getByTestId('reply-quote-text');
  for (const el of [author, text]) {
    assert.match(el.className, /whitespace-nowrap/);
    assert.match(el.className, /overflow-hidden/);
    assert.match(el.className, /text-ellipsis/);
  }
  assert.equal(author.textContent, LONG, 'the name is never shortened in the DOM');
  assert.ok(screen.getByRole('button', { name: `Replying to ${LONG}: a very long quoted message that goes on` }));
});

test('no opacity-faded text colours, and the quote takes the bubble width without adding to it', () => {
  render(<ReplyQuote author="Luna" text="hi" tone="plum" onClick={() => {}} />);
  const btn = screen.getByRole('button');
  assert.match(btn.className, /w-0 min-w-full/);
  for (const el of [screen.getByTestId('reply-quote-author'), screen.getByTestId('reply-quote-text')]) {
    assert.doesNotMatch(el.className, /text-[a-z]+\/\d+|opacity-/);
  }
});

test('clicking the quote jumps to the original, and without a handler it is plain text', () => {
  let jumped = 0;
  const view = render(<ReplyQuote author="Luna" text="hi" onClick={() => { jumped++; }} />);
  fireEvent.click(screen.getByRole('button'));
  assert.equal(jumped, 1);
  view.unmount();
  render(<ReplyQuote author="Luna" text="hi" />);
  assert.equal(screen.queryByRole('button'), null);
  assert.ok(screen.getByRole('group', { name: 'Replying to Luna: hi' }));
});

test('the Galaxy room, Seek chat and Signals all use the shared quote, and the old clamp markup is gone', () => {
  for (const f of ['PublicRoomView', 'ChatView', 'SignalsConversation']) {
    const src = read(`src/components/${f}.tsx`);
    assert.match(src, /<ReplyQuote/, f);
    assert.doesNotMatch(src, /line-clamp-2 \[overflow-wrap:anywhere\]">\{msg\.replyTo/, f);
  }
  const room = read('src/components/PublicRoomView.tsx');
  assert.match(room, /name=\{msg\.author\} className="min-w-0 truncate whitespace-nowrap font-semibold text-fg"/, 'the sender name above a bubble never wraps');
  assert.match(room, /replyTo!\.id\)\}/, 'jump-to-original is still wired');
});

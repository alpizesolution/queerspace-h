import '../../test/dom-setup.ts';
import test, { mock, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React, { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KEYBOARD_WAIT_MS, useComposerFocus } from './useComposerFocus.ts';

/** A tiny screen with the same pieces as Seek chat: a message to "reply to", the message box, and the tap fallback. */
let afterFocusCalls = 0;
let focusOptions: unknown[] = [];
let loseFocusOnRequest = false;

function Harness({ coarse }: { coarse: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const focus = useComposerFocus(ref, { coarsePointer: coarse, afterFocus: () => { afterFocusCalls++; } });
  return (
    <div>
      <button onClick={() => { focus.requestFocus(); if (loseFocusOnRequest) ref.current?.blur(); }}>reply</button>
      <textarea ref={ref} aria-label="Message" onBlur={focus.dismissHint} onChange={focus.dismissHint} />
      {focus.needsTap && <button onClick={focus.tapToType}>Tap to type your reply</button>}
    </div>
  );
}

class FakeViewport {
  height = 800;
  private listeners = new Set<() => void>();
  addEventListener(_type: string, fn: () => void) { this.listeners.add(fn); }
  removeEventListener(_type: string, fn: () => void) { this.listeners.delete(fn); }
  resize(height: number) { this.height = height; [...this.listeners].forEach((fn) => fn()); }
}
let viewport: FakeViewport | null;

beforeEach(() => {
  afterFocusCalls = 0; focusOptions = []; loseFocusOnRequest = false;
  viewport = new FakeViewport();
  Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  const proto = window.HTMLTextAreaElement.prototype;
  const realFocus = proto.focus;
  mock.method(proto, 'focus', function (this: HTMLTextAreaElement, options?: unknown) { focusOptions.push(options); return realFocus.call(this, options as never); });
  mock.timers.enable({ apis: ['setTimeout'] });
});
afterEach(() => { cleanup(); mock.timers.reset(); mock.restoreAll(); });

const box = () => screen.getByLabelText('Message') as HTMLTextAreaElement;
const reply = () => fireEvent.click(screen.getByRole('button', { name: 'reply' }));
const hint = () => screen.queryByRole('button', { name: 'Tap to type your reply' });

test('swiping to reply focuses the real message box, without letting the page scroll', () => {
  render(<Harness coarse={false} />);
  assert.notEqual(document.activeElement, box());
  reply();
  assert.equal(document.activeElement, box());
  assert.deepEqual(focusOptions[0], { preventScroll: true });
});

test('after the screen has drawn, the layout is settled once (keep the latest message and composer in view)', () => {
  render(<Harness coarse={false} />);
  reply();
  assert.equal(afterFocusCalls, 1);
});

test('if the reply bar drawing cost the box its focus, it is given back once', () => {
  loseFocusOnRequest = true;
  render(<Harness coarse={false} />);
  reply();
  assert.equal(document.activeElement, box());
});

test('focus is never taken again by itself: a member who closes the keyboard is left alone', () => {
  const view = render(<Harness coarse={false} />);
  reply();
  act(() => box().blur());
  for (let i = 0; i < 5; i++) view.rerender(<Harness coarse={false} />);
  assert.notEqual(document.activeElement, box());
  assert.equal(afterFocusCalls, 1);
  assert.equal(focusOptions.length, 1);
});

test('desktop never shows the tap fallback', () => {
  render(<Harness coarse={false} />);
  reply();
  act(() => mock.timers.tick(KEYBOARD_WAIT_MS * 2));
  assert.equal(hint(), null);
});

test('touch, keyboard opens: no fallback', () => {
  render(<Harness coarse />);
  reply();
  act(() => viewport!.resize(480));
  act(() => mock.timers.tick(KEYBOARD_WAIT_MS * 2));
  assert.equal(hint(), null);
});

test('touch, browser refuses to raise the keyboard (focused but no keyboard): the one-tap fallback appears, and works', () => {
  render(<Harness coarse />);
  reply();
  assert.equal(hint(), null, 'not before the browser has had its chance');
  act(() => mock.timers.tick(KEYBOARD_WAIT_MS));
  assert.ok(hint(), 'the fallback shows');
  assert.equal(document.activeElement, box(), 'the box stays focused');
  act(() => { fireEvent.click(hint()!); });
  assert.equal(hint(), null, 'tapping it hides it');
  assert.equal(document.activeElement, box());
});

test('touch, the member already had the keyboard up: nothing to raise, no fallback', () => {
  viewport!.height = 420; // keyboard already open
  render(<Harness coarse />);
  reply();
  act(() => mock.timers.tick(KEYBOARD_WAIT_MS * 2));
  assert.equal(hint(), null);
});

test('touch, the member closes the box before the wait is over: no fallback', () => {
  render(<Harness coarse />);
  reply();
  act(() => box().blur());
  act(() => mock.timers.tick(KEYBOARD_WAIT_MS * 2));
  assert.equal(hint(), null);
});

test('the fallback goes away when the member starts typing or leaves the box', () => {
  render(<Harness coarse />);
  reply();
  act(() => mock.timers.tick(KEYBOARD_WAIT_MS));
  assert.ok(hint());
  fireEvent.change(box(), { target: { value: 'hi' } });
  assert.equal(hint(), null);
});

test('no visual viewport to check (older browsers): no nagging', () => {
  Object.defineProperty(window, 'visualViewport', { value: null, configurable: true });
  render(<Harness coarse />);
  reply();
  act(() => mock.timers.tick(KEYBOARD_WAIT_MS * 2));
  assert.equal(hint(), null);
});

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** How long to wait for the on-screen keyboard to show up after a touch device was asked to focus the composer. */
export const KEYBOARD_WAIT_MS = 700;
/** A visible-height drop of at least this much means the keyboard opened. */
const KEYBOARD_MIN_DROP_PX = 100;

interface Options {
  /** A phone or tablet: only these have an on-screen keyboard that the browser may refuse to raise. */
  coarsePointer: boolean;
  /** Runs once the composer has been focused and the screen has settled, e.g. to keep the latest message in view. */
  afterFocus?: () => void;
}

/**
 * Focusing the message box on purpose, for example when a message is swiped to reply.
 *
 *  - `requestFocus()` is called from the gesture itself (iOS only raises the keyboard for focus() inside a touch or click
 *    handler), and again right after React has drawn whatever the action added (the "Replying to" bar), if focus was lost.
 *  - It never runs again by itself: a member who closes the keyboard, or goes elsewhere, is left alone.
 *  - On a touch device it checks whether the keyboard really appeared. Browsers (iOS Safari especially) may focus the field
 *    without raising it; then `needsTap` turns true so the screen can offer a clear one-tap fallback, `tapToType()`, which is
 *    a real tap and so is allowed to open the keyboard.
 */
export function useComposerFocus(inputRef: RefObject<HTMLTextAreaElement | null>, { coarsePointer, afterFocus }: Options) {
  const [request, setRequest] = useState(0);
  const [needsTap, setNeedsTap] = useState(false);
  const after = useRef(afterFocus);
  after.current = afterFocus;

  const focusNow = useCallback(() => {
    // preventScroll: the page must not jump; the layout (visual viewport) already keeps the composer in view.
    inputRef.current?.focus({ preventScroll: true });
  }, [inputRef]);

  const requestFocus = useCallback(() => {
    setNeedsTap(false);
    focusNow();
    setRequest((n) => n + 1);
  }, [focusNow]);

  const tapToType = useCallback(() => {
    setNeedsTap(false);
    focusNow();
  }, [focusNow]);

  const dismissHint = useCallback(() => setNeedsTap(false), []);

  // After the screen has drawn what the action added: make sure the composer has focus, and settle the layout.
  useLayoutEffect(() => {
    if (request === 0) return;
    const input = inputRef.current;
    if (!input) return;
    if (document.activeElement !== input) input.focus({ preventScroll: true });
    after.current?.();
  }, [request, inputRef]);

  // Touch devices: did the keyboard appear? If not, offer the tap.
  useEffect(() => {
    if (request === 0 || !coarsePointer) return;
    const input = inputRef.current;
    if (!input) return;
    const viewport = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!viewport) return; // no way to tell, and no reason to nag
    const before = viewport.height;
    // The keyboard was already up (the member was typing): nothing to raise.
    if (typeof window.innerHeight === 'number' && before < window.innerHeight - KEYBOARD_MIN_DROP_PX) return;

    let settled = false;
    const finish = () => {
      settled = true;
      viewport.removeEventListener('resize', onResize);
      clearTimeout(timer);
    };
    const onResize = () => {
      if (before - viewport.height >= KEYBOARD_MIN_DROP_PX) finish(); // the keyboard opened
    };
    const timer = setTimeout(() => {
      if (settled) return;
      finish();
      // Still focused but no keyboard: the browser refused to raise it. (If the member closed the field, say nothing.)
      if (document.activeElement === inputRef.current) setNeedsTap(true);
    }, KEYBOARD_WAIT_MS);
    viewport.addEventListener('resize', onResize);
    return () => {
      if (!settled) finish();
    };
  }, [request, coarsePointer, inputRef]);

  return { requestFocus, needsTap, tapToType, dismissHint };
}

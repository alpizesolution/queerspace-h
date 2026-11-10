import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file: string) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

/** Seek chat, Galaxy room and the Signals inbox conversation all reply the same way: through the shared composer-focus hook. */
for (const [name, file, ref] of [
  ['Seek chat', 'src/components/ChatView.tsx', 'inputRef'],
  ['Galaxy room', 'src/components/PublicRoomView.tsx', 'inputRef'],
  ['Signals conversation', 'src/components/SignalsConversation.tsx', 'textareaRef'],
] as const) {
  test(`${name}: every way of starting a reply goes through the shared focus hook, and nothing focuses the box on its own`, () => {
    const src = read(file);
    assert.ok(src.includes(`useComposerFocus(${ref}, {`), 'the hook is set up on the real message box');
    assert.match(src, /composerFocus\.requestFocus\(\)/, 'a reply asks for focus through the hook');
    assert.equal(src.includes(`${ref}.current?.focus()`) && /setReplyingTo\([^)]*\); setActiveId\(null\); [a-zA-Z]+\.current\?\.focus\(\)/.test(src), false, 'no direct, unchecked focus after starting a reply');
    assert.match(src, /composerFocus\.needsTap/, 'the one-tap fallback is offered');
    assert.match(src, /Tap to type your reply/);
    assert.match(src, /composerFocus\.dismissHint/, 'the fallback goes away on typing or leaving the box');
    assert.match(src, /afterFocus:[\s\S]*scrollToBottom\(false\)/, 'the latest message stays in view');
  });
}

test('the hook does not run by itself: it has no effect that focuses without a request', () => {
  const hook = read('src/hooks/useComposerFocus.ts');
  assert.match(hook, /if \(request === 0\) return;/);
  assert.equal((hook.match(/\.focus\(/g) || []).length, 2, 'the only places that focus: the shared focus (also used by the tap), and after drawing');
});

test('Signals invitations, the Signals inbox list and message delivery are untouched by the focus change', () => {
  const src = read('src/components/SignalsConversation.tsx');
  assert.equal(/sendMessage[\s\S]{0,40}composerFocus/.test(src), false);
  assert.match(src, /onSubmit=\{sendMessage\}/);
});

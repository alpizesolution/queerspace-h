// Signals conversation on a phone: the app header is hidden inside a conversation (the conversation has its own), the bottom tab bar
// stays, and nothing changes on the inbox, other pages or a desktop. These read the source because the layout is pure CSS and wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const css = read('src/index.css');
const app = read('src/App.tsx');
const header = read('src/components/Header.tsx');
const view = read('src/components/SignalsView.tsx');
const convo = read('src/components/SignalsConversation.tsx');

const NON_DESKTOP = '@media (max-width: 1023px), (pointer: coarse) and (max-width: 1439px), (pointer: none) and (max-width: 1439px) {';

test('the app header is hidden only inside a Signals conversation, and only on phones and tablets', () => {
  const at = css.indexOf("[data-signals-chat='open'] [data-app-header]");
  assert.ok(at > 0, 'the rule exists');
  const media = css.lastIndexOf('@media', at);
  assert.equal(css.slice(media, css.indexOf('{', media) + 1), NON_DESKTOP, 'inside the same "not a desktop" test the tab-bar rule uses');
  assert.match(css.slice(at, at + 120), /display: none/);
  // Nothing outside that media query mentions the hidden state, so a desktop is untouched.
  const outside = css.slice(0, media) + css.slice(css.indexOf('}\n}', at) + 3);
  assert.equal(outside.includes("[data-signals-chat='open']"), false);
});

test('the bottom tab bar is never hidden by this, and typing behaviour is as before', () => {
  assert.equal(/data-signals-chat[^{]*\.tabbar|\.tabbar[^{]*data-signals-chat/.test(css), false);
  assert.match(css, /:root:has\(input\[type="text"\]:focus, input\[type="search"\]:focus, textarea:focus\) \.tabbar/, 'the existing keyboard rule is untouched');
  assert.match(app, /\{showChrome && <BottomNavigation /, 'the bottom navigation is still rendered with the chrome');
});

test('the conversation hands the header height back and clears the top safe area itself', () => {
  assert.match(css, /--chat-top-chrome: calc\(var\(--header-h\) \+ env\(safe-area-inset-top\)\);/, 'by default it leaves room for the app header, as before');
  assert.match(css, /--chat-top-chrome: 0px;/, 'none when the header is hidden');
  assert.match(css, /--chat-safe-top: env\(safe-area-inset-top\);/);
  assert.match(convo, /const chrome = 'var\(--chat-top-chrome\) - var\(--tabbar-h\)';/, 'the height still stops above the bottom navigation');
  assert.match(convo, /paddingTop: 'calc\(0\.5rem \+ var\(--chat-safe-top, 0px\)\)'/, 'its own header clears the notch');
  assert.match(convo, /<ArrowLeft/, 'the back button is still in the conversation header');
  assert.match(convo, /aria-label="Back to Signals"/);
});

test('the app header is marked so the rule can find it, and it still renders everywhere else', () => {
  assert.match(header, /<header data-app-header /);
  assert.match(app, /\{showChrome && \(\s*<Header/);
  assert.match(app, /data-signals-chat=\{currentView === 'signals' && signalsChatVisible \? 'open' : undefined\}/, 'only on the Signals page, only while a conversation is showing');
});

test('Signals tells App when a conversation is on screen, and the open one is remembered when the member visits another section', () => {
  assert.match(view, /onConversationState\?\.\(\{ openPairId, visible: conversationVisible \}\)/);
  assert.match(view, /conversationVisible = Boolean\(openPairId && pairs\.find\(\(pair\) => pair\.id === openPairId\)\?\.status === 'active'\)/, 'only an active conversation counts');
  assert.match(view, /useState<string \| null>\(initialPairId\)/, 'it reopens the same conversation');
  assert.match(app, /initialPairId=\{signalsResumePairId\}/);
  assert.match(app, /setSignalsResumePairId\(openPairId\); setSignalsChatVisible\(visible\);/);
  // Back clears it, so the inbox is where Back leads and where the next visit starts.
  assert.match(view, /onBack=\{\(\) => setOpenPairId\(null\)\}/);
});

test('messaging, GIF, photo and Comfort Cards in the conversation are untouched', () => {
  for (const marker of ['aria-label="Send a timed photo"', 'aria-label="Send a GIF"', 'aria-label="Comfort Cards"', 'onSubmit={sendMessage}', '<ComfortCardPicker', '<GifPicker']) {
    assert.ok(convo.includes(marker), marker);
  }
});

test('the other pages keep the app header: Chat is the only other page that hides it, as before', () => {
  assert.match(app, /const showChrome = currentView !== 'chat';/);
});

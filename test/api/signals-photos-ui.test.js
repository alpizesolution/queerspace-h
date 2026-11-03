import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const conversation = read('src/components/SignalsConversation.tsx');
const composer = read('src/components/TimedPhotoComposer.tsx');
const viewer = read('src/components/TimedPhotoViewer.tsx');
const service = read('src/services/timedPhotoService.ts');
const rules = read('firestore.rules');

test('the composer has a compact photo button, and a preview with only the 3s, 5s and 8s timers, 3s chosen first', () => {
  assert.match(conversation, /aria-label="Send a timed photo"/);
  assert.match(conversation, /accept="image\/jpeg,image\/png,image\/webp"/, 'no SVG, GIF or other types');
  assert.match(conversation, /pickedFileProblem\(file\)/);
  assert.match(composer, /useState<PhotoTimer>\(DEFAULT_PHOTO_TIMER\)/);
  assert.match(composer, /PHOTO_TIMERS\.map\(\(seconds\) =>/);
  assert.match(composer, /\{seconds\}s/);
  assert.match(composer, /role="radiogroup" aria-label="How long they can see it"/);
  assert.match(composer, /<img src=\{preview\}/, 'a preview of the sender\'s own file');
  assert.match(composer, /URL\.revokeObjectURL\(preview\)/, 'released when closed');
  assert.doesNotMatch(composer, /permanent|keep|save/i, 'no way to make it permanent');
});

test('there is no way to send a photo without a timer, and no other duration is offered anywhere', () => {
  assert.match(service, /timerSeconds: input\.timer/);
  assert.match(conversation, /onSend=\{\(timer\) => void sendPhoto\(timer\)\}/);
  assert.doesNotMatch(composer + conversation + service, /timerSeconds: (?!input\.timer)/);
  for (const other of ['10s', '15s', '30s', '60s', '1m']) assert.equal((composer + service).includes(other), false, other);
});

test('a received photo is a concealed card with the timer and "Open photo"; after it ends the thread says "Photo expired"', () => {
  assert.match(conversation, /<span[^>]*backdrop-blur-xl/, 'a blurred, concealed card');
  assert.match(conversation, /Open photo/);
  assert.match(conversation, /\{photo\.durationSec\}s/);
  assert.match(conversation, /Photo expired/);
  assert.doesNotMatch(conversation, /<im[g][^>]*photo/i, 'the thread never draws the picture');
  assert.match(conversation, /closedPhotos\.has\(message\.id\)/, 'closing a photo here turns it into "Photo expired"');
  assert.match(conversation, /event\.stopPropagation\(\); onOpen\(\);/);
});

test('the viewer draws from memory, never gives the picture a URL, hides it when it could be captured, and clears it at the end', () => {
  assert.match(viewer, /<canvas ref=\{canvasRef\}/);
  assert.doesNotMatch(viewer, /<img|createObjectURL|URL\.createObjectURL|data:image|\.src\s*=/, 'no image element, object URL or data link');
  assert.match(service, /createImageBitmap\(new Blob\(\[bytes\]/);
  assert.doesNotMatch(service, /createObjectURL|data:image|localStorage|sessionStorage|indexedDB|caches\./, 'nothing is stored on the device');
  assert.match(service, /cache: 'no-store'/);
  assert.match(viewer, /document\.addEventListener\('visibilitychange'/);
  assert.match(viewer, /window\.addEventListener\('blur'/);
  assert.match(viewer, /shouldConceal\(state\)/);
  assert.match(viewer, /isCaptureKey\(event\)/);
  assert.match(viewer, /visibility: concealed \? 'hidden' : 'visible'/);
  assert.match(viewer, /onContextMenu=\{block\}/, 'no right-click save');
  assert.match(viewer, /onDragStart=\{block\}/);
  assert.match(viewer, /print:hidden/);
  assert.match(viewer, /\[-webkit-touch-callout:none\]/);
  assert.match(viewer, /if \(remaining <= 0\) \{ finish\('expired'\); return; \}/, 'the picture is cleared when time is up');
  assert.match(viewer, /clearRect\(0, 0, canvas\.width, canvas\.height\)/);
  assert.match(viewer, /bitmapRef\.current\?\.close\(\)/);
  assert.match(viewer, /role="timer"/, 'a clear countdown');
  assert.match(viewer, /Hidden while you’re away/);
  // It claims nothing it cannot do.
  assert.doesNotMatch(viewer + composer + conversation, /screenshot[- ]proof|cannot be captured|can't be captured|prevents? screenshots/i);
});

test('the countdown is measured from when the picture arrived, using the time the server left, not a client-chosen duration', () => {
  assert.match(viewer, /const endAt = result\.receivedAt \+ result\.remainingMs;/);
  assert.match(service, /remainingMs: data\.remainingMs/);
  assert.match(service, /const receivedAt = performance\.now\(\);/);
});

test('no storage credentials or R2 settings exist in the browser code, and the rules leave photo records closed', () => {
  for (const file of [composer, viewer, service, conversation]) assert.doesNotMatch(file, /R2_|r2\.cloudflarestorage|X-Amz|secretAccessKey/i);
  assert.doesNotMatch(rules, /signalsMedia/, 'no client rule: default deny keeps photo records server-only');
  assert.match(rules, /match \/signalsPairs\/\{pairId\} \{\s*allow read, write: if false;/);
});

test('text messages, replies and reactions still render as before', () => {
  assert.match(conversation, /\{message\.text\}<\/p>/);
  assert.match(conversation, /action: 'send-message'/);
  assert.match(conversation, /aria-label="Send message"/);
});

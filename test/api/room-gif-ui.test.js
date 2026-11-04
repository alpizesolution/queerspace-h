import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const view = read('src/components/PublicRoomView.tsx');
const picker = read('src/components/GifPicker.tsx');
const service = read('src/services/publicRoomService.ts');
const rules = read('firestore.rules');
const room = read('api/_room.js');
const handler = read('api/room.js');
const signals = read('api/signals.js');
const giphy = read('api/_giphy.js');

test('Galaxy Room has a compact GIF icon button beside the composer that opens the shared picker', () => {
  assert.match(view, /aria-label="Send a GIF"/);
  assert.match(view, /<GifIcon className="w-5 h-5" \/>/);
  assert.match(view, /import \{ GifBubble, GifIcon, GifPicker \} from '\.\/GifPicker\.tsx'/, 'the same picker as Signals, not a copy');
  assert.match(view, /<GifPicker\s+busy=\{gifSending\}\s+error=\{gifError\}/);
  assert.doesNotMatch(view, /api\.giphy\.com|GIPHY_API_KEY|fetch\(/, 'the view never talks to GIPHY or the network itself');
});

test('the picker closes only after a successful send, and a failed send keeps it open with the reason', () => {
  assert.match(view, /if \(result\.ok\) \{[^}]*setGifOpen\(false\)/);
  assert.match(view, /setGifError\(roomGifProblemText\(result\.reason\)\)/);
  assert.match(view, /onClose=\{\(\) => \{ if \(!gifBusy\.current\)/, 'it cannot be closed in the middle of a send');
  assert.match(picker, /busy \? 'Sending…'/);
  assert.match(picker, /disabled=\{busy\}/);
  assert.match(picker, /if \(!selected \|\| busy \|\| sent\.current\) return;/);
});

test('repeated taps cannot send twice, and a retry keeps one message id so no copy is made', () => {
  assert.match(view, /if \(gifBusy\.current\) return;\s*gifBusy\.current = true;/);
  assert.match(view, /gifAttempt\.current\?\.gifId !== gif\.id/);
  assert.match(view, /sendRoomGif\(gif\.id, gifAttempt\.current\.messageId\)/);
});

test('the app sends only a GIF id to the server, and shows a GIF only from approved GIPHY addresses', () => {
  assert.match(service, /body: JSON\.stringify\(\{ action: 'send-gif', gifId, messageId \}\)/);
  assert.match(service, /data\.kind === 'gif' && parseGifInfo\(data\.gif\)/);
  assert.match(view, /msg\.kind === 'gif' && msg\.gif \? \(\s*<GifBubble gif=\{msg\.gif\} mine=\{msg\.isSelf\} \/>/);
  assert.match(view, /<p className="whitespace-pre-wrap">\{msg\.text\}<\/p>/, 'text messages render as before');
});

test('GIF messages are written only by the server: the room rules still do not allow GIF fields from a client', () => {
  const create = rules.slice(rules.indexOf('match /public_room_messages/{messageId}'), rules.indexOf('// 4. COMMUNITY POSTS'));
  assert.doesNotMatch(create, /'kind'|'gif'/, 'the rules were not loosened');
  assert.match(create, /hasOnly\(\['authorId', 'authorName', 'authorPronouns', 'authorAvatar', 'text', 'timestamp', 'replyTo'\]\)/);
  assert.match(create, /allow delete: if isAdmin\(\);/, 'moderators remove GIF messages with the existing delete');
});

test('the server applies the room safeguards and reuses the one GIPHY integration', () => {
  assert.match(room, /isAdultMember\(settings\.data\(\)\) \|\| profile\.data\(\)\?\.profileComplete !== true/);
  assert.match(room, /suspension\.exists/);
  assert.match(room, /ROOM_SLOW_MODE_MS = 2000/);
  assert.match(rules, /slowMode\('publicRoom', 2\)/, 'the same two seconds as the rules');
  assert.match(room, /rateLimit\(db, uid, 'room-gif', ROOM_GIFS_PER_MINUTE/);
  assert.match(room, /giphy\.byId\(input\.gifId\)/);
  assert.match(room, /import \{ GIF_TEXT, isGifId, sharedGiphy, shapeStoredGif \} from '\.\/_giphy\.js'/);
  assert.match(handler, /import \{ sendRoomGif \} from '\.\/_room\.js'/);
  assert.equal((giphy.match(/https:\/\/api\.giphy\.com/g) || []).length, 1, 'one GIPHY client, one API address');
  assert.match(signals, /const giphy = sharedGiphy;/, 'Signals and the room share it');
  assert.doesNotMatch(room + handler, /process\.env\.GIPHY_API_KEY|api_key/, 'the key is only in the shared helper');
});

test('search and trending are the existing proxy, and there is room for the new endpoint under the function limit', () => {
  assert.doesNotMatch(read('src/services/gifService.ts'), /\/api\/room/);
  assert.match(read('src/services/gifService.ts'), /view: 'gifs'/);
  assert.ok(fs.existsSync('api/room.js'));
});

test('a GIF is lazy-loaded and bounded in the room, and the library is documented', () => {
  assert.match(picker, /loading="lazy"/);
  assert.match(picker, /BUBBLE_MAX_WIDTH = 260/);
  const docs = read('docs/signals-gifs.md');
  assert.match(docs, /Galaxy Room/);
  assert.match(docs, /POST \/api\/room/);
});

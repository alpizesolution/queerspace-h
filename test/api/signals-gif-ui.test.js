import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(file, 'utf8');
const conversation = read('src/components/SignalsConversation.tsx');
const picker = read('src/components/GifPicker.tsx');
const service = read('src/services/gifService.ts');
const server = read('api/signals.js');
const giphy = read('api/_giphy.js');
const vercel = read('vercel.json');

function sourceFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, found);
    else if (/\.(ts|tsx|js|jsx|html|css)$/.test(entry.name)) found.push(full);
  }
  return found;
}

test('the composer has a compact GIF icon button beside the photo button, not a text button', () => {
  assert.match(conversation, /aria-label="Send a GIF"/);
  assert.match(conversation, /<GifIcon className="h-\[20px\] w-\[20px\]" \/>/);
  assert.match(conversation, /\{gifOpen && !ended && <GifPicker onSend=\{sendGif\} onClose=\{\(\) => setGifOpen\(false\)\} \/>\}/, 'no picker once the connection has ended');
  assert.doesNotMatch(conversation, />\s*GIF\s*<\/button>/, 'no large text button');
});

test('the picker has search, trending first, a grid, loading, empty and error states, a preview, and attribution', () => {
  assert.match(picker, /placeholder="Search GIFs"/);
  assert.match(picker, /Trending now/);
  assert.match(picker, /Loading GIFs/);
  assert.match(picker, /No GIFs found/);
  assert.match(picker, /role="alert"/);
  assert.match(picker, /gifProblemText\(problem\)/);
  assert.match(picker, /Try again/);
  assert.match(picker, /Send this GIF\?/, 'a preview step before anything is sent');
  assert.match(picker, /Powered by GIPHY/);
  assert.match(picker, /grid grid-cols-2 gap-2 sm:grid-cols-3|columns-2 gap-2 sm:columns-3/, 'two columns on a phone, three on larger screens');
  assert.match(picker, /SEARCH_DELAY_MS/, 'searching waits for a pause in typing');
  assert.match(picker, /maxLength=\{50\}/);
});

test('picking a GIF twice cannot send it twice, and the message shows as sending', () => {
  assert.match(picker, /if \(!selected \|\| busy \|\| sent\.current\) return;\s*sent\.current = true;/);
  assert.match(conversation, /setGifOpen\(false\);\s*setPending\(/, 'the picker closes the moment the send starts');
  assert.match(conversation, /status: 'sending'/);
  assert.match(conversation, /\.\.\.\(item\.gif \? \{ kind: 'gif', gifId: item\.gif\.id \} : \{ text: item\.text \}\)/, 'the app sends the id only, never a link');
  assert.doesNotMatch(conversation + service, /gifUrl|url: item\.gif|\.gif\.url/ , 'no link is ever put in a request');
});

test('GIFs in the thread are bounded, sized before they load, and respect reduced motion', () => {
  assert.match(picker, /BUBBLE_MAX_WIDTH = 260/);
  assert.match(picker, /BUBBLE_MAX_HEIGHT = 320/);
  assert.match(picker, /maxWidth: '100%'/);
  assert.match(picker, /aspectRatio: `\$\{gif\.width\} \/ \$\{gif\.height\}`/);
  assert.match(picker, /prefers-reduced-motion: reduce/);
  assert.match(picker, /gif\.stillUrl/);
  assert.match(picker, /referrerPolicy="no-referrer"/);
  assert.match(picker, /loading="lazy"/);
  assert.match(conversation, /message\.kind === 'gif' && message\.gif \? \(\s*<GifBubble gif=\{message\.gif\} mine=\{mine\} \/>/);
});

test('the GIPHY key stays on the server: not in the app, the build, or any request from the browser', () => {
  assert.doesNotMatch(giphy.replace(/process\.env\.GIPHY_API_KEY/g, ''), /api_key=[A-Za-z0-9]/);
  const offenders = sourceFiles('src').filter((file) => /GIPHY_API_KEY|api\.giphy\.com|[?&]api_key=/.test(read(file)));
  assert.deepEqual(offenders, [], 'the browser never calls GIPHY or sees a key');
  assert.doesNotMatch(read('vite.config.ts'), /GIPHY/i, 'not injected into the client bundle');
  assert.match(service, /\/api\/signals\?\$\{params\}/);
  assert.match(giphy, /process\.env\.GIPHY_API_KEY/);
  // No real-looking key is committed anywhere in the repository's source.
  for (const file of [...sourceFiles('api'), ...sourceFiles('src'), '.env.example', 'docs/signals-gifs.md']) {
    assert.doesNotMatch(read(file), /GIPHY_API_KEY\s*=\s*["']?[A-Za-z0-9]{24,}/, file);
  }
});

test('the server takes a GIF by id only, after the conversation checks, and no new serverless function was added', () => {
  assert.match(server, /kind === 'gif'/);
  assert.match(server, /\['gif', 'url', 'gifUrl', 'text'\]\.some\(field => req\.body\[field\] !== undefined\)/);
  const checks = server.indexOf("if (ownSuspension.exists || otherSuspension.exists) return send(res, 403, { error: 'account_unavailable' });");
  const lookup = server.indexOf('gif = await giphy.byId(gifId);');
  assert.ok(checks > 0 && lookup > checks, 'GIPHY is asked only after the pair, block and suspension checks');
  assert.ok(fs.existsSync('api/_giphy.js') && !fs.existsSync('api/giphy.js'), 'a helper, not another function');
});

test('images may load from GIPHY, and configuration is documented', () => {
  assert.match(vercel, /img-src [^;]*https:\/\/\*\.giphy\.com/);
  assert.doesNotMatch(vercel, /connect-src [^;]*giphy/, 'the browser never calls the GIPHY API');
  assert.match(read('.env.example'), /GIPHY_API_KEY/);
  assert.match(read('docs/signals-gifs.md'), /GIPHY_API_KEY/);
  assert.match(read('docs/signals-phase-a-api-contract.md'), /GIPHY_API_KEY/);
});

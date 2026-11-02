import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(tsx?|jsx?)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

// A Signal can be started from exactly two places. The matched, active conversation is the original and the default.
// The Cosmos Looking For board is the second: its author published the post to be contacted, the server re-checks the
// post, the sender's adult status, blocks and pacing, and the author still has to accept. No profile, card or other
// listing may offer it.
test('only the chat screen and a Looking For post can start a Signal', () => {
  const starters = sourceFiles('src').filter((file) => /action:\s*'create'/.test(fs.readFileSync(file, 'utf8')) && /api\/signals/.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(starters.map((f) => path.basename(f)).sort(), ['ChatView.tsx', 'lookingForService.ts']);
  const offers = sourceFiles('src').filter((file) => /Send a Signal/.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(offers.map((f) => path.basename(f)), ['ChatView.tsx']);
});

test('a Looking For Signal always names the post it comes from and sends no conversation', () => {
  const service = fs.readFileSync('src/services/lookingForService.ts', 'utf8');
  assert.match(service, /action: 'create',\s*recipientId: post\.authorId,\s*lookingForPostId: post\.id/);
  assert.doesNotMatch(service, /convId/);
});

test('the Signal request always names the conversation it is sent from', () => {
  const chat = fs.readFileSync('src/components/ChatView.tsx', 'utf8');
  assert.match(chat, /action: 'create',\s*recipientId: partner\.id,\s*convId: cloudConvId/);
});

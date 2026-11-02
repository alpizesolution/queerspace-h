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

// A Signal invitation can be started from exactly one place: the matched, active conversation. Meeting someone from the
// Cosmos Looking For board is a different, consent-based flow (connection requests), which has its own tests; it never
// creates a Signal directly, and no profile, card or other listing may offer a Signal.
test('only the chat screen can start a Signal', () => {
  const starters = sourceFiles('src').filter((file) => /action:\s*'create'/.test(fs.readFileSync(file, 'utf8')) && /api\/signals/.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(starters.map((f) => path.basename(f)), ['ChatView.tsx']);
  const offers = sourceFiles('src').filter((file) => /Send a Signal/.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(offers.map((f) => path.basename(f)), ['ChatView.tsx']);
});

test('connection requests are started from exactly one place, and only ever ask: they never open a conversation themselves', () => {
  const starters = sourceFiles('src').filter((file) => /action: 'request-create'/.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(starters.map((f) => path.basename(f)), ['connectionRequestsService.ts']);
  const service = fs.readFileSync('src/services/connectionRequestsService.ts', 'utf8');
  assert.match(service, /action: 'request-create',\s*recipientId: post\.authorId,\s*lookingForPostId: post\.id/);
  assert.doesNotMatch(service, /convId/);
});

test('the Signal request always names the conversation it is sent from', () => {
  const chat = fs.readFileSync('src/components/ChatView.tsx', 'utf8');
  assert.match(chat, /action: 'create',\s*recipientId: partner\.id,\s*convId: cloudConvId/);
});

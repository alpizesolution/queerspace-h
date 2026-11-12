import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { replyToUnsaid, toUnsaidPost, toUnsaidReply, unseenByPost, validateUnsaidReplyText } from './unsaidService.ts';

const read = (file: string) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const service = read('src/services/unsaidService.ts');

test('a reply is checked like a post, in a shorter box', () => {
  assert.deepEqual(validateUnsaidReplyText('  Congratulations! So proud of you.  '), { ok: true, text: 'Congratulations! So proud of you.' });
  assert.equal(validateUnsaidReplyText('   ').ok, false);
  assert.equal(validateUnsaidReplyText('x'.repeat(300)).ok, true);
  assert.equal(validateUnsaidReplyText('x'.repeat(301)).ok, false);
  for (const text of ['see https://example.com', 'find me @someone_ig', 'call 0917 123 4567', 'visit my site.com']) {
    const r = validateUnsaidReplyText(text);
    assert.equal(r.ok, false, text);
    assert.match((r as { error: string }).error, /anonymous/i);
  }
});

test('the app itself refuses to send a reply to Confession, Vent or Unsent Letters, before touching the database', async () => {
  for (const kind of ['confession', 'vent', 'unsent'] as const) {
    assert.deepEqual(await replyToUnsaid({ id: 'post1', kind }, 'You are not alone'), { ok: false, reason: 'not-allowed' }, kind);
  }
});

test('Need Advice, Random Thoughts and the Uplift categories accept a reply to be sent; an empty one is refused first', async () => {
  for (const kind of ['advice', 'thoughts', 'wins', 'gratitude', 'daydreams'] as const) {
    assert.deepEqual(await replyToUnsaid({ id: 'post1', kind }, '   '), { ok: false, reason: 'invalid' }, kind);
    // With no database in a test run, a valid reply fails cleanly rather than throwing.
    assert.deepEqual(await replyToUnsaid({ id: 'post1', kind }, 'Sending love'), { ok: false, reason: 'failed' }, kind);
  }
});

test('a public reply is only text and a time: no author, no owner', () => {
  const reply = toUnsaidReply('r1', { text: 'You can do it', createdAt: { toMillis: () => 7 }, authorId: 'secret', ownerId: 'secret', email: 'a@b.c' });
  assert.deepEqual(Object.keys(reply).sort(), ['createdAt', 'id', 'text']);
  assert.equal(reply.createdAt, 7);
  assert.equal(JSON.stringify(reply).includes('secret'), false);
});

test('a post carries its reply count; older posts have none, which reads as zero', () => {
  assert.equal(toUnsaidPost('a', { kind: 'advice', text: 'help', replyCount: 4 }).replyCount, 4);
  assert.equal(toUnsaidPost('b', { kind: 'vent', text: 'old post with no counter' }).replyCount, 0);
  assert.equal(toUnsaidPost('c', { kind: 'wins', text: 'x', replyCount: -3 }).replyCount, 0);
  assert.equal(toUnsaidPost('d', { kind: 'wins', text: 'x', replyCount: 2.9 }).replyCount, 2);
  assert.equal(toUnsaidPost('e', { kind: 'gratitude', text: 'x' }).kind, 'gratitude');
});

test('the replies an author has not seen are counted per post, and only where there are some', () => {
  assert.deepEqual(unseenByPost([{ id: 'a', replyCount: 3, seen: 1 }, { id: 'b', replyCount: 2, seen: 2 }, { id: 'c', replyCount: 0, seen: 0 }, { id: 'd', replyCount: 1, seen: 5 }]), { a: 2 });
});

test('writing a reply and taking it back are single batches with everything the rules check, and the public reply names no one', () => {
  const send = service.slice(service.indexOf('export async function replyToUnsaid'), service.indexOf('/** Deletes a reply'));
  assert.match(send, /batch\.set\(replyRef, \{ text: checked\.text, createdAt: serverTimestamp\(\) \}\)/, 'the public reply: text and time only');
  assert.doesNotMatch(send.slice(send.indexOf('batch.set(replyRef')), /replyRef, \{[^}]*authorId/, 'no author on the public reply');
  assert.match(send, /batch\.set\(doc\(db, 'unsaid_reply_owners', replyRef\.id\), \{ authorId: uid, postId: post\.id \}\)/, 'the writer is recorded privately');
  assert.match(send, /replyCount: increment\(1\), lastReply: replyRef\.id/);
  assert.match(send, /unsaidReply: serverTimestamp\(\)/, 'the slow-mode stamp');
  const remove = service.slice(service.indexOf('export async function deleteUnsaidReply'), service.indexOf('/** Reports a reply'));
  assert.match(remove, /batch\.delete\(doc\(db, 'unsaid', postId, 'replies', replyId\)\)/);
  assert.match(remove, /batch\.delete\(doc\(db, 'unsaid_reply_owners', replyId\)\)/);
  assert.match(remove, /replyCount: increment\(-1\), lastReply: replyId/);
});

test('only categories that take replies get a reply counter and a "seen" record, so every other post is written exactly as before', () => {
  const post = service.slice(service.indexOf('export async function postUnsaid'), service.indexOf('/** IDs of the current user'));
  assert.match(post, /const takesReplies = kindAllowsReplies\(kind\)/);
  assert.match(post, /\.\.\.\(takesReplies \? \{ replyCount: 0 \} : \{\}\)/);
  assert.match(post, /takesReplies \? \{ authorId: uid, kind, seenReplies: 0 \} : \{ authorId: uid \}/);
});

test('Echoes still have no indexes and no scheduled jobs, and replies are reported through the same reports inbox as posts', () => {
  assert.equal(JSON.stringify(JSON.parse(read('firestore.indexes.json'))).includes('unsaid'), false);
  const report = service.slice(service.indexOf('export async function reportUnsaidReply'), service.indexOf('// ----', service.indexOf('export async function reportUnsaidReply')));
  assert.match(report, /collection\(db, 'reports'\)/);
  assert.match(report, /reason: `Unsaid reply: \$\{reason\}`/);
});

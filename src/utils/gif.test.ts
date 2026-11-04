import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanGifQuery, gifProblemFor, gifProblemText, gifSendProblemText, isApprovedGifUrl, parseGifInfo, parseGifPage } from './gif.ts';
import { checkedGif, describeSendFailure, mergeMessages, visibleThread, type PendingMessage, type ThreadMessage } from './signalsThread.ts';

const ID = 'abc123XYZ';
const url = (name: string, host = 'media2.giphy.com') => `https://${host}/media/v1.Y2lkPTc5/${ID}/${name}.gif?cid=1`;
const gif = (over: Record<string, unknown> = {}) => ({
  id: ID, url: url('giphy-downsized-medium'), previewUrl: url('200w'), stillUrl: url('200w_s'),
  width: 400, height: 300, previewWidth: 200, previewHeight: 150, title: 'Happy dance', ...over,
});

test('only https GIPHY media addresses for the same GIF are approved', () => {
  assert.equal(isApprovedGifUrl(url('giphy'), ID), true);
  assert.equal(isApprovedGifUrl(`https://i.giphy.com/${ID}.gif`, ID), true);
  for (const bad of [
    'http://media.giphy.com/media/abc123XYZ/giphy.gif', 'https://evil.example/media/abc123XYZ/giphy.gif',
    'https://media.giphy.com.evil.example/media/abc123XYZ/giphy.gif', 'https://u:p@media.giphy.com/media/abc123XYZ/giphy.gif',
    'https://media.giphy.com/media/otherId999/giphy.gif', 'javascript:alert(1)', 'data:image/gif;base64,AAAA', '', null, 5,
  ]) assert.equal(isApprovedGifUrl(bad, ID), false, String(bad));
});

test('a GIF from the server is read only when it is complete and approved', () => {
  assert.equal(parseGifInfo(gif())?.id, ID);
  assert.equal(parseGifInfo(gif({ url: 'https://evil.example/x.gif' })), null);
  assert.equal(parseGifInfo(gif({ previewUrl: 'https://evil.example/x.gif' })), null);
  assert.equal(parseGifInfo(gif({ stillUrl: 'https://evil.example/x.gif' }))?.stillUrl, null, 'a bad still is dropped, the GIF stays');
  assert.equal(parseGifInfo(gif({ id: '../x' })), null);
  assert.equal(parseGifInfo(gif({ width: 0 })), null);
  assert.equal(parseGifInfo(gif({ width: '400' })), null);
  assert.equal(parseGifInfo(null), null);
  assert.equal(parseGifInfo('GIF'), null);
});

test('a page of GIFs drops the bad ones and a malformed page is an error', () => {
  const page = parseGifPage({ gifs: [gif(), gif({ url: 'https://evil.example/x.gif' }), gif({ id: 'second12345', url: url('a').replace(ID, 'second12345'), previewUrl: url('b').replace(ID, 'second12345'), stillUrl: null })], nextOffset: 18 });
  assert.deepEqual(page?.gifs.map((g) => g.id), [ID, 'second12345']);
  assert.equal(page?.nextOffset, 18);
  assert.equal(parseGifPage({ gifs: [], nextOffset: null })?.nextOffset, null);
  assert.equal(parseGifPage({ gifs: [], nextOffset: -1 })?.nextOffset, null);
  assert.equal(parseGifPage({}), null);
  assert.equal(parseGifPage(null), null);
});

test('search text is tidied and capped at 50 characters', () => {
  assert.equal(cleanGifQuery('  happy \n  dance\u0000 '), 'happy dance');
  assert.equal(cleanGifQuery('x'.repeat(80)).length, 50);
  assert.equal(cleanGifQuery('   '), '');
});

test('problems have plain words and the right kind', () => {
  assert.equal(gifProblemFor(503, 'gif_not_configured'), 'unavailable');
  assert.equal(gifProblemFor(429, 'gif_rate_limited'), 'busy');
  assert.equal(gifProblemFor(429, 'rate_limited'), 'busy');
  assert.equal(gifProblemFor(502, 'gif_unavailable'), 'failed');
  assert.equal(gifProblemFor(500, undefined), 'failed');
  for (const problem of ['unavailable', 'busy', 'offline', 'failed'] as const) assert.ok(gifProblemText(problem).length > 10);
  assert.match(gifSendProblemText('gif_not_found') ?? '', /no longer available/);
  assert.equal(gifSendProblemText('pair_not_found'), null);
  assert.equal(describeSendFailure(new Error(gifSendProblemText('gif_not_found') ?? '')).retryable, false, 'a GIF that is gone cannot be retried');
});

const message = (over: Partial<ThreadMessage> = {}): ThreadMessage => ({ id: 'm1', senderId: 'a', text: 'GIF', createdAt: new Date(1000).toISOString(), kind: 'gif', gif: gif() as ThreadMessage['gif'], ...over });

test('a GIF message with a bad address is shown as plain text, never as a picture', () => {
  assert.equal(checkedGif(message()).kind, 'gif');
  const bad = checkedGif(message({ gif: gif({ url: 'https://evil.example/x.gif' }) as ThreadMessage['gif'] }));
  assert.equal(bad.kind, undefined);
  assert.equal('gif' in bad, false);
  assert.equal(bad.text, 'GIF');
  assert.equal(checkedGif(message({ gif: undefined })).kind, undefined);
  const text: ThreadMessage = { id: 't', senderId: 'a', text: 'hi', createdAt: null };
  assert.equal(checkedGif(text), text, 'text messages are untouched');
  // And the same happens for anything arriving through the thread merge.
  const merged = mergeMessages([], [message({ gif: gif({ previewUrl: 'http://evil.example/x.gif' }) as ThreadMessage['gif'] })]);
  assert.equal(merged[0].gif, undefined);
});

test('a GIF being sent shows as the GIF right away, and once the server returns it, only once', () => {
  const info = parseGifInfo(gif())!;
  const waiting: PendingMessage = { id: 'p1', text: 'GIF', gif: info, replyTo: null, status: 'sending', retryable: true, createdAt: 5000 };
  const shown = visibleThread([], [waiting], 'me');
  assert.equal(shown.length, 1);
  assert.equal(shown[0].kind, 'gif');
  assert.equal(shown[0].gif?.id, ID);
  assert.equal(shown[0].senderId, 'me');
  assert.equal(shown[0].pending?.status, 'sending');
  assert.equal(visibleThread([message({ id: 'p1', senderId: 'me' })], [waiting], 'me').length, 1);
});

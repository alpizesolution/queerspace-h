import '../../test/dom-setup.ts';
import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { communitySubject, lookingForSubject, postReference, requestPostLabel, type ConnectionRequest } from '../utils/connectionRequests.ts';
import { toCommunityPost } from '../services/communityService.ts';
import type { CommunityPost } from '../types.ts';

/**
 * Send Signal on a regular Cosmos post: the same connection request as on the Looking For board. Anyone but the author can
 * ask; the author can pause and resume requests on the post; the request sheet, the limits and the answers are the ones
 * Looking For already uses. The server side is covered in test/api/connection-requests.integration.test.js.
 */
const sent: unknown[][] = [];
mock.module('../services/connectionRequestsService.ts', {
  namedExports: {
    createConnectionRequest: async (...args: unknown[]) => { sent.push(args); return { ok: true, requestId: 'request-0001' }; },
    answerConnectionRequest: async () => ({ ok: true, status: 'withdrawn' }),
    setCommunityRequestsPaused: async () => ({ ok: true, paused: true }),
  },
});
const { ConnectionRequestSheet } = await import('./ConnectionRequestSheet.tsx');

afterEach(() => { cleanup(); sent.length = 0; });
const read = (f: string) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const post = (over: Partial<CommunityPost> = {}): CommunityPost => ({
  id: 'cosmos-post-0001', authorId: 'author-uid-0001', author: 'Luna', authorPronouns: 'she/her', category: 'media', title: 'Rainy day reads',
  content: 'What are you reading?', timestamp: 1, likes: 0, stardustCount: 0, replies: [], tags: [], ...over,
});

test('a Cosmos post becomes the subject of a request; an old post with no known author cannot be asked about', () => {
  assert.deepEqual(communitySubject(post()), { id: 'cosmos-post-0001', kind: 'community', authorId: 'author-uid-0001', author: 'Luna', authorAvatar: undefined, about: 'Cosmos' });
  assert.equal(communitySubject(post({ authorId: undefined })), null);
  assert.equal(communitySubject(post({ authorId: '' })), null);
  const lookingFor = lookingForSubject({ id: 'a_dating', authorId: 'a', author: 'Mara', intention: 'dating' } as never);
  assert.equal(lookingFor.kind, 'looking_for');
  assert.equal(lookingFor.about, 'Dating');
});

test('the request sheet for a Cosmos post names the member and the post kind, and sends the request about that post', async () => {
  render(<ConnectionRequestSheet subject={communitySubject(post())!} onClose={() => {}} />);
  assert.ok(screen.getByText('Luna'));
  assert.ok(screen.getByText('About their Cosmos post'));
  assert.ok(screen.getByText(/needs to accept before private messaging opens/));
  fireEvent.change(screen.getByPlaceholderText('A short introduction (optional)'), { target: { value: 'Hi, loved this!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
  await screen.findByText(/will see your request in Signals/);
  assert.equal(sent.length, 1);
  const [subject, message] = sent[0] as [{ id: string; kind: string; authorId: string }, string];
  assert.deepEqual([subject.id, subject.kind, subject.authorId, message], ['cosmos-post-0001', 'community', 'author-uid-0001', 'Hi, loved this!']);
});

test('the API is told which kind of post: a Cosmos post id for Cosmos, a Looking For post id otherwise, never both', () => {
  const service = read('src/services/connectionRequestsService.ts');
  assert.match(service, /post\.kind === 'community' \? \{ communityPostId: post\.id \} : \{ lookingForPostId: post\.id \}/);
  assert.match(service, /action: 'request-pause-post', communityPostId: postId, paused/);
});

test('in the requests list a Cosmos request is named for Cosmos, with the same notices as any other post', () => {
  const request = (over: Partial<ConnectionRequest['post']> = {}, intention: ConnectionRequest['intention'] = null) =>
    ({ intention, post: { kind: 'community', status: 'active', title: 'Rainy day reads', sensitive: false, ...over } }) as Pick<ConnectionRequest, 'post' | 'intention'>;
  assert.equal(requestPostLabel(request()), 'Cosmos');
  assert.deepEqual(postReference(request(), requestPostLabel(request())), { text: '“Rainy day reads”', notice: null });
  const removed = request({ status: 'removed', title: null });
  assert.deepEqual(postReference(removed, requestPostLabel(removed)), { text: 'Cosmos post', notice: 'This post is no longer available.' });
  const paused = request({ status: 'paused' });
  assert.equal(postReference(paused, requestPostLabel(paused)).notice, 'This post is not taking new requests right now.');
  // Looking For requests, and answers from a server that does not send `kind`, read as before.
  assert.equal(requestPostLabel(request({ kind: 'looking_for' }, 'dating')), 'Dating');
  assert.equal(requestPostLabel(request({ kind: undefined }, 'friendship')), 'Friendship');
  assert.equal(requestPostLabel(request({ kind: undefined }, null)), 'Looking For');
});

test('a post read from the cloud knows whether its author paused requests', () => {
  const base = { authorId: 'a', authorName: 'Luna', title: 't', content: 'c', category: 'media', tags: [] };
  assert.equal(toCommunityPost('p1', base).requestsPaused, false);
  assert.equal(toCommunityPost('p1', { ...base, requestsPaused: true }).requestsPaused, true);
  assert.equal(toCommunityPost('p1', { ...base, requestsPaused: 'yes' }).requestsPaused, false);
});

test('on the feed: Send Signal for other members, a pause switch for the author, and "Requests paused" when the author paused', () => {
  const feed = read('src/components/CommunityFeedView.tsx');
  assert.match(feed, /const mine = Boolean\(uid\) && post\.authorId === uid;\s*const subject = mine \? null : communitySubject\(post\);/, 'never on your own post');
  assert.match(feed, /\{mine \? \(\s*<button[\s\S]*?toggleRequestsPaused\(post\)[\s\S]*?\{post\.requestsPaused \? 'Resume requests' : 'Pause requests'\}/);
  assert.match(feed, /\) : subject && \(post\.requestsPaused\s*\? <button type="button" disabled[^>]*>Requests paused<\/button>/);
  assert.match(feed, /onClick=\{\(\) => setRequestSubject\(subject\)\} aria-label="Send connection signal"/);
  assert.match(feed, /\{requestSubject && <ConnectionRequestSheet subject=\{requestSubject\} onClose=\{\(\) => setRequestSubject\(null\)\} onViewRequests=\{onViewRequests\} \/>\}/, 'the same sheet as Looking For, leading to Signals → Requests');
  // The button looks and reads like the one on Looking For posts.
  const lookingFor = read('src/components/LookingForBody.tsx');
  for (const piece of ['aria-label="Send connection signal"', '<span className="sm:hidden" aria-hidden="true">Signal</span>', '<span className="hidden sm:inline" aria-hidden="true">Send Signal</span>', 'Requests paused</button>']) {
    assert.ok(feed.includes(piece) && lookingFor.includes(piece), piece);
  }
});

test('Echoes stay anonymous: no connection request can be started from one', () => {
  for (const file of ['src/components/UnsaidView.tsx', 'src/components/UnsaidReplies.tsx']) {
    assert.doesNotMatch(read(file), /ConnectionRequestSheet|createConnectionRequest|Send Signal/);
  }
  // The server accepts only the two post collections.
  const api = read('api/_requests.js');
  assert.match(api, /path: `community_posts\/\$\{community\}`/);
  assert.match(api, /path: `looking_for_posts\/\$\{lookingFor\}`/);
  assert.doesNotMatch(api, /unsaid/i);
});

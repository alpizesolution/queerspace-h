import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aboutDetails,
  identityLine,
  isMemberId,
  classifyPostsFailure,
  parseProfileResponse,
  postsView,
  settlePostsLoad,
  ownerVisibility,
  profileAction,
  profileCover,
  profileIdFromSearch,
  profileLink,
  visibleLookingForPosts,
  type MemberProfile,
  type RelationState,
} from './profileView.ts';
import type { LookingForPost } from './lookingFor.ts';

const post = (over: Partial<LookingForPost> = {}): LookingForPost => ({
  id: 'u1_dating', authorId: 'u1', author: 'Willow', authorPronouns: 'she/her', title: 't', intro: 'i', lookingFor: 'l',
  intention: 'dating', tags: [], isNsfw: false, contentWarning: null, requestsPaused: false, timestamp: 1, ...over,
});

const member = (over: Partial<MemberProfile> = {}): MemberProfile => ({
  id: 'm1abcdefgh', displayName: 'Willow', pronouns: 'she/her', avatar: null, about: null, vibe: null, style: null, intention: null,
  interests: [], location: null, orientation: null, identity: null, expression: [], showsAge: false, ...over,
});

const rel = (state: RelationState, conversationId?: string) => ({ self: false, blocked: null, relation: { state, conversationId } });

test('the action is always the existing request flow, and nothing is offered when contact is not possible', () => {
  const live = [post({ id: 'a', timestamp: 5 }), post({ id: 'b', timestamp: 9 })];
  assert.deepEqual(profileAction(rel('none'), live), { kind: 'request', post: live[1] }, 'the newest open post');
  assert.deepEqual(profileAction(rel('none'), []), { kind: 'unavailable' }, 'no live post means no way to ask');
  assert.deepEqual(profileAction(rel('none'), [post({ requestsPaused: true })]), { kind: 'paused' });
  assert.deepEqual(profileAction(rel('none'), [post({ requestsPaused: true }), post({ id: 'ok', requestsPaused: false })]).kind, 'request');
});

test('each connection state gets its own action, whatever posts exist', () => {
  const live = [post()];
  assert.deepEqual(profileAction(rel('connected', 'pair-1'), live), { kind: 'open_conversation', conversationId: 'pair-1' });
  assert.deepEqual(profileAction(rel('connected', 'pair-1'), []), { kind: 'open_conversation', conversationId: 'pair-1' }, 'connected needs no post');
  assert.deepEqual(profileAction(rel('request_sent'), live), { kind: 'pending' });
  assert.deepEqual(profileAction(rel('request_received'), live), { kind: 'respond' });
  assert.deepEqual(profileAction(rel('declined'), live), { kind: 'declined' });
  assert.deepEqual(profileAction(rel('connected'), live).kind, 'request', 'a connected state with no conversation id is not trusted');
});

test('your own page and a blocked member offer no contact at all', () => {
  assert.deepEqual(profileAction({ self: true, blocked: null, relation: { state: 'self' } }, [post()]), { kind: 'none' });
  assert.deepEqual(profileAction({ self: false, blocked: 'by_me', relation: { state: 'none' } }, [post()]), { kind: 'blocked' });
  assert.deepEqual(profileAction({ self: false, blocked: 'by_me', relation: { state: 'connected', conversationId: 'x' } }, [post()]), { kind: 'blocked' }, 'blocking wins over an old connection');
});

test('visitors see live Looking For posts only, newest first; the owner sees all of their own', () => {
  const posts = [post({ id: 'old', timestamp: 1 }), post({ id: 'paused', requestsPaused: true, timestamp: 9 }), post({ id: 'new', timestamp: 5 })];
  assert.deepEqual(visibleLookingForPosts(posts, false).map((p) => p.id), ['new', 'old']);
  assert.deepEqual(visibleLookingForPosts(posts, true).map((p) => p.id), ['paused', 'new', 'old']);
  assert.equal(posts[0].id, 'old', 'the original list is not reordered');
});

test('the cover is a calm gradient from the avatar, the same every time, with a fallback when there is no avatar', () => {
  const a = profileCover('cat.1.2', 'seed-a');
  assert.match(a, /^linear-gradient\(135deg, .+ 0%, .+ 52%, #120b17 100%\)$/);
  assert.equal(profileCover('cat.1.2', 'seed-a'), a);
  assert.match(profileCover(null, 'seed-a'), /linear-gradient/);
  assert.match(profileCover(undefined, 'another-seed'), /linear-gradient/);
  assert.match(profileCover('not-a-real-avatar', 'seed'), /linear-gradient/, 'a malformed avatar still gets a cover');
});

test('the identity line shows an age only when one was provided', () => {
  assert.equal(identityLine({ pronouns: 'she/her' }, 27), '27 · she/her');
  assert.equal(identityLine({ pronouns: 'she/her' }, null), 'she/her');
  assert.equal(identityLine({ pronouns: null }, 27), '27');
  assert.equal(identityLine({ pronouns: null }, null), '');
});

test('About lists only what was shared, in a steady order, and is empty when nothing was', () => {
  assert.deepEqual(aboutDetails(member(), null), []);
  const rows = aboutDetails(member({ vibe: 'Cozy', style: 'Vintage', orientation: 'Lesbian', identity: 'Woman', expression: ['Femme', 'Soft'] }), 'Friends');
  assert.deepEqual(rows.map((r) => r.label), ['Here for', 'Vibe', 'Style', 'Orientation', 'Gender identity', 'Gender expression']);
  assert.equal(rows[5].value, 'Femme, Soft');
  assert.deepEqual(aboutDetails(member({ vibe: 'Cozy' }), null), [{ label: 'Vibe', value: 'Cozy' }]);
});

test('the owner summary reflects their own switches', () => {
  const off = ownerVisibility({});
  assert.deepEqual(off.map((r) => [r.label, r.shown]), [['Age', false], ['Location', true], ['Identity', false]]);
  const on = ownerVisibility({ showAgeOnProfile: true, showLocationOnProfile: false, showSexualOrientationOnProfile: true, showGenderIdentityOnProfile: true });
  assert.deepEqual(on.map((r) => r.shown), [true, false, true]);
  assert.equal(on[2].hint, '2 of 3 shared');
  assert.match(on[0].hint, /connected/i, 'the age promise is stated');
});

test('member ids and profile links are checked before anything uses them', () => {
  assert.equal(isMemberId('abcdefgh'), true);
  for (const bad of ['short', 'has space in it', '<script>alert(1)</script>', 'a'.repeat(129), '', null, undefined, 42]) assert.equal(isMemberId(bad), false, String(bad));
  assert.equal(profileLink('https://example.org', 'abcDEF12_-x'), 'https://example.org/?profile=abcDEF12_-x');
  assert.equal(profileIdFromSearch('?profile=abcDEF12_-x'), 'abcDEF12_-x');
  assert.equal(profileIdFromSearch('?profile=../../etc'), null);
  assert.equal(profileIdFromSearch('?profile=short'), null);
  assert.equal(profileIdFromSearch('?other=1'), null);
  assert.equal(profileIdFromSearch(''), null);
});

const validAnswer = () => ({
  self: false,
  member: { id: 'member-0001', displayName: 'Sky', pronouns: null, avatar: null, about: null, vibe: null, style: null, intention: null, interests: ['art'], location: null, orientation: null, identity: null, expression: [], showsAge: false },
  relation: { state: 'none' },
  blocked: null,
});

test('parseProfileResponse accepts a real profile answer and the blocked-by-me answer', () => {
  assert.ok(parseProfileResponse(validAnswer()));
  assert.ok(parseProfileResponse({ self: false, member: null, relation: { state: 'none' }, blocked: 'by_me' }));
  assert.ok(parseProfileResponse({ ...validAnswer(), relation: { state: 'connected', conversationId: 'c1' } }));
});

test('parseProfileResponse refuses answers from a server that does not know the profile view, or that are malformed', () => {
  assert.equal(parseProfileResponse(null), null);
  assert.equal(parseProfileResponse('profile'), null);
  assert.equal(parseProfileResponse({ invitations: [] }), null, 'what an older server returns for an unknown view');
  assert.equal(parseProfileResponse([]), null);
  assert.equal(parseProfileResponse({ ...validAnswer(), self: 'no' }), null);
  assert.equal(parseProfileResponse({ ...validAnswer(), relation: { state: 'friends' } }), null);
  assert.equal(parseProfileResponse({ ...validAnswer(), relation: { state: 'connected', conversationId: 5 } }), null);
  assert.equal(parseProfileResponse({ ...validAnswer(), blocked: 'by_them' }), null);
  assert.equal(parseProfileResponse({ ...validAnswer(), member: null }), null, 'no member and not blocked is not a profile');
  assert.equal(parseProfileResponse({ ...validAnswer(), member: { ...validAnswer().member, interests: 'art' } }), null);
  assert.equal(parseProfileResponse({ ...validAnswer(), member: { ...validAnswer().member, displayName: 4 } }), null);
  assert.equal(parseProfileResponse({ ...validAnswer(), member: { ...validAnswer().member, showsAge: undefined } }), null);
});

// ------------------------------------------------------------------------------------------- the Posts section's states
const firestoreError = (code: string) => Object.assign(new Error(code), { code });

test('a request that succeeds with zero posts is a success and an empty profile, never an error', async () => {
  const outcome = await settlePostsLoad(async () => ({ posts: [], cursor: null, done: true }));
  assert.equal(outcome.ok, true);
  assert.equal(postsView({ loading: false, failed: !outcome.ok, count: 0 }), 'empty');
});

test('a request that succeeds with posts lists them', async () => {
  const outcome = await settlePostsLoad(async () => ({ posts: [{ id: 'a' }, { id: 'b' }], cursor: null, done: false }));
  assert.ok(outcome.ok && outcome.page.posts.length === 2);
  assert.equal(postsView({ loading: false, failed: false, count: 2 }), 'list');
});

test('a permission-denied read is a failure, not an empty result', async () => {
  const outcome = await settlePostsLoad(async () => { throw firestoreError('permission-denied'); });
  assert.deepEqual(outcome, { ok: false, reason: 'permission' });
  assert.equal(postsView({ loading: false, failed: true, count: 0 }), 'error');
});

test('a network or request failure is a failure, and so is a missing index or any unexpected error', async () => {
  assert.deepEqual(await settlePostsLoad(async () => { throw firestoreError('unavailable'); }), { ok: false, reason: 'network' });
  assert.deepEqual(await settlePostsLoad(async () => { throw firestoreError('deadline-exceeded'); }), { ok: false, reason: 'network' });
  assert.deepEqual(await settlePostsLoad(async () => { throw firestoreError('failed-precondition'); }), { ok: false, reason: 'failed' }, 'e.g. a missing index');
  assert.deepEqual(await settlePostsLoad(async () => { throw new Error('boom'); }), { ok: false, reason: 'failed' });
  assert.equal(classifyPostsFailure(null), 'failed');
  assert.equal(classifyPostsFailure(undefined), 'failed');
});

test('retrying after a failure can succeed, and an empty success then shows the empty state instead of the error', async () => {
  let calls = 0;
  const request = () => settlePostsLoad(async () => { calls += 1; if (calls === 1) throw firestoreError('unavailable'); return { posts: [], cursor: null, done: true }; });
  const first = await request();
  assert.equal(postsView({ loading: false, failed: !first.ok, count: 0 }), 'error');
  const retry = await request();
  assert.equal(calls, 2);
  assert.equal(retry.ok, true);
  assert.equal(postsView({ loading: false, failed: !retry.ok, count: 0 }), 'empty');
});

test('the section shows loading while fetching, and keeps listed posts when a later page fails', () => {
  assert.equal(postsView({ loading: true, failed: false, count: 0 }), 'loading');
  assert.equal(postsView({ loading: true, failed: false, count: 3 }), 'list');
  assert.equal(postsView({ loading: false, failed: true, count: 3 }), 'list', 'a failed "show more" does not wipe the posts');
});

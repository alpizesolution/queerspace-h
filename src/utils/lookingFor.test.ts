import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeFilterCount,
  applyLookingForFilters,
  cleanTag,
  INTENTIONS,
  LIMITS,
  INTENTION_LABELS,
  LOOKING_FOR_CATEGORIES,
  NSFW_INTENTION,
  isIntention,
  composeTitle,
  isFlair,
  LOOKING_FOR_FLAIRS,
  postDisplayTitle,
  FEED_RETRY_DELAYS_MS,
  feedErrorReason,
  feedRetryDelay,
  draftFromPost,
  draftToDocument,
  EMPTY_DRAFT,
  lookingForPostId,
  NO_FILTERS,
  previewTags,
  popularTags,
  postPresentation,
  preferredAgeText,
  revealNeedsDialog,
  validateDraft,
  type LookingForDraft,
  type LookingForPost,
} from './lookingFor.ts';
import { DEFAULT_NSFW_PREFERENCE, parseNsfwPreference } from './nsfwPreference.ts';

const post = (over: Partial<LookingForPost> = {}): LookingForPost => ({
  id: 'u1_dating', authorId: 'u1', author: 'Willow', authorPronouns: 'she/her', title: 't', intro: 'i', lookingFor: 'l',
  intention: 'dating', tags: [], isNsfw: false, contentWarning: null, requestsPaused: false, timestamp: 1, ...over,
});

const ABOUT_ME = "I'm a soft masc who enjoys coffee dates, spontaneous road trips, music, and meaningful conversations. I'm a little introverted at first.";
const ABOUT_YOU = "Hoping to meet someone feminine who enjoys simple dates, deep conversations, and exploring new places. Someone genuine and kind.";
const draft = (over: Partial<LookingForDraft> = {}): LookingForDraft => ({
  ...EMPTY_DRAFT, title: 'Hello', intro: ABOUT_ME, lookingFor: ABOUT_YOU, intention: 'friendship', flair: 'Masc × Femme', ...over,
});

test('the board filters by category, blocked authors, age, location, interest and mature posts', () => {
  const posts = [
    post({ id: 'a', authorId: 'a', intention: 'dating', age: 25, region: 'Quezon City', tags: ['Books'] }),
    post({ id: 'b', authorId: 'b', intention: 'friendship', age: 31, region: 'Cebu City', tags: ['Gaming', 'Books'] }),
    post({ id: 'c', authorId: 'c', intention: 'friendship', isNsfw: true }),
    post({ id: 'd', authorId: 'd', intention: 'gaming', age: 22 }),
  ];
  const ids = (list: LookingForPost[]) => list.map((p) => p.id);
  assert.deepEqual(ids(applyLookingForFilters(posts, NO_FILTERS)), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids(applyLookingForFilters(posts, { ...NO_FILTERS, category: 'friendship' })), ['b', 'c']);
  assert.deepEqual(ids(applyLookingForFilters(posts, NO_FILTERS, ['b'])), ['a', 'c', 'd'], 'blocked authors never appear');
  assert.deepEqual(ids(applyLookingForFilters(posts, { ...NO_FILTERS, ageMin: 24, ageMax: 30 })), ['a'], 'only posts that show an age can match an age filter');
  assert.deepEqual(ids(applyLookingForFilters(posts, { ...NO_FILTERS, ageMin: 30 })), ['b']);
  assert.deepEqual(ids(applyLookingForFilters(posts, { ...NO_FILTERS, region: ' cebu city ' })), ['b']);
  assert.deepEqual(ids(applyLookingForFilters(posts, { ...NO_FILTERS, tag: 'books' })), ['a', 'b']);
  assert.deepEqual(ids(applyLookingForFilters(posts, { ...NO_FILTERS, mature: 'hide' })), ['a', 'b', 'd']);
});

test('the filter badge counts only the optional filters', () => {
  assert.equal(activeFilterCount(NO_FILTERS), 0);
  assert.equal(activeFilterCount({ ...NO_FILTERS, category: 'dating' }), 0);
  assert.equal(activeFilterCount({ ...NO_FILTERS, ageMin: 20, ageMax: 30, region: 'Cebu City', tag: 'Books', mature: 'hide' }), 4);
});

test('popular interests are merged case-insensitively and ordered by use', () => {
  const tags = popularTags([post({ tags: ['Books', 'Gaming'] }), post({ tags: ['books'] }), post({ tags: ['Gaming', 'Art'] }), post({ tags: [' '] })]);
  assert.deepEqual(tags, ['Books', 'Gaming', 'Art']);
});

test('a mature post is never open until the member reveals it, and "always hide" cannot be revealed at all', () => {
  const mature = { isNsfw: true };
  const plain = { isNsfw: false };
  for (const pref of ['hide', 'ask', 'confirm'] as const) assert.equal(postPresentation(plain, pref, false), 'open');
  assert.equal(postPresentation(mature, 'hide', false), 'blocked');
  assert.equal(postPresentation(mature, 'hide', true), 'blocked', 'a stale reveal does not override the setting');
  assert.equal(postPresentation(mature, 'ask', false), 'concealed');
  assert.equal(postPresentation(mature, 'confirm', false), 'concealed');
  assert.equal(postPresentation(mature, 'ask', true), 'open');
  assert.equal(postPresentation(mature, 'confirm', true), 'open');
});

test('only "ask before revealing" adds a confirmation dialog; the other levels still need the explicit tap', () => {
  assert.equal(revealNeedsDialog('ask'), true);
  assert.equal(revealNeedsDialog('confirm'), false);
  assert.equal(revealNeedsDialog('hide'), false);
});

test('the content setting defaults to the safest choice and ignores unknown values', () => {
  assert.equal(DEFAULT_NSFW_PREFERENCE, 'hide');
  assert.equal(parseNsfwPreference(null), 'hide');
  assert.equal(parseNsfwPreference('show-all'), 'hide');
  assert.equal(parseNsfwPreference(undefined), 'hide');
  for (const v of ['hide', 'ask', 'confirm'] as const) assert.equal(parseNsfwPreference(v), v);
});

test('a post id is derived from the member and intention', () => {
  assert.equal(lookingForPostId('abc', 'dating'), 'abc_dating');
});

test('the composer explains what is missing, and accepts a complete draft', () => {
  assert.deepEqual(validateDraft(draft(), 27), {});
  const empty = validateDraft(EMPTY_DRAFT, 27);
  for (const key of ['title', 'intro', 'lookingFor', 'intention', 'flair'] as const) assert.ok(empty[key], key);
  assert.ok(validateDraft(draft({ ageMin: '17' }), 27).ageMin);
  assert.ok(validateDraft(draft({ ageMax: '120' }), 27).ageMin);
  assert.ok(validateDraft(draft({ ageMin: '40', ageMax: '25' }), 27).ageMin);
  assert.deepEqual(validateDraft(draft({ ageMin: '24', ageMax: '32' }), 27), {});
  assert.ok(validateDraft(draft({ isNsfw: true, contentWarning: 'x'.repeat(121) }), 27).contentWarning);
});

test('the stored document leaves out anything the member did not choose to show', () => {
  const author = { uid: 'u1', name: ' Willow ', pronouns: 'she/her', avatar: 'cat.1.2' };
  const plain = draftToDocument(draft({ showPhoto: false }), author, 30);
  assert.equal(plain.age, 30, 'the age is the trusted account age, always stored');
  assert.equal(plain.flair, 'Masc × Femme');
  assert.equal(plain.title, 'Hello', 'the stored title is only what the member typed');
  assert.equal('authorAvatar' in plain, false);
  assert.equal('region' in plain, false);
  assert.equal('seekAgeMin' in plain, false);
  assert.equal(plain.authorName, 'Willow');
  assert.equal(plain.contentWarning, null);
  assert.equal(plain.isNsfw, false);
  const full = draftToDocument(draft({ showPhoto: true, ageMin: '24', ageMax: '32', region: 'Cebu City', tags: ['#Books', 'books', ' Art '], isNsfw: true, contentWarning: '  Mature themes ' }), author, 30);
  assert.equal(full.age, 30);
  assert.equal(full.authorAvatar, 'cat.1.2');
  assert.equal(full.seekAgeMin, 24);
  assert.equal(full.seekAgeMax, 32);
  assert.equal(full.region, 'Cebu City');
  assert.deepEqual(full.tags, ['Books', 'Art']);
  assert.equal(full.contentWarning, 'Mature themes');
  // The warning only travels with the flag.
  assert.equal(draftToDocument(draft({ isNsfw: false, contentWarning: 'leftover' }), author, null).contentWarning, null);
  // No private profile data is ever part of the document.
  const keys = Object.keys(full);
  for (const forbidden of ['birthDate', 'birthday', 'uid', 'email', 'exactLocation']) assert.equal(keys.includes(forbidden), false, forbidden);
});

test('editing starts from the stored post', () => {
  const stored = post({ age: 28, seekAgeMin: 25, seekAgeMax: 35, region: 'Cebu City', authorAvatar: 'cat.1.2', tags: ['Art'], isNsfw: true, contentWarning: 'Mature' });
  const d = draftFromPost(stored);
  assert.equal(d.flair, '', 'a post from before flairs opens with no flair chosen');
  assert.equal(d.showPhoto, true);
  assert.equal(d.ageMin, '25');
  assert.equal(d.contentWarning, 'Mature');
  assert.equal(draftFromPost(post({ flair: 'All WLW' })).flair, 'All WLW');
});

test('tags are cleaned and bounded, and the age range reads naturally', () => {
  assert.equal(cleanTag('  ##K-drama   fan '), 'K-drama fan');
  assert.equal(cleanTag('x'.repeat(40)).length, 20);
  assert.equal(preferredAgeText({ seekAgeMin: 24, seekAgeMax: 32 }), '24–32');
  assert.equal(preferredAgeText({ seekAgeMin: 28, seekAgeMax: 28 }), '28');
  assert.equal(preferredAgeText({ seekAgeMin: 24 }), '24+');
  assert.equal(preferredAgeText({ seekAgeMax: 30 }), 'up to 30');
  assert.equal(preferredAgeText({}), null);
});

test('a collapsed card previews three interests and says how many are held back', () => {
  const tags = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(previewTags(tags, false), { shown: ['a', 'b', 'c'], hidden: 2 });
  assert.deepEqual(previewTags(tags, true), { shown: tags, hidden: 0 });
  assert.deepEqual(previewTags(['a', 'b', 'c'], false), { shown: ['a', 'b', 'c'], hidden: 0 }, 'three fit, so nothing is hidden');
  assert.deepEqual(previewTags([], false), { shown: [], hidden: 0 });
});

// ----------------------------------------------------------------------------- the board's errors versus its empty answer
test('a refused read, a network failure and any other failure are told apart; an empty board is not an error at all', () => {
  assert.equal(feedErrorReason({ code: 'permission-denied' }), 'denied');
  assert.equal(feedErrorReason({ code: 'firestore/permission-denied' }), 'denied');
  assert.equal(feedErrorReason({ code: 'unavailable' }), 'failed', 'offline');
  assert.equal(feedErrorReason({ code: 'deadline-exceeded' }), 'failed');
  assert.equal(feedErrorReason({ code: 'failed-precondition' }), 'failed', 'e.g. a missing index');
  assert.equal(feedErrorReason(new Error('boom')), 'failed');
  assert.equal(feedErrorReason(null), 'failed');
  assert.equal(applyLookingForFilters([], NO_FILTERS, []).length, 0, 'an empty answer simply has no posts to show');
});

test('only a refusal for an account that already looks eligible is retried, a few times, with growing pauses', () => {
  assert.deepEqual([...FEED_RETRY_DELAYS_MS], [1500, 4000, 9000]);
  assert.equal(feedRetryDelay('denied', true, 0), 1500);
  assert.equal(feedRetryDelay('denied', true, 1), 4000);
  assert.equal(feedRetryDelay('denied', true, 2), 9000);
  assert.equal(feedRetryDelay('denied', true, 3), null, 'it gives up, and the member can still tap Try again');
  assert.equal(feedRetryDelay('denied', false, 0), null, 'a member who is not eligible is never retried; the screen explains');
  assert.equal(feedRetryDelay('failed', true, 0), null, 'other failures are not retried on their own');
  assert.equal(feedRetryDelay(null, true, 0), null);
});

// ------------------------------------------------------------------------------------- age and flair on a new post
test('the flair list is exactly the thirteen options, once each, and "×" is the multiplication sign', () => {
  assert.equal(LOOKING_FOR_FLAIRS.length, 13);
  assert.equal(new Set(LOOKING_FOR_FLAIRS).size, 13);
  assert.deepEqual([...LOOKING_FOR_FLAIRS].slice(0, 3), ['Masc × Femme', 'Masc × Masc', 'Masc × Any']);
  assert.equal(LOOKING_FOR_FLAIRS[12], 'All WLW');
  for (const flair of LOOKING_FOR_FLAIRS) assert.ok(isFlair(flair));
  assert.ok(LOOKING_FOR_FLAIRS.slice(0, 12).every((f) => f.includes(' × ')));
});

test('a post needs an age from the account: missing, under 18 and out-of-range ages are all refused', () => {
  assert.ok(validateDraft(draft(), null).age, 'missing age');
  assert.ok(validateDraft(draft(), 17).age, 'under 18');
  assert.ok(validateDraft(draft(), 0).age);
  assert.ok(validateDraft(draft(), 18.5).age, 'not an integer');
  assert.ok(validateDraft(draft(), 100).age);
  assert.equal(validateDraft(draft(), 18).age, undefined);
  assert.equal(validateDraft(draft(), 99).age, undefined);
});

test('a post needs one valid flair: missing and invented ones are refused', () => {
  assert.ok(validateDraft(draft({ flair: '' }), 27).flair, 'missing');
  assert.ok(validateDraft(draft({ flair: 'Femme × Femme ' as never }), 27).flair, 'stray space');
  assert.ok(validateDraft(draft({ flair: 'Masc x Femme' as never }), 27).flair, 'a letter x is not the sign');
  assert.ok(validateDraft(draft({ flair: 'Everyone' as never }), 27).flair, 'not on the list');
  assert.equal(isFlair(undefined), false);
  assert.equal(isFlair(null), false);
  assert.equal(isFlair(5), false);
});

test('the title is built from the structured age and flair, and the member types only the rest', () => {
  assert.equal(composeTitle(18, 'Masc × Femme', 'Looking for kasama mag-coffee'), '18 [Masc × Femme] Looking for kasama mag-coffee');
  assert.equal(composeTitle(31, 'All WLW', '  spaced  '), '31 [All WLW] spaced');
  assert.equal(postDisplayTitle(post({ age: 24, flair: 'Trans Femme × Any', title: 'Hi there' })), '24 [Trans Femme × Any] Hi there');
  const stored = draftToDocument(draft({ title: 'Looking for kasama mag-coffee', flair: 'Masc × Femme' }), { uid: 'u1', name: 'W', pronouns: '' }, 18);
  assert.equal(stored.title, 'Looking for kasama mag-coffee', 'the prefix is never stored in the title');
  assert.equal(stored.age, 18);
  assert.equal(stored.flair, 'Masc × Femme');
  assert.equal(composeTitle(stored.age as number, stored.flair as string, stored.title as string), '18 [Masc × Femme] Looking for kasama mag-coffee');
});

test('posts from before flairs still read and show their title unchanged', () => {
  assert.equal(postDisplayTitle(post({ title: 'Old post' })), 'Old post');
  assert.equal(postDisplayTitle(post({ title: 'Old post', age: 25 })), 'Old post', 'an age alone adds nothing');
  assert.equal(postDisplayTitle(post({ title: 'Old post', flair: 'Masc × Femme' })), 'Old post', 'a flair alone adds nothing');
  assert.equal(composeTitle(18, 'not a flair', 'Old post'), 'Old post');
});

// ------------------------------------------------------------------------------------------- NSFW Connection
test('NSFW Connection is a sixth intention, selectable, named and filterable like the others', () => {
  assert.equal(INTENTIONS.length, 6);
  assert.deepEqual([...INTENTIONS], ['dating', 'friendship', 'talk', 'gaming', 'open', 'nsfw']);
  assert.equal(INTENTION_LABELS.nsfw, 'NSFW Connection');
  assert.equal(NSFW_INTENTION, 'nsfw');
  assert.ok(isIntention('nsfw'));
  assert.ok(!isIntention('NSFW'));
  assert.ok(LOOKING_FOR_CATEGORIES.some((c) => c.id === 'nsfw'));
  assert.equal(lookingForPostId('abc', 'nsfw'), 'abc_nsfw');
  const board = [post({ id: 'a_nsfw', authorId: 'a', intention: 'nsfw', isNsfw: true }), post({ id: 'b_dating', authorId: 'b', intention: 'dating' })];
  assert.deepEqual(applyLookingForFilters(board, { ...NO_FILTERS, category: 'nsfw' }).map((p) => p.id), ['a_nsfw']);
  assert.deepEqual(applyLookingForFilters(board, { ...NO_FILTERS, category: 'dating' }).map((p) => p.id), ['b_dating']);
  assert.deepEqual(applyLookingForFilters(board, { ...NO_FILTERS, mature: 'hide' }).map((p) => p.id), ['b_dating'], 'hiding mature posts hides them');
});

test('an NSFW Connection post is always stored as mature, whatever the switch says, and other intentions are unchanged', () => {
  const author = { uid: 'u1', name: 'W', pronouns: '' };
  assert.equal(draftToDocument(draft({ intention: 'nsfw', isNsfw: false }), author, 30).isNsfw, true);
  assert.equal(draftToDocument(draft({ intention: 'nsfw', isNsfw: true, contentWarning: 'Mature themes' }), author, 30).contentWarning, 'Mature themes');
  assert.equal(draftToDocument(draft({ intention: 'nsfw', isNsfw: false, contentWarning: 'leftover' }), author, 30).contentWarning, 'leftover', 'the warning travels because the post is mature');
  assert.equal(draftToDocument(draft({ intention: 'dating', isNsfw: false }), author, 30).isNsfw, false);
  assert.equal(draftToDocument(draft({ intention: 'dating', isNsfw: true }), author, 30).isNsfw, true);
  assert.deepEqual(validateDraft(draft({ intention: 'nsfw' }), 27), {});
  assert.equal(postPresentation({ isNsfw: true }, 'hide', true), 'blocked');
  assert.equal(postPresentation({ isNsfw: true }, 'ask', false), 'concealed');
});

// ------------------------------------------------------------------------------------- About me / About you minimums
test('the two sample sections are long enough, and the minimum is 100 trimmed characters with the old maximums kept', () => {
  assert.ok(ABOUT_ME.length >= 100 && ABOUT_YOU.length >= 100);
  assert.equal(LIMITS.minSection, 100);
  assert.equal(LIMITS.intro, 400);
  assert.equal(LIMITS.lookingFor, 400);
});

test('About me and About you each need 100 characters, counted after trimming', () => {
  const exactly = (n: number) => 'a'.repeat(n);
  assert.deepEqual(validateDraft(draft({ intro: exactly(100), lookingFor: exactly(100) }), 27), {});
  assert.ok(validateDraft(draft({ intro: exactly(99) }), 27).intro, '99 is too short');
  assert.ok(validateDraft(draft({ lookingFor: exactly(99) }), 27).lookingFor, '99 is too short');
  assert.ok(validateDraft(draft({ intro: '   ' + exactly(98) + '   ' }), 27).intro, 'padding spaces do not count');
  assert.ok(validateDraft(draft({ lookingFor: '\n\n' + exactly(98) + '\n' }), 27).lookingFor, 'blank lines do not count');
  assert.equal(validateDraft(draft({ intro: '  ' + exactly(100) + '  ' }), 27).intro, undefined);
  assert.ok(validateDraft(draft({ intro: '', lookingFor: '' }), 27).intro);
  assert.ok(validateDraft(draft({ intro: '', lookingFor: '' }), 27).lookingFor);
});

test('the saved sections are trimmed, so their stored length is the counted length', () => {
  const doc = draftToDocument(draft({ intro: '  ' + ABOUT_ME + '  ', lookingFor: '\n' + ABOUT_YOU + '\n' }), { uid: 'u1', name: 'W', pronouns: '' }, 30);
  assert.equal(doc.intro, ABOUT_ME);
  assert.equal(doc.lookingFor, ABOUT_YOU);
  const cut = draftToDocument(draft({ intro: 'x'.repeat(399) + ' y' }), { uid: 'u1', name: 'W', pronouns: '' }, 30);
  assert.equal(cut.intro, 'x'.repeat(399), 'a cut that ends on a space is trimmed again');
});

test('older posts with short sections are still read as they are', () => {
  assert.equal(post({ intro: 'short', lookingFor: 'short' }).intro, 'short');
  const d = draftFromPost(post({ intro: 'short', lookingFor: 'short' }));
  assert.ok(validateDraft(d, 27).intro, 'editing one asks for the new minimum');
});

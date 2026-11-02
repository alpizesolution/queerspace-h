import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeFilterCount,
  applyLookingForFilters,
  cleanTag,
  draftFromPost,
  draftToDocument,
  EMPTY_DRAFT,
  lookingForPostId,
  NO_FILTERS,
  formatPostedDate,
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
  intention: 'dating', tags: [], isNsfw: false, contentWarning: null, timestamp: 1, ...over,
});

const draft = (over: Partial<LookingForDraft> = {}): LookingForDraft => ({
  ...EMPTY_DRAFT, title: 'Hello', intro: 'About me', lookingFor: 'Someone kind', intention: 'friendship', ...over,
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
  assert.deepEqual(validateDraft(draft(), null), {});
  const empty = validateDraft(EMPTY_DRAFT, null);
  for (const key of ['title', 'intro', 'lookingFor', 'intention'] as const) assert.ok(empty[key], key);
  assert.ok(validateDraft(draft({ showAge: true }), null).showAge, 'cannot show an age without a birthday');
  assert.ok(validateDraft(draft({ showAge: true }), 17).showAge);
  assert.deepEqual(validateDraft(draft({ showAge: true }), 27), {});
  assert.ok(validateDraft(draft({ ageMin: '17' }), null).ageMin);
  assert.ok(validateDraft(draft({ ageMax: '120' }), null).ageMin);
  assert.ok(validateDraft(draft({ ageMin: '40', ageMax: '25' }), null).ageMin);
  assert.deepEqual(validateDraft(draft({ ageMin: '24', ageMax: '32' }), null), {});
  assert.ok(validateDraft(draft({ isNsfw: true, contentWarning: 'x'.repeat(121) }), null).contentWarning);
});

test('the stored document leaves out anything the member did not choose to show', () => {
  const author = { uid: 'u1', name: ' Willow ', pronouns: 'she/her', avatar: 'cat.1.2' };
  const plain = draftToDocument(draft({ showPhoto: false }), author, 30);
  assert.equal('age' in plain, false, 'age is never stored unless shown');
  assert.equal('authorAvatar' in plain, false);
  assert.equal('region' in plain, false);
  assert.equal('seekAgeMin' in plain, false);
  assert.equal(plain.authorName, 'Willow');
  assert.equal(plain.contentWarning, null);
  assert.equal(plain.isNsfw, false);
  const full = draftToDocument(draft({ showPhoto: true, showAge: true, ageMin: '24', ageMax: '32', region: 'Cebu City', tags: ['#Books', 'books', ' Art '], isNsfw: true, contentWarning: '  Mature themes ' }), author, 30);
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
  assert.equal(d.showAge, true);
  assert.equal(d.showPhoto, true);
  assert.equal(d.ageMin, '25');
  assert.equal(d.contentWarning, 'Mature');
  assert.equal(draftFromPost(post()).showAge, false);
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

test('a post date shows the time today and the day afterwards', () => {
  const noon = new Date(2026, 10, 3, 12, 0).getTime();
  assert.match(formatPostedDate(new Date(2026, 10, 3, 9, 5).getTime(), noon), /\d{1,2}:\d{2}/);
  assert.doesNotMatch(formatPostedDate(new Date(2026, 10, 2, 9, 5).getTime(), noon), /:/);
  assert.match(formatPostedDate(new Date(2026, 10, 2, 9, 5).getTime(), noon), /Nov/);
  assert.doesNotMatch(formatPostedDate(new Date(2026, 10, 2, 9, 5).getTime(), noon), /2026/);
  assert.match(formatPostedDate(new Date(2025, 11, 30, 9, 5).getTime(), noon), /2025/);
});

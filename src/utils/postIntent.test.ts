import test from 'node:test';
import assert from 'node:assert/strict';
import { communityToLookingFor, lookingForToCommunity, suggestsLookingFor } from './postIntent.ts';
import { CATEGORIES, COMPOSER_CATEGORIES, FILTER_CATEGORIES, CATEGORY_LABELS, matchesCategory } from './communityCategories.ts';
import { COMPOSER_INTENTIONS, INTENTIONS, LOOKING_FOR_CATEGORIES, applyLookingForFilters, NO_FILTERS, type LookingForPost } from './lookingFor.ts';

test('Community offers sharing categories only: no Friend Finder, no Dating', () => {
  assert.deepEqual(CATEGORIES.map((c) => c.label), ['All', 'Cozy Events', 'Books & Media', 'Community Talk', 'Experiences']);
  assert.deepEqual(FILTER_CATEGORIES.map((c) => c.id), ['all', 'events', 'media', 'talk', 'experiences']);
  assert.deepEqual(COMPOSER_CATEGORIES.map((c) => c.id), ['events', 'media', 'talk', 'experiences']);
});

test('Looking For is organised around the requested intents, in order', () => {
  assert.deepEqual(LOOKING_FOR_CATEGORIES.filter((c) => c.id !== 'nsfw').map((c) => c.label), ['All', 'Friendship', 'Dating / R4R', 'Activity Buddy', 'Gaming Buddy', 'Travel Buddy']);
  assert.deepEqual([...COMPOSER_INTENTIONS], ['friendship', 'dating', 'activity', 'gaming', 'travel', 'nsfw']);
  for (const id of COMPOSER_INTENTIONS) assert.ok(INTENTIONS.includes(id), id);
});

test('older Community posts stay readable: they keep their label and show where they best fit, or under All', () => {
  for (const legacy of ['general', 'vents', 'friends', 'advice']) assert.ok(CATEGORY_LABELS[legacy], `${legacy} still has a label`);
  assert.equal(matchesCategory('friends', 'all'), true);
  assert.equal(matchesCategory('advice', 'all'), true);
  assert.equal(matchesCategory('general', 'talk'), true);
  assert.equal(matchesCategory('vents', 'experiences'), true);
  // The old dating and friend-finding posts do not leak into the new sharing categories.
  for (const filter of ['events', 'media', 'talk', 'experiences']) {
    assert.equal(matchesCategory('friends', filter), false);
    assert.equal(matchesCategory('advice', filter), false);
  }
  assert.equal(matchesCategory('media', 'media'), true);
  assert.equal(matchesCategory('media', 'talk'), false);
});

test('older Looking For posts (talk, open) stay on the board under All and cannot be filtered into the new intents', () => {
  const post = (intention: LookingForPost['intention']) => ({ id: `u_${intention}`, authorId: 'u', author: 'A', authorPronouns: '', title: 't', intro: '', lookingFor: '', intention, tags: [], isNsfw: false, contentWarning: null, requestsPaused: false, timestamp: 1 }) as LookingForPost;
  const board = [post('talk'), post('open'), post('activity'), post('travel'), post('dating')];
  assert.equal(applyLookingForFilters(board, NO_FILTERS).length, 5);
  assert.deepEqual(applyLookingForFilters(board, { ...NO_FILTERS, category: 'activity' }).map((p) => p.id), ['u_activity']);
  assert.deepEqual(applyLookingForFilters(board, { ...NO_FILTERS, category: 'travel' }).map((p) => p.id), ['u_travel']);
});

test('the suggestion only appears for clear find-someone posts, never for ordinary conversation', () => {
  for (const text of ['r4r anyone?', 'Looking for a girlfriend in QC', 'looking for a date this weekend', 'DM me if you’re interested']) {
    assert.equal(suggestsLookingFor(text), true, text);
  }
  for (const text of [
    'Anyone want to go to the book fair on Saturday? I would love some company.',
    'Dating is hard. How do you all handle the anxiety?',
    'Looking for book recommendations about found family',
    'Cozy movie night this Friday, come if you can!',
    'I am looking for advice on a date I went on',
  ]) assert.equal(suggestsLookingFor(text), false, text);
});

test('switching posts carries every written word across, in both directions', () => {
  assert.deepEqual(communityToLookingFor('  Coffee date?  ', ' Hi, I am Mara and I like books. '), { title: 'Coffee date?', intro: 'Hi, I am Mara and I like books.' });
  assert.deepEqual(lookingForToCommunity({ title: 'Hello', intro: 'About me', lookingFor: 'About you' }), { title: 'Hello', content: 'About me\n\nAbout you' });
  assert.deepEqual(lookingForToCommunity({ title: 'Hello', intro: 'About me', lookingFor: '' }), { title: 'Hello', content: 'About me' });
});

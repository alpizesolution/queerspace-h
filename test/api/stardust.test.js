// Stardust, checks that need no emulator: the one system replaces Likes everywhere, clients never write it, and the UI
// follows the spec. The behaviour itself is tested against real emulators in stardust.integration.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const community = read('src/components/CommunityFeedView.tsx');
const lookingFor = read('src/components/LookingForView.tsx');
const button = read('src/components/StardustButton.tsx');
const clientService = read('src/services/stardustService.ts');
const communityService = read('src/services/communityService.ts');
const rules = read('firestore.rules');
const api = read('api/stardust.js');
const core = read('api/_stardust.js');

test('the same Stardust button is used by Community and Looking For, and Community has no Like or Heart left', () => {
  assert.match(community, /<StardustButton/);
  assert.match(lookingFor, /<StardustButton/);
  for (const [name, source] of [['community', community], ['looking for', lookingFor], ['button', button]]) {
    assert.doesNotMatch(source, /\bHeart\b|Unlike|aria-label=\{[^}]*'Like'/, `${name}: no heart or like control`);
    assert.doesNotMatch(source, /Upvote|Downvote|ThumbsUp|ThumbsDown/, `${name}: no vote controls`);
  }
  assert.doesNotMatch(communityService, /setCommunityLike/, 'the like writer is gone');
  assert.doesNotMatch(community, /qs_community_liked/, 'no device-only like memory');
});

test('the button says Give Stardust or Given, shows the count, and is accessible', () => {
  assert.match(button, /given \? 'Given' : 'Give Stardust'/);
  assert.match(button, /Sparkles/);
  assert.match(button, /aria-pressed=\{given\}/);
  assert.match(button, /aria-label=\{given \?/);
  assert.match(button, /\{count\}/);
  assert.match(button, /type="button"/, 'a real button: keyboard and screen reader support come with it');
  assert.match(button, /disabled=\{pending\}/, 'a second tap while one is on its way does nothing');
  assert.match(read('src/index.css'), /prefers-reduced-motion: reduce\) \{\s*\.stardust-spark/, 'the sparkle respects reduced motion');
});

test('own posts show the count but offer nothing to give', () => {
  assert.match(button, /if \(own\) \{/);
  assert.match(community, /own=\{Boolean\(uid\) && post\.authorId === uid\}/);
  assert.match(lookingFor, /own=\{mine\}/);
});

test('the client only talks to /api/stardust and never writes a reaction or a counter', () => {
  assert.match(clientService, /fetch\('\/api\/stardust'/);
  assert.doesNotMatch(clientService, /setDoc|addDoc|updateDoc|writeBatch|deleteDoc|runTransaction|increment\(/);
  assert.doesNotMatch(read('src/hooks/useStardust.ts'), /collection\(|doc\(|onSnapshot/, 'no listeners and no direct reads');
});

test('a give or remove updates only the affected post, and never reloads the feed', () => {
  const hook = read('src/hooks/useStardust.ts');
  assert.match(hook, /setOverrides\(\(prev\) => \(\{ \.\.\.prev, \[postId\]:/);
  assert.doesNotMatch(hook, /reload\(|refetch|setPosts|window\.location/);
  assert.match(hook, /known\.current\.has\(id\)/, 'a post is asked about once');
  assert.match(hook, /MAX_STATE_IDS/, 'asked in batches that match the API limit');
});

test('the rules let no client write Stardust, and keep totals readable only to signed-in members', () => {
  assert.match(rules, /match \/stardust\/\{userId\} \{[^}]*allow create, update: if false;/s);
  assert.match(rules, /match \/stardust_totals\/\{authorId\} \{\s*allow read: if isAuthenticated\(\);\s*allow write: if false;/);
  assert.doesNotMatch(rules, /counterMoves\('likes'/, 'the client like counter rules are gone');
  assert.doesNotMatch(rules, /counterMoves\('stardustCount'/);
  assert.match(rules, /!request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasAny\(\['stardustCount'\]\)/, 'a Looking For edit cannot change the count');
});

test('the endpoint verifies the token, writes in transactions, and keeps the rate limit and block checks', () => {
  assert.match(api, /authenticate\(req\)/);
  assert.match(api, /method !== 'POST'/);
  assert.match(core, /runTransaction\(update, \{ maxAttempts: 1 \}\)/);
  assert.match(core, /rateLimit\(db, uid, 'stardust'/);
  assert.match(core, /blockedPartnerIds/);
  assert.match(core, /suspensions\/\$\{uid\}/);
  assert.match(core, /throw fail\(403, 'own_post'\)/);
  assert.match(core, /Math\.max\(0, /, 'counts cannot go below zero');
  assert.doesNotMatch(api + core, /req\.body\.(count|total|stardustCount)|body\.(count|total)/, 'client numbers are never read');
});

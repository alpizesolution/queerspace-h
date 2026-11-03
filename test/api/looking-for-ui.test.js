import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const cosmos = read('src/components/CommunityFeedView.tsx');
const board = read('src/components/LookingForView.tsx');
const composer = read('src/components/LookingForComposer.tsx');
const service = read('src/services/lookingForService.ts');
const settings = read('src/components/AppearanceSettingsModal.tsx');
const app = read('src/App.tsx');
const rules = read('firestore.rules');
const lfRules = rules.slice(rules.indexOf('4b. COSMOS "LOOKING FOR" BOARD'), rules.indexOf('5. ABUSE & SAFETY REPORTS'));

test('Cosmos gets a Community / Looking For switch under the heading, and the community feed is kept as it was', () => {
  const heading = cosmos.indexOf('>Cosmos</h1>');
  const tabs = cosmos.indexOf('aria-label="Cosmos sections"');
  assert.ok(heading > 0 && tabs > heading, 'the switch sits below the Cosmos heading');
  assert.match(cosmos, /\['community', 'Community'\], \['lookingFor', 'Looking For'\]/);
  assert.match(cosmos, /section === 'lookingFor' \? \(\s*<LookingForView/);
  // Every community category, post action and the composer are still there.
  for (const label of ['All', 'Cozy Vents', 'Books & Media', 'Friend Finder', 'Dating & Advice', 'General']) assert.ok(read('src/utils/communityCategories.ts').includes(`label: '${label}'`), label);
  for (const kept of ['subscribeToCommunity', 'setCommunityLike', 'replyToCommunityPost', 'createCommunityPost', 'adminDeleteCommunityPost', 'subscribeToReplies']) assert.ok(cosmos.includes(kept), kept);
  assert.match(cosmos, /useState<'community' \| 'lookingFor'>\('community'\)/, 'opens on Community');
});

test('Looking For has the six categories and the filters asked for', () => {
  const util = read('src/utils/lookingFor.ts');
  for (const label of ['All', 'Dating', 'Friendship', 'Kausap', 'Gaming Buddies', 'Open to Connections']) assert.ok(util.includes(`label: '${label}'`), label);
  for (const label of ['Someone to talk to', 'Gaming buddy', 'Open to connections']) assert.ok(util.includes(label), label);
  for (const filter of ['Age range', 'Location', 'Interests', 'Mature posts']) assert.ok(board.includes(filter), filter);
});

test('the composer has every requested field, and the NSFW toggle with its description', () => {
  for (const text of ['Title', 'About you', 'What are you looking for?', 'Preferred age range', 'Location', 'Interests', 'Show my age', 'Show my avatar', 'Mark as NSFW', 'Hide mature or sexually suggestive content behind a content warning.', 'Content warning']) {
    assert.ok(composer.includes(text), text);
  }
  assert.match(composer, /Don’t show a location/, 'location is optional and city or province only');
  assert.match(composer, /never an exact place/);
  assert.match(composer, /Explicit sexual imagery, non-consensual or exploitative content and anything involving minors are never allowed/);
  assert.equal((composer.match(/<form/g) || []).length, 1, 'no nested forms');
});

test('a covered post puts none of its sensitive text on the page', () => {
  const start = board.search(/\)\s*:\s*\(\s*<SensitiveCover/);
  assert.ok(start > 0, 'the covered branch exists');
  const covered = board.slice(start, board.indexOf('</article>', start));
  assert.ok(covered.includes('SensitiveCover'), 'the shared cover stands in for the text');
  for (const field of ['post.title', 'post.intro', 'post.lookingFor', 'post.tags', 'post.region']) assert.equal(covered.includes(field), false, `${field} must not render while covered`);
  assert.match(read('src/components/SensitiveCover.tsx'), /Sensitive content/);
  assert.match(covered, /onReveal=\{\(\) => reveal\(post\)\}/);
  assert.match(read('src/components/SensitiveCover.tsx'), /Reveal content/);
  assert.match(read('src/components/SensitiveCover.tsx'), /aria-hidden="true" className="space-y-2 blur/);
});

test('content is only ever revealed by an explicit action on that one post', () => {
  assert.match(board, /useState<Set<string>>\(\(\) => new Set\(\)\)/, 'starts with nothing revealed, and is not stored');
  assert.doesNotMatch(board, /localStorage|sessionStorage/, 'reveals are not remembered between visits');
  const adds = [...board.matchAll(/setRevealed\(/g)].length;
  assert.equal(adds, 3, 'reveal, confirm and hide-again are the only places that change it');
  // None of them live in an effect or an observer, so scrolling can never reveal anything.
  assert.doesNotMatch(board, /IntersectionObserver|onScroll|useEffect\([^)]*setRevealed/);
  assert.match(board, /if \(nsfwPreference === 'hide'\) return;/, '"always hide" has no way in');
  assert.match(board, /revealNeedsDialog\(nsfwPreference\)/);
  assert.match(board, /Show sensitive content\?/);
});

test('the content setting is in Settings, defaults to Always hide, and is stored on the device', () => {
  const util = read('src/utils/nsfwPreference.ts');
  assert.match(util, /DEFAULT_NSFW_PREFERENCE: NsfwPreference = 'hide'/);
  for (const label of ['Always hide', 'Ask before revealing', 'Show after confirmation']) assert.ok(util.includes(label), label);
  assert.match(settings, /Show NSFW content/);
  assert.match(app, /loadNsfwPreference/);
  assert.match(app, /nsfwPreference=\{nsfwPreference\}/);
});

test('contacting an author is a connection request through the Signals API; there is no separate messaging system', () => {
  const requests = read('src/services/connectionRequestsService.ts');
  assert.match(requests, /fetch\(`\/api\/signals/);
  assert.match(requests, /action: 'request-create'/);
  assert.doesNotMatch(requests + service, /collection\(db, '(messages|conversations|chats|signalsPairs)/);
  assert.match(board, /<ConnectionRequestSheet/);
  assert.doesNotMatch(board + service, /sendSignalFromPost|SignalSheet/, 'the earlier direct Signal shortcut is gone');
  assert.match(read('src/components/ConnectionRequestSheet.tsx'), /needs to accept before private messaging opens/);
});

test('reporting and blocking are available on every other member\'s post', () => {
  assert.match(service, /targetType: 'post'/);
  assert.match(service, /targetId: `looking_for:\$\{postId\}`/);
  assert.match(board, /<Flag /);
  assert.match(board, /onBlockMember/);
  assert.match(board, /applyLookingForFilters\(posts, filters, blockedPartnerIds\)/);
  assert.match(app, /handleBlockMember/);
});

test('the rules check adulthood, ownership, pace and age claims on the server, not the client', () => {
  assert.match(lfRules, /allow read: if isAuthenticated\(\) && isEligibleMember\(request\.auth\.uid\)/);
  assert.match(lfRules, /allow create:[\s\S]*isEligibleMember\(request\.auth\.uid\)[\s\S]*!isSuspended\(\)/);
  assert.match(lfRules, /postId == request\.auth\.uid \+ '_' \+ request\.resource\.data\.intention/);
  assert.match(lfRules, /slowMode\('lookingForPost', 60\)/);
  assert.match(lfRules, /lookingForAgeMatches/);
  assert.match(lfRules, /request\.auth\.uid == resource\.data\.authorId/);
  assert.match(lfRules, /allow delete: if isAuthenticated\(\) && \(request\.auth\.uid == resource\.data\.authorId \|\| isAdmin\(\)\)/);
  assert.doesNotMatch(lfRules, /allow (read|create|update|delete|write): if true/);
  // Nothing privileged or private can be written onto a post.
  for (const forbidden of ['birthDate', 'role', 'isAdmin', 'status', 'blockedPartnerIds']) {
    const allowedKeys = lfRules.match(/hasOnly\(\[[^\]]*\]\)/g).join(' ');
    assert.equal(allowedKeys.includes(`'${forbidden}'`), false, forbidden);
  }
  assert.match(rules, /'lookingForPost'\]\)/, 'the pace stamp is an allowed rate-limit field');
});

test('the one-post-per-intention id is derived the same way on the client and in the rules', () => {
  assert.match(read('src/utils/lookingFor.ts'), /lookingForPostId = \(uid: string, intention: LookingForIntention\) => `\$\{uid\}_\$\{intention\}`/);
  assert.match(service, /doc\(db, 'looking_for_posts', lookingForPostId\(uid, draft\.intention\)\)/);
  assert.match(service, /LOOKING_FOR_SLOW_MODE_SECONDS = 60/);
});

test('the board query has the composite index it needs, and no new serverless function was added', () => {
  const indexes = JSON.parse(read('firestore.indexes.json')).indexes;
  const index = indexes.find((i) => i.collectionGroup === 'looking_for_posts');
  assert.ok(index, 'composite index for intention + newest first');
  assert.deepEqual(index.fields.map((f) => `${f.fieldPath}:${f.order}`), ['intention:ASCENDING', 'timestamp:DESCENDING']);
  assert.ok(fs.existsSync('api/_adult.js'));
});

test('optional empty fields are not run through the content filter, which treats empty text as blocked', () => {
  assert.match(composer, /if \(!draft\[key\]\.trim\(\)\) \{\s*cleaned\[key\] = '';\s*continue;/);
  assert.match(read('src/utils/matching-logic.ts'), /if \(!trimmed\) \{\s*return \{ cleanText: '', isBlocked: true/);
});

test('a request with no introduction is allowed: the optional hello skips the content filter', () => {
  assert.match(read('src/components/ConnectionRequestSheet.tsx'), /text\.trim\(\) \? sanitizeMessageText\(text\.trim\(\)\) : \{ cleanText: '', isBlocked: false \}/);
});

test('the board asks the same questions of everyone: no filter on the viewer\'s own post, intention, profile or connections', () => {
  const feed = service.slice(service.indexOf('export function subscribeToLookingFor'), service.indexOf('export type LookingForWriteResult'));
  assert.match(feed, /query\(base, orderBy\('timestamp', 'desc'\), limit\(LOOKING_FOR_HISTORY\)\)/);
  assert.match(feed, /query\(base, where\('intention', '==', category\), orderBy\('timestamp', 'desc'\), limit\(LOOKING_FOR_HISTORY\)\)/);
  assert.doesNotMatch(feed, /where\('authorId'|uid\b.*where\(|blocked|profileComplete/, 'nothing about the viewer narrows the board');
  assert.match(feed, /onError\(feedErrorReason\(err\)\)/, 'a refusal and any other failure are reported as different things');
});

test('a refusal is retried for an account that looks eligible, never leaves the new member stuck, and has a Try again', () => {
  assert.match(board, /const locallyEligible = adult && userPrefs\.profileComplete === true;/);
  assert.match(board, /\}, \[available, filters\.category, reloadKey\]\);/, 'asking again re-subscribes');
  assert.match(board, /feedRetryDelay\(loadError, locallyEligible, autoTries\.current\)/);
  assert.match(board, /locallyEligible && <button[\s\S]*?>Try again<\/button>/, 'the refusal screen offers Try again to an eligible-looking member');
  assert.match(board, /Couldn’t load posts\. <button[\s\S]*?>Try again<\/button>/, 'a plain failure offers Try again too');
  assert.match(board, /No posts here yet/, 'an empty board still has its own message');
});

test('reading the board still needs an eligible adult member, and the rules for writing are unchanged', () => {
  assert.match(lfRules, /allow read: if isAuthenticated\(\) && isEligibleMember\(request\.auth\.uid\);/);
  assert.match(lfRules, /allow delete: if isAuthenticated\(\) && \(request\.auth\.uid == resource\.data\.authorId \|\| isAdmin\(\)\);/);
  assert.match(lfRules, /request\.auth\.uid == resource\.data\.authorId/);
});

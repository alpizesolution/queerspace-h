import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LOOKING_FOR_FLAIRS as SERVER_FLAIRS, displayTitle } from '../../api/_flair.js';
import { LOOKING_FOR_FLAIRS as CLIENT_FLAIRS, composeTitle } from '../../src/utils/lookingFor.ts';

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
  const heading = cosmos.indexOf('>COSMOS</h1>');
  const tabs = cosmos.indexOf('aria-label="Cosmos sections"');
  assert.ok(heading > 0 && tabs > heading, 'the switch sits below the Cosmos heading');
  assert.match(cosmos, /\['community', 'Community'\], \['lookingFor', 'Looking For'\]/);
  assert.match(cosmos, /section === 'lookingFor' && !focusMode \? \(\s*<LookingForView/);
  // Every community category, post action and the composer are still there.
  for (const label of ['All', 'Cozy Vents', 'Books & Media', 'Friend Finder', 'Dating', 'General']) assert.ok(read('src/utils/communityCategories.ts').includes(`label: '${label}'`), label);
  for (const kept of ['subscribeToCommunity', 'replyToCommunityPost', 'createCommunityPost', 'adminDeleteCommunityPost', 'subscribeToReplies']) assert.ok(cosmos.includes(kept), kept);
  assert.match(cosmos, /useState<'community' \| 'lookingFor'>\('community'\)/, 'opens on Community');
});

test('Looking For has the six categories and the filters asked for', () => {
  const util = read('src/utils/lookingFor.ts');
  for (const label of ['All', 'Dating', 'Friendship', 'Kausap', 'Gaming Buddies', 'Open to Connections']) assert.ok(util.includes(`label: '${label}'`), label);
  for (const label of ['Someone to talk to', 'Gaming buddy', 'Open to connections']) assert.ok(util.includes(label), label);
  for (const filter of ['Age range', 'Location', 'Interests', 'Mature posts']) assert.ok(board.includes(filter), filter);
});

test('the composer has every requested field, and the NSFW toggle with its description', () => {
  for (const text of ['Title', 'About me', 'About you', 'Preferred age range', 'Location', 'Interests', 'Looking for', 'Show my avatar', 'Mark as NSFW', 'Hide mature or sexually suggestive content behind a content warning.', 'Content warning']) {
    assert.ok(composer.includes(text), text);
  }
  assert.match(composer, /Don’t show a location/, 'location is optional and city or province only');
  assert.match(composer, /never an exact place/);
  assert.match(composer, /Explicit sexual imagery, non-consensual or exploitative content and anything involving minors are never allowed/);
  assert.equal((composer.match(/<form/g) || []).length, 1, 'no nested forms');
});

test('Looking For posts show in full: an NSFW post is only labelled with its badge, with no cover, blur or reveal', () => {
  for (const gone of ['SensitiveCover', 'Reveal content', 'Sensitive content', 'EyeOff', 'revealed', 'setRevealed', 'confirmReveal', 'Show sensitive content', 'postPresentation', 'revealNeedsDialog']) {
    assert.equal(board.includes(gone), false, `the board has no ${gone}`);
  }
  assert.match(board, /<LookingForBody\s+post=\{post\}/, 'every post mounts its real content');
  assert.match(board, /canCoverAgain=\{false\}/, 'no "Hide again" on the board');
  assert.match(board, /\{post\.isNsfw && <Badge tone="nsfw">NSFW<\/Badge>\}/, 'the badge is shown only for NSFW posts');
  assert.equal((board.match(/<Badge tone="nsfw">/g) || []).length, 1);
});

test('the cover still exists for the other places that use it (profile pages), unchanged', () => {
  const profile = read('src/components/ProfileSections.tsx');
  assert.match(profile, /SensitiveCover/);
  assert.match(profile, /if \(nsfwPreference === 'hide'\) return;/);
  assert.match(read('src/components/SensitiveCover.tsx'), /Reveal content/);
  assert.match(read('src/components/SensitiveCover.tsx'), /aria-hidden="true" className="space-y-2 blur/);
  assert.match(read('src/utils/lookingFor.ts'), /export function postPresentation/);
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

test('the flair list is identical in the rules, the server and the app', () => {
  const inRules = [...rules.slice(rules.indexOf('function lookingForFlairs()'), rules.indexOf('// "About me" and "About you"')).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(inRules, [...CLIENT_FLAIRS]);
  assert.deepEqual([...SERVER_FLAIRS], [...CLIENT_FLAIRS]);
  assert.equal(CLIENT_FLAIRS.length, 13);
});

test('the server builds the same display title as the app, and leaves posts without a flair as they are', () => {
  for (const flair of CLIENT_FLAIRS) {
    const post = { age: 21, flair, title: 'Looking for kasama mag-coffee' };
    assert.equal(displayTitle(post), composeTitle(post.age, post.flair, post.title));
  }
  assert.equal(displayTitle({ age: 18, flair: 'Masc × Femme', title: 'Looking for kasama mag-coffee' }), '18 [Masc × Femme] Looking for kasama mag-coffee');
  assert.equal(displayTitle({ title: 'Old post' }), 'Old post');
  assert.equal(displayTitle({ age: 20, flair: 'bogus', title: 'Old post' }), 'Old post');
  assert.equal(displayTitle(null), '');
  assert.match(read('api/_requests.js'), /displayTitle\(post\)\.slice\(0, 130\)/, 'request lists show the generated title');
});

test('the composer asks for the flair with compact pills, previews the generated title, and no longer lets the age be chosen', () => {
  assert.match(composer, /role="radiogroup" aria-label="Looking for flair"/);
  assert.match(composer, /LOOKING_FOR_FLAIRS\.map\(\(flair\) =>/);
  assert.match(composer, /aria-checked=\{draft\.flair === flair\}/, 'single selection');
  assert.match(composer, /<PostMeta age=\{ownAge \?\? undefined\} flair=\{draft\.flair \|\| undefined\} intention=\{draft\.intention\} \/>/, 'a live preview of age, flair and intention');
  assert.match(composer, /draft\.title\.trim\(\) \|\| 'Your title'/);
  assert.doesNotMatch(composer, /showAge|lf-show-age/, 'the age is not a toggle or an input');
  assert.match(composer, /You’ll post as \$\{ownAge\}, from your profile\./);
  assert.match(read('src/components/LookingForBody.tsx'), /<PostMeta age=\{post\.age\} flair=\{post\.flair\} intention=\{post\.intention\} \/>/, 'cards show age, flair and intention above the title');
});

test('the rules require an age and a flair on a new post, validate both, and still let an older post be paused', () => {
  assert.match(lfRules, /hasAll\(\['authorId', 'authorName', 'authorPronouns', 'title', 'intro', 'lookingFor', 'intention', 'age', 'flair', 'tags'/);
  assert.match(lfRules, /!\('flair' in data\) \|\| data\.flair in lookingForFlairs\(\)/);
  assert.match(lfRules, /lookingForAgeMatches\(data\.age\)/, 'the age is checked against the private birthday');
  assert.match(lfRules, /affectedKeys\(\)\.hasOnly\(\['requestsPaused', 'updatedAt'\]\)/);
});

test('NSFW Connection appears in the composer and on the board with its own subtle styling, and always marks the post mature', () => {
  assert.match(composer, /const chooseIntention = /);
  assert.match(composer, /id === NSFW_INTENTION \? \(draft\.intention === id \? '!bg-danger\/20 !text-danger !border-danger\/60'/);
  assert.match(composer, /disabled=\{alwaysMature\}/, 'the NSFW switch is locked on for this intention');
  assert.match(board, /chipClass=\{\(id, on\) => \(id === 'nsfw' \?/, 'a distinct filter chip');
  assert.match(lfRules, /return \['dating', 'friendship', 'talk', 'gaming', 'open', 'nsfw'\];/);
  assert.match(lfRules, /\(data\.intention != 'nsfw' \|\| data\.isNsfw == true\)/, 'the rules force it to be mature');
  assert.match(read('src/utils/lookingFor.ts'), /const isNsfw = draft\.isNsfw \|\| draft\.intention === NSFW_INTENTION;/);
});

test('the form asks for About me and About you with the requested placeholders and live counters', () => {
  assert.match(composer, /<Label htmlFor="lf-intro">About me<\/Label>/);
  assert.match(composer, /<Label htmlFor="lf-looking">About you<\/Label>/);
  assert.match(composer, /placeholder="Tell us about yourself! Share your personality, hobbies, interests, lifestyle, and little things that make you who you are\."/);
  assert.match(composer, /placeholder="Describe the person you’d like to meet, their personality, interests, and the kind of connection you hope to build\."/);
  assert.match(composer, /const aboutMe = draft\.intro\.trim\(\)\.length;/, 'trimmed counts');
  assert.match(composer, /const aboutYou = draft\.lookingFor\.trim\(\)\.length;/);
  assert.match(composer, /\{aboutMe\}\/\{LIMITS\.intro\} · at least \{LIMITS\.minSection\}/);
  assert.match(composer, /\{aboutYou\}\/\{LIMITS\.lookingFor\} · at least \{LIMITS\.minSection\}/);
  assert.doesNotMatch(composer, /What are you looking for\?/);
  assert.match(composer, /Object.keys\(errors\)\.length > 0 \|\| saving/, 'publishing is blocked while either section is short');
});

test('a published post shows meta, then the title, then About me, then About you, and never "What are you looking for?"', () => {
  const body = read('src/components/LookingForBody.tsx');
  const at = (text) => body.indexOf(text);
  assert.ok(at('<PostMeta age={post.age}') > 0 && at('<PostMeta') < at('{post.title}</h3>'), 'age, flair and intention first');
  assert.ok(at('{post.title}</h3>') < at('aria-label="About me"'), 'the title comes before About me');
  assert.ok(at('aria-label="About me"') < at('aria-label="About you"'), 'About me is the first section, About you the second');
  assert.match(body, /<h4[^>]*>About me<\/h4>/);
  assert.match(body, /<h4[^>]*>About you\{preferred/);
  assert.doesNotMatch(body, /Looking for\{preferred|What are you looking for/);
  assert.match(body, /mt-4 rounded-xl/, 'the sections are visually distinct');
  assert.match(body, /\{post\.intro\}/);
  assert.match(body, /\{post\.lookingFor\}/);
  assert.match(body, /INTENTION_LABELS\[intention\]/);
  // Profile pages still cover mature posts, and repeat the intention only while one is covered; the board is always open.
  assert.match(read('src/components/ProfileSections.tsx'), /presentation !== 'open' && <Badge>\{INTENTION_LABELS\[post\.intention\]\}<\/Badge>/);
  assert.equal(read('src/components/LookingForView.tsx').includes('presentation'), false, 'the board has one open presentation');
});

test('the rules require 100 trimmed characters in both sections on a new post, and only on a section an edit changes', () => {
  assert.match(lfRules, /text\.size\(\) >= 100 && text\.matches\('\^\\\\S\[\\\\s\\\\S\]\*\\\\S\$'\)/);
  assert.match(lfRules, /&& lookingForSection\(request\.resource\.data\.intro\)\s*&& lookingForSection\(request\.resource\.data\.lookingFor\)/);
  assert.match(lfRules, /request\.resource\.data\.intro == resource\.data\.intro \|\| lookingForSection\(request\.resource\.data\.intro\)/);
  assert.match(lfRules, /request\.resource\.data\.lookingFor == resource\.data\.lookingFor \|\| lookingForSection\(request\.resource\.data\.lookingFor\)/);
  assert.match(lfRules, /data\.intro is string && data\.intro\.size\(\) >= 1 && data\.intro\.size\(\) <= 400/, 'the maximums are kept');
});

test('the COSMOS header is just "COSMOS", with no subtitle, and the page is tighter on a phone', () => {
  const header = cosmos.slice(cosmos.indexOf('<h1'), cosmos.indexOf('</h1>') + 5);
  assert.match(header, />COSMOS<\/h1>/);
  assert.match(header, /text-\[length:calc\(23px_\*_var\(--fs,1\)\)\] sm:text-\[length:calc\(28px_\*_var\(--fs,1\)\)\]/, '23px on a phone, 28px from tablet up');
  const top = cosmos.slice(cosmos.indexOf('COSMOS</h1>'), cosmos.indexOf('aria-label="Cosmos sections"'));
  assert.doesNotMatch(top, /<p[\s>]/, 'no description under the heading');
  assert.match(cosmos, /pt-3 sm:pt-8 pb-\[calc\(var\(--tabbar-h\)\+env\(safe-area-inset-bottom\)\+6rem\)\]/, 'less space above, safe area below');
  assert.match(cosmos, /grid grid-cols-2 gap-1 rounded-full border border-line bg-surface p-0\.5 mb-3/, 'a full-width, shorter switch');
  assert.match(cosmos, /h-9 rounded-full text-/);
  assert.match(cosmos, /ring-1 ring-berry\/50/, 'the pink active state is kept');
});

test('both category rows are one-line scrollers that never clip, hide the scrollbar and bring the chosen pill into view', () => {
  const scroller = read('src/components/ChipScroller.tsx');
  assert.match(scroller, /overflow-x-auto overscroll-x-contain scrollbar-none/);
  assert.match(scroller, /touch-pan-x/);
  assert.doesNotMatch(scroller, /flex-wrap/, 'never a second row');
  assert.match(scroller, /className=\{`chip shrink-0/, 'pills never shrink or wrap');
  assert.match(scroller, /<span aria-hidden="true" className="w-2 shrink-0 sm:hidden" \/>/, 'room after the last pill');
  assert.match(scroller, /container\.scrollTo\(\{ left, behavior: calm \? 'auto' : 'smooth' \}\)/);
  assert.match(scroller, /\[aria-selected="true"\]/, 'the chosen pill is found and centered');
  assert.match(scroller, /prefers-reduced-motion/);
  assert.match(cosmos, /<ChipScroller items=\{FILTER_CATEGORIES\} active=\{activeCategory\} onSelect=\{setActiveCategory\} label="Categories" bleed/);
  assert.match(board, /<ChipScroller[\s\S]*?items=\{LOOKING_FOR_CATEGORIES\}/);
  assert.doesNotMatch(board, /-mx-4 px-4 sm:mx-0 sm:px-0 flex flex-1/, 'the Looking For row no longer overlaps the filter button');
});

test('the filter row lists exactly All, Cozy Vents, Books & Media, Friend Finder and Dating, and no user-facing text says R4R', () => {
  const categories = read('src/utils/communityCategories.ts');
  const filter = categories.slice(categories.indexOf('export const FILTER_CATEGORIES'));
  assert.match(filter, /CATEGORIES\.filter\(\(c\) => c\.id !== 'general'\)/);
  assert.match(categories, /\{ id: 'advice', label: 'Dating' \}/, 'the stored value "advice" is unchanged; only the label is');
  for (const file of ['src/components/CommunityFeedView.tsx', 'src/components/ProfileSections.tsx', 'src/utils/communityCategories.ts', 'src/components/Hero.tsx', 'src/components/InfoModals.tsx', 'scripts/seo/pages.mjs', 'public/sapphic-community-philippines.html']) {
    const text = read(file);
    assert.doesNotMatch(text, /R4R|Dating (&|&amp;) Advice|Dating (&|&amp;) R4R/i, file);
  }
  assert.match(read('src/services/communityService.ts'), /\['vents', 'media', 'friends', 'advice', 'general'\]/, 'stored categories are untouched');
  assert.match(rules, /cat in \['general', 'media', 'vents', 'friends', 'advice'\]/, 'the rules are untouched');
});

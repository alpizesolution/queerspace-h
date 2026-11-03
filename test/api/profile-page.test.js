import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const page = read('src/components/ProfilePage.tsx');
const sections = read('src/components/ProfileSections.tsx');
const service = read('src/services/profileViewService.ts');
const nav = read('src/components/ProfileNav.tsx');
const app = read('src/App.tsx');
const profiles = read('api/_profiles.js');
const signals = read('api/signals.js');
const age = read('api/age.js');

test('the page shows what the server returned, and never reads the profile or private records itself', () => {
  assert.match(service, /\/api\/signals\?view=profile&memberId=/);
  for (const file of [page, sections, service]) {
    assert.doesNotMatch(file, /doc\(db, 'users'|collection\(db, 'users'|private\/settings/, 'no private record is read here');
  }
  // The only birthday in sight is the owner's own, already on their device, used for their own page and nowhere else.
  assert.deepEqual([...page.matchAll(/birthDate/g)].length, 2);
  assert.match(page, /if \(data\.self\) \{\s*setAge\(userPrefs\.showAgeOnProfile && userPrefs\.birthDate \? calculateAge\(userPrefs\.birthDate\) : null\);/);
  assert.doesNotMatch(sections + service, /birthDate/);
  assert.match(page, /fetchMemberProfile\(memberId, force\)/);
});

test('owner-only controls exist only on the owner\'s own page', () => {
  const owner = page.slice(page.indexOf('{isSelf && ('), page.indexOf('{details.length > 0'));
  for (const text of ['Edit profile', 'Share profile', 'What others can see']) assert.ok(owner.includes(text), `${text} is inside the owner block`);
  const outside = page.replace(owner, '');
  for (const text of ['Edit profile', 'Share profile', 'What others can see']) assert.equal(outside.includes(text), false, `${text} appears nowhere else`);
  assert.match(page, /const showBar = !isSelf && data !== null && action\.kind !== 'none';/);
  assert.match(page, /\{member && !isSelf && \(\s*<div className="relative"/, 'the Report / Block menu is for visitors only');
});

test('contact only ever goes through the existing request flow, about a live Looking For post', () => {
  assert.match(page, /<ConnectionRequestSheet post=\{requestPost\}/);
  assert.match(page, /Send Connection Request/);
  assert.doesNotMatch(page + sections + service, /request-create|action: 'create'|send-message|signalsPairs|connection_requests/, 'the page cannot create contact itself');
  assert.match(page, /onOpenConversation\(action\.conversationId\)/, 'a conversation only opens once it already exists');
  assert.match(read('src/utils/profileView.ts'), /if \(posts\.length === 0\) return \{ kind: 'unavailable' \}/);
});

test('an age is requested only when the member shows one and the viewer is connected, and the owner sees their own', () => {
  assert.match(page, /data\.member\?\.showsAge && data\.relation\.state === 'connected'/);
  assert.match(page, /userPrefs\.showAgeOnProfile && userPrefs\.birthDate \? calculateAge\(userPrefs\.birthDate\) : null/);
  assert.match(service, /view=profile-age&memberId=/);
});

test('blocked, ineligible and hidden members are handled: no profile, clear words, and no contact action', () => {
  assert.match(page, /You blocked this member/);
  assert.match(page, /This profile isn’t available/);
  assert.match(page, /Profiles are for adult members/);
  assert.match(read('src/utils/profileView.ts'), /if \(response\.blocked\) return \{ kind: 'blocked' \}/);
  assert.match(page, /onBlockMember\(memberId\); onClose\(\);/, 'blocking closes the page');
  assert.match(page, /<ReportMemberSheet/);
  assert.match(read('src/components/ReportMemberSheet.tsx'), /reportRequestMember\(memberId/);
});

test('nothing about who looked is tracked or ranked', () => {
  for (const file of [page, sections, service, profiles, nav]) {
    assert.doesNotMatch(file, /viewCount|\bprofileViews\b|lastViewed|viewedBy|\bfollowers\b|followerCount|\bleaderboard\b|\branking\b/);
  }
  assert.doesNotMatch(profiles, /\.(set|update|create|add)\(/, 'looking at a profile writes nothing');
});

test('performance: one read per profile, no live listeners, paged posts, a short cache and de-duplicated loads', () => {
  for (const file of [page, sections, service]) assert.doesNotMatch(file, /onSnapshot/, 'profiles are read once, not subscribed to');
  assert.match(service, /PROFILE_CACHE_MS/);
  assert.match(service, /const inFlight = new Map/);
  assert.match(service, /limit\(PROFILE_PAGE_SIZE \+ 1\)/);
  assert.match(service, /startAfter\(after\)/);
  assert.match(service, /limit\(5\)/, 'a member has at most five Looking For posts');
  assert.match(read('src/utils/profileView.ts'), /PROFILE_PAGE_SIZE = 5/);
  assert.match(sections, /Show more/);
});

test('public posts come from the existing collection and rules, say so when there are none, and use the compact preview', () => {
  assert.match(service, /where\('authorId', '==', memberId\), orderBy\('timestamp', 'desc'\)/);
  assert.match(service, /collection\(db, 'community_posts'\)/);
  assert.match(sections, /<ExpandableText text=\{post\.content\}/);
  assert.doesNotMatch(sections.slice(0, sections.indexOf('export const ProfileLookingFor')), /posts\.length === 0\) return null;/,'an empty profile is no longer hidden: it says "No public posts yet"');
  const indexes = JSON.parse(read('firestore.indexes.json')).indexes.filter((i) => i.collectionGroup === 'community_posts');
  assert.deepEqual(indexes.map((i) => i.fields.map((f) => `${f.fieldPath}:${f.order}`).join(',')), ['authorId:ASCENDING,timestamp:DESCENDING']);
});

test('Looking For on a profile reuses the board\'s card pieces, covers mature posts, and leaves paused posts out for visitors', () => {
  assert.match(sections, /<LookingForBody/);
  assert.match(sections, /<SensitiveCover/);
  assert.match(sections, /postPresentation\(post, nsfwPreference, revealed\.has\(post\.id\)\)/);
  assert.match(sections, /revealNeedsDialog\(nsfwPreference\)/);
  assert.match(sections, /if \(nsfwPreference === 'hide'\) return;/);
  assert.match(page, /visibleLookingForPosts\(lookingFor, isSelf\)/);
  const open = sections.slice(sections.indexOf("presentation === 'open' ?"));
  const covered = open.slice(open.indexOf('<SensitiveCover'), open.indexOf('</article>'));
  for (const leak of ['post.title', 'post.intro', 'post.lookingFor', 'post.tags', 'LookingForBody']) assert.equal(covered.includes(leak), false, `${leak} must not appear in the covered branch`);
  assert.match(sections, /const presentation = isSelf \? 'open' : postPresentation/, 'a member always sees their own posts');
});

test('avatars open profiles from Community, Looking For, Requests and the Signals chat, through one component', () => {
  assert.match(nav, /export const MemberAvatar/);
  assert.match(nav, /if \(!nav \|\| !isMemberId\(memberId\)\) return art;/, 'no id or no app: a plain avatar, never a broken button');
  assert.match(nav, /aria-label=\{name \? `View \$\{name\}’s profile` : 'View profile'\}/);
  const community = read('src/components/CommunityFeedView.tsx');
  assert.equal((community.match(/<MemberAvatar/g) || []).length, 2, 'post and reply avatars');
  assert.match(read('src/components/LookingForView.tsx'), /<MemberAvatar memberId=\{post\.authorId\}/);
  assert.match(read('src/components/ConnectionRequestsPanel.tsx'), /<MemberAvatar memberId=\{request\.memberId\}/);
  assert.match(read('src/components/SignalsConversation.tsx'), /<MemberAvatar memberId=\{partnerId\}/);
  assert.match(read('src/components/SignalsView.tsx'), /partnerId=\{selectedPair\.participants\?\.find\(\(id\) => id !== auth\?\.currentUser\?\.uid\)\}/);
});

test('the app opens the page, keeps back navigation working, and handles shared links safely', () => {
  assert.match(app, /<ProfileNavProvider value=\{profileNav\}>/);
  assert.match(app, /window\.history\.pushState\(\{ qsProfile: true \}, ''\)/);
  assert.match(app, /window\.addEventListener\('popstate', onPop\)/);
  assert.match(app, /if \(window\.history\.state\?\.qsProfile\) window\.history\.back\(\);/);
  assert.match(app, /profileIdFromSearch\(window\.location\.search\)/);
  assert.match(app, /window\.history\.replaceState\(null, '', window\.location\.pathname\)/, 'the id is removed from the address after opening');
  assert.match(app, /profileMemberId && !ageGateOpen && !ageRestricted/, 'the page waits for the age gate');
  assert.match(app, /onOpenRequests=\{\(\) => \{ closeProfile\(\); setSignalsStartSection\('requests'\)/);
  assert.match(app, /onBlockMember=\{handleBlockMember\}/);
});

test('mobile layout: full screen, a back action, a sticky bottom action, safe areas and no sideways scroll', () => {
  assert.match(page, /fixed inset-0 z-\[45\]/);
  assert.match(page, /aria-label="Back"/);
  assert.match(page, /pt-\[calc\(env\(safe-area-inset-top\)\+0\.5rem\)\]/);
  assert.match(page, /pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\]/);
  assert.match(page, /max-w-xl/);
  assert.match(page, /\[overflow-wrap:anywhere\]/);
  assert.match(page, /overscroll-contain/);
});

test('the server decides what a viewer may see: adults only, blocks both ways, suspension, and only shared fields', () => {
  assert.match(profiles, /isAdultMember\(viewerSettings\.data\(\)\)/);
  assert.match(profiles, /blockedByMe\.includes\(memberId\)/);
  assert.match(profiles, /blockedMe\.includes\(uid\)/);
  assert.match(profiles, /suspension\.exists/);
  assert.match(profiles, /profile\.showLocationOnProfile !== false/);
  assert.match(profiles, /function optedIn/);
  assert.doesNotMatch(profiles.slice(profiles.indexOf('export function shapeProfile'), profiles.indexOf('/** How the viewer and the member')), /birthDate|exactLocation|blockedPartnerIds/);
  assert.match(signals, /view === 'profile'/);
  assert.match(signals, /profileView\(db, uid, memberId\)/);
  assert.match(age, /query\.view === 'profile-age'/);
  assert.match(age, /pair\.empty \|\| profile\.data\(\)\?\.showAgeOnProfile !== true/);
});

test('a profile opened from a shared link waits for sign-in to be restored before reading anything', () => {
  assert.match(service, /return auth\?\.currentUser \?\? \(await ensureAnonymousAuth\(\)\);/);
  assert.equal((service.match(/await signedIn\(\)/g) || []).length, 3, 'the profile request, the posts and the Looking For posts all wait');
  assert.match(page, /const isSelf = data\?\.self \?\? \(selfId !== null && memberId === selfId\);/, 'the server decides whose page this is');
});

test('the connection action is chosen from all of a member\'s posts, so "requests paused" is told apart from "no post"', () => {
  assert.match(page, /profileAction\(data, lookingFor\)/);
  assert.doesNotMatch(page, /profileAction\(data, posts\)/, 'the filtered list would hide that posts exist but are paused');
});

test('an unsupported or failing profile API gives the page a named error state, never a blank screen', () => {
  assert.match(service, /parseProfileResponse\(await response\.json\(\)\.catch\(\(\) => null\)\)/, 'the answer is validated before it is trusted');
  assert.match(service, /response\.status === 400\) return \{ ok: false, reason: 'unsupported' \}/);
  assert.match(service, /response\.status === 429\) return \{ ok: false, reason: 'rate_limited' \}/);
  assert.match(service, /if \(!data\) return \{ ok: false, reason: 'unsupported' \}/);
  assert.match(page, /RETRYABLE_REASONS/);
  assert.match(page, /Profiles aren’t ready yet/);
  assert.match(page, /Something unexpected came back/, 'even an unreachable branch renders a message and a way out');
});

test('unknown GET views are refused, and profile lookups are limited per viewer on the server', () => {
  assert.match(signals, /\['messages', 'pairs', 'requests', 'profile'\]\.includes\(view\)\) return send\(res, 400, \{ error: 'invalid_view' \}\)/);
  assert.match(profiles, /import \{ rateLimit \} from '\.\/_lib\.js'/);
  assert.match(profiles, /PROFILE_LOOKUPS_PER_MINUTE = 60/);
  assert.match(profiles, /if \(memberId !== uid\) await counting\.run\(uid, \(\) => rateLimit\(db, uid, 'profile-view', PROFILE_LOOKUPS_PER_MINUTE, 60_000\)\)/, 'own profile is not counted, and one viewer\'s counter updates take turns');
  assert.match(profiles, /const counting = createKeyedQueue\(\);/);
  assert.ok(profiles.indexOf("'profile-view'") < profiles.indexOf('private/settings'), 'the limit is checked before any profile data is read');
});

test('the Posts section has three separate states, and the retry message is only for a failed request', () => {
  assert.match(sections, /postsView\(\{ loading, failed: error, count: posts\.length \}\)/);
  assert.match(sections, /No public posts yet/);
  assert.match(sections, /Their shared posts will appear here\./);
  assert.match(sections, /role="status" aria-label="Loading posts"/, 'a loading skeleton');
  const empty = sections.slice(sections.indexOf("view === 'empty'"), sections.indexOf("view === 'error'"));
  assert.doesNotMatch(empty, /Try again|Couldn’t load posts/, 'the empty state has no error and no retry');
  const failed = sections.slice(sections.indexOf("view === 'error'"), sections.indexOf('  return (\n    <Section title="Posts">\n      <ul'));
  assert.match(failed, /Couldn’t load posts\. <button[^>]*onClick=\{\(\) => void load\(cursor\)\}/, 'the retry is wired to the loader');
  assert.match(sections, /if \(!outcome\.ok\) \{\s*setError\(true\);/);
  assert.doesNotMatch(sections, /if \(!page\)/, 'an empty page is no longer mistaken for a failure');
});

test('the posts request reports success and failure separately, with the same query, filters and paging as before', () => {
  assert.match(service, /settlePostsLoad\(async \(\) =>/);
  assert.match(service, /throw new Error\('database_unavailable'\)/);
  assert.match(service, /where\('authorId', '==', memberId\), orderBy\('timestamp', 'desc'\)/);
  assert.match(service, /limit\(PROFILE_PAGE_SIZE \+ 1\)/);
  assert.match(service, /startAfter\(after\)/);
  assert.match(service, /if \(!outcome\.ok\) console\.warn/, 'only a real failure is logged');
});

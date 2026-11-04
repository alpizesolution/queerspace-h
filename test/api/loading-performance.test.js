import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(file, 'utf8');
const view = read('src/components/SignalsView.tsx');
const conversation = read('src/components/SignalsConversation.tsx');
const skeleton = read('src/components/Skeleton.tsx');
const list = read('src/services/signalsListService.ts');
const profilePage = read('src/components/ProfilePage.tsx');
const sections = read('src/components/ProfileSections.tsx');
const profileService = read('src/services/profileViewService.ts');

test('the inbox shows a skeleton on a first load, never a bare spinner, and only when there is nothing to show yet', () => {
  assert.match(view, /import \{ InboxSkeleton \} from '\.\/Skeleton\.tsx';/);
  assert.match(view, /\) : loading \? \(\s*<InboxSkeleton \/>/);
  assert.doesNotMatch(view, /Finding your connections/, 'the old spinner text is gone');
  assert.match(view, /const \[loading, setLoading\] = useState\(remembered\.current === null\);/, 'skeleton only without a remembered inbox');
  assert.match(view, /if \(!loadedOnce\.current && !quiet\) setLoading\(true\);/, 'a refresh never brings the skeleton back');
  assert.match(view, /\) : !loadedOnce\.current \? null : \(/, 'a failed first load shows the error, not an empty inbox');
});

test('a remembered inbox is shown at once, and nothing is asked for while the live inbox says nothing changed', () => {
  assert.match(view, /const remembered = useRef\(readInboxCache\(ownerId\)\);/);
  assert.match(view, /useState<SignalPair\[\]>\(\(\) => remembered\.current\?\.pairs \?\? \[\]\)/);
  assert.match(view, /if \(inboxFreshness\(remembered\.current, inbox\?\.rev, Date\.now\(\)\) === 'fresh'\) return;/);
  assert.match(view, /writeInboxCache\(ownerId, \{ pairs, invitations, nextCursor, rev: loadedRev\.current, at: Date\.now\(\) \}\);/);
  assert.match(list, /const key = inboxCacheKey\(uid\);/, 'remembered per member');
});

test('connections load a page at a time, with a small indicator and a retry at the bottom', () => {
  assert.match(list, /view=pairs&limit=\$\{PAIR_PAGE_SIZE\}/);
  assert.match(view, /new IntersectionObserver\(.*rootMargin: '240px'/s);
  assert.match(view, /Loading more…/);
  assert.match(view, /Couldn’t load more\./);
  assert.match(view, /if \(!cursorRef\.current \|\| moreBusy\.current\) return;/, 'one page request at a time');
  assert.match(view, /observer\.disconnect\(\)/, 'the observer is released');
  assert.match(view, /typeof IntersectionObserver === 'undefined' && \(/, 'a plain button where observers are unsupported');
});

test('the two banners and the inbox share requests instead of each asking for everything', () => {
  assert.match(view, /const invitations = await fetchPendingInvitations\(\);/);
  assert.match(view, /return \(await fetchPair\(pairId\)\)\?\.partner\?\.displayName/, 'one connection, not the whole list');
  assert.match(view, /readInboxCache\(auth\?\.currentUser\?\.uid\)\?\.pairs\.find/, 'the remembered inbox answers first');
  assert.match(list, /const pending = inFlight\.get\(path\);\s*if \(pending\) return pending as Promise<T>;/);
  assert.doesNotMatch(view, /signalsRequest<\{ pairs: SignalPair\[\] \}>\('\/api\/signals\?view=pairs'\)/, 'no more un-paged list request');
});

test('requests cannot hang, so no loading state can last forever', () => {
  assert.match(list, /controller\.abort\(\), timeoutMs\)/);
  assert.match(profileService, /const REQUEST_TIMEOUT_MS = 15_000;/);
  assert.match(profileService, /controller\.abort\(\), REQUEST_TIMEOUT_MS\)/);
  assert.match(profileService, /within\(getDocs\(/, 'Firestore reads for Looking For posts have a limit too');
  assert.match(profileService, /settlePostsLoad\(\(\) => within\(/, 'and the public posts');
});

test('the conversation stops asking for messages while nobody is looking, and releases everything when it closes', () => {
  assert.match(conversation, /useEffect\(\(\) => whileActive\(\(\) => \{\s*void loadMessages\(loadedOnce\.current\);\s*const timer = window\.setInterval\(\(\) => void loadMessages\(true\), 4000\);\s*return \(\) => window\.clearInterval\(timer\);\s*\}\), \[loadMessages\]\);/);
  assert.match(read('src/utils/whileActive.ts'), /IDLE_AFTER_MS = 2 \* 60 \* 1000/);
});

test('there is still exactly one live listener for the inbox, and the lists, profiles and conversations add none', () => {
  const users = [];
  const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) && /onSnapshot\(/.test(read(full))) users.push(full.replace(/\\/g, '/')); } };
  walk('src');
  for (const file of ['src/components/SignalsView.tsx', 'src/components/SignalsConversation.tsx', 'src/components/ProfilePage.tsx', 'src/components/ProfileSections.tsx', 'src/services/profileViewService.ts', 'src/services/signalsListService.ts']) assert.equal(users.includes(file), false, `${file} has no listener`);
  assert.ok(users.includes('src/services/signalsInbox.ts'), 'the inbox document is the one live listener');
  assert.equal((read('src/hooks/useSignalsInbox.ts').match(/subscribeSignalsInbox\(/g) || []).length, 1);
  assert.match(read('src/hooks/useSignalsInbox.ts'), /stopAuth\(\);\s*stopListening\(\);/, 'released on unmount');
});

test('skeletons are quiet, match the real layout, and stay still when reduced motion is on', () => {
  assert.match(skeleton, /animate-pulse motion-reduce:animate-none/);
  assert.match(skeleton, /role="status" aria-busy="true" aria-label="Loading your connections"/);
  assert.match(skeleton, /role="status" aria-busy="true" aria-label="Loading profile"/);
  assert.match(skeleton, /rows = 6/, 'about six rows');
  assert.doesNotMatch(skeleton, /shimmer|gradient|animate-spin|animate-bounce/, 'no shimmer or other effects');
  const real = view.match(/className="(-mx-2 flex min-h-16 w-\[calc\(100%\+1rem\)\] items-center gap-3 rounded-2xl px-2 py-2\.5)/);
  assert.ok(real, 'the real inbox row');
  const sized = 'flex min-h-16 w-[calc(100%+1rem)] items-center gap-3';
  assert.ok(skeleton.includes(`-mx-2 ${sized} px-2 py-2.5`), 'the skeleton row has the same size, spacing and position');
  assert.match(skeleton, /h-10 w-10 shrink-0 !rounded-full/, 'a circular avatar the size of the real one');
});

test('a profile opens at once when seen in the last minute, and its posts do not wait for the profile', () => {
  assert.match(profilePage, /import \{ ProfileSkeleton \} from '\.\/Skeleton\.tsx';/);
  assert.match(profilePage, /\{load === null \? \(\s*<ProfileSkeleton \/>/);
  assert.doesNotMatch(profilePage, /Opening profile…/);
  assert.match(profilePage, /const hit = peekMemberProfile\(memberId\);\s*return hit \? \{ ok: true, data: hit \} : null;/);
  const run = profilePage.slice(profilePage.indexOf('const run = useCallback'), profilePage.indexOf('}, [memberId]);'));
  assert.ok(run.indexOf('prefetchMemberPosts(memberId)') < run.indexOf('await fetchMemberProfile'), 'posts start before the profile answers');
  assert.ok(run.indexOf('fetchMemberLookingForPosts(memberId)') < run.indexOf('await fetchMemberProfile'));
  assert.match(run, /if \(id !== runId\.current\) return;/, 'a profile that was left cannot be answered into');
  assert.match(run, /if \(id === runId\.current\) setLookingFor/);
  assert.match(run, /if \(!result\.ok \|\| !result\.data\.member\) return;/, 'nothing from the posts is used for an unavailable or blocked profile');
});

test('remembered profile data is only what the server already allowed, only for a minute, and never for your own posts', () => {
  assert.match(profileService, /export function peekMemberProfile\(memberId: string, now: number = Date\.now\(\)\)/);
  assert.match(profileService, /now - hit\.at < PROFILE_CACHE_MS/);
  assert.match(profileService, /if \(isOwn\(memberId\)\) return null;/, 'your own posts are always read fresh');
  assert.match(profileService, /else if \(after === null && !isOwn\(memberId\) && outcome\.page\.posts\.length > 0\) postsCache\.set/, 'an empty answer is never remembered');
  assert.match(profileService, /if \(!isOwn\(memberId\)\) lookingForCache\.set/);
  assert.doesNotMatch(profileService, /allowStale|stale/i, 'a stale profile is never shown, so a changed privacy choice or a block takes effect');
  assert.match(profileService, /postsCache\.clear\(\);\s*lookingForCache\.clear\(\);/, 'cleared with the profile cache');
});

test('posts load independently of the profile, and an answer for another profile cannot land on this one', () => {
  assert.match(sections, /const remembered = useRef\(peekMemberPostsFirstPage\(memberId\)\);/);
  assert.match(sections, /const \[loading, setLoading\] = useState\(remembered\.current === null\);/, 'no skeleton when the posts are already in');
  assert.match(sections, /if \(current\.current !== memberId\) return;/);
  assert.match(sections, /No public posts yet/, 'zero posts is an empty state, not an error');
  assert.match(sections, /Couldn’t load posts\./);
  assert.match(sections, /postsView\(\{ loading, failed: error, count: posts\.length \}\)/);
  assert.match(sections, /PostCardSkeleton/);
});

test('no rules, permissions or other features changed for loading performance', () => {
  const rules = read('firestore.rules');
  assert.match(rules, /match \/signalsPairs\/\{pairId\} \{\s*allow read, write: if false;/);
  assert.match(rules, /match \/community_posts\/\{postId\} \{\s*allow read: if isAuthenticated\(\);/);
  assert.match(read('api/signals.js'), /if \(!Array\.isArray\(pair\.participants\) \|\| !pair\.participants\.includes\(uid\)\) return send\(res, 403/, 'conversation access checks are untouched');
});

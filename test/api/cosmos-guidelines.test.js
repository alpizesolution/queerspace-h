import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const feed = read('src/components/CommunityFeedView.tsx');
const page = read('src/components/CosmosGuidelines.tsx');
const nav = read('src/components/BottomNavigation.tsx');
const app = read('src/App.tsx');

test('the information icon sits at the far left of the COSMOS header, before the title, in both Community and Looking For', () => {
  const header = feed.slice(feed.indexOf('<div className="flex items-center justify-between gap-3 mb-2.5'), feed.indexOf('{focusMode && onCloseFocus && ('));
  assert.match(header, /aria-label="Community Guidelines"/);
  assert.match(header, /title="Community Guidelines"/);
  assert.ok(header.indexOf('aria-label="Community Guidelines"') < header.indexOf('<h1'), 'the icon comes before the title');
  assert.match(header, /<Info className="h-\[18px\] w-\[18px\]" aria-hidden="true" \/>/, 'the existing icon library, a small icon');
  assert.match(feed, /import \{ ArrowLeft, ArrowUp, Info,/);
  assert.match(header, /onClick=\{\(\) => setShowGuidelines\(true\)\}/);
  assert.match(header, /text-subtle transition-colors hover:text-fg/, 'subtle until hovered');
  assert.match(header, />COSMOS<\/h1>/, 'the title is unchanged');
  // The header sits above the switch, so the icon is there whichever mode is chosen.
  assert.ok(feed.indexOf('aria-label="Community Guidelines"') < feed.indexOf('aria-label="Cosmos sections"'));
  assert.doesNotMatch(header, /section === 'community' &&[\s\S]*Community Guidelines/, 'not hidden in either mode');
});

test('the icon is a full 44px touch target that takes no extra height, so the layout does not move', () => {
  assert.match(feed, /className="-ml-3 -my-2 flex min-w-0 items-center"/);
  assert.match(feed, /className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full/);
  assert.match(feed, /focus-visible:ring-2 focus-visible:ring-berry\/60/, 'a visible focus ring');
});

test('the guidelines open from the icon only: there is no new bottom-navigation item, route or navigation system', () => {
  assert.doesNotMatch(nav, /uidelines/);
  assert.doesNotMatch(app, /CosmosGuidelines/, 'the app shell does not know about it');
  assert.match(feed, /\{showGuidelines && <CosmosGuidelines onClose=\{\(\) => setShowGuidelines\(false\)\} \/>\}/);
  assert.match(feed, /useState\(false\);\s*(\/\/.*\n\s*)?/);
  assert.equal((feed.match(/CosmosGuidelines/g) || []).length, 3, 'imported (name and file) and rendered once');
});

test('the page is a labelled dialog with a clear Back, Escape and the phone\'s back gesture', () => {
  assert.match(page, /role="dialog" aria-modal="true" aria-label="COSMOS Guidelines"/);
  assert.match(page, /<button type="button" onClick=\{goBack\} aria-label="Back" autoFocus/);
  assert.match(page, /event\.key === 'Escape'\) goBack\(\)/);
  assert.match(page, /window\.history\.pushState\(\{ qsGuidelines: true \}, ''\)/);
  assert.match(page, /window\.addEventListener\('popstate', onPop\)/);
  assert.match(page, /window\.history\.back\(\)/, 'Back leaves no extra history entry');
  assert.match(page, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(page, /return \(\) => \{ document\.body\.style\.overflow = previous; \}/, 'scrolling is restored');
  assert.match(page, /removeEventListener\('popstate', onPop\)/, 'listeners are released');
});

test('it opens with the introduction, then the two guideline sections, then safety, moderation and the closing message, in that order', () => {
  const order = ['{INTRO}', 'Community Guidelines</SectionTitle>', 'Looking For Guidelines</SectionTitle>', 'Keep Yourself Safe</SectionTitle>', '{MODERATION}', '{CLOSING_TITLE}', '{CLOSING_TEXT}'].map((marker) => page.indexOf(marker));
  assert.ok(order.every((at) => at > 0), 'every part is present');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'in the requested order');
  assert.match(page, /export const INTRO = 'COSMOS is a shared space for WLW to connect, express themselves, and build meaningful relationships\.';/);
});

test('the community rules are exactly the five given', () => {
  const rules = [
    ['Respect Everyone', 'Treat members with kindness. Respect identities, pronouns, boundaries, and personal experiences.'],
    ['Keep Conversations Meaningful', 'Share genuine thoughts, experiences, questions, and discussions. Avoid spam, flooding, and repetitive promotions.'],
    ['Protect Privacy', 'Never publish another person’s private messages, personal information, photos, or identity without consent.'],
    ['No Harassment or Discrimination', 'Hate speech, threats, bullying, outing, impersonation, and targeted harassment are prohibited.'],
    ['Post Responsibly', 'Keep content relevant to the selected category. Use appropriate content warnings where supported.'],
  ];
  const block = page.slice(page.indexOf('export const COMMUNITY_RULES'), page.indexOf('export const LOOKING_FOR_RULES'));
  for (const [title, text] of rules) { assert.ok(block.includes(`title: '${title}'`), title); assert.ok(block.includes(`text: '${text}'`), text); }
  assert.equal((block.match(/title: '/g) || []).length, 5);
});

test('the Looking For rules are exactly the six given', () => {
  const rules = [
    ['Be Genuine About Your Intentions', 'Choose the intention that accurately describes the connection you are seeking, such as friendship, dating, someone to talk to, gaming buddy, or other connections.'],
    ['Write Thoughtful Posts', 'Complete both About Me and About You honestly. Give members a meaningful understanding of who you are and the kind of connection you hope to find.'],
    ['Respect Consent', 'A connection request is an invitation, not an obligation. Respect acceptance, rejection, silence, and personal boundaries.'],
    ['No Unsolicited Explicit Content', 'Never send unsolicited intimate images or sexually explicit messages. Selecting NSFW Connection does not automatically mean consent to receive explicit content.'],
    ['Respect Identity and Preferences', 'Do not pressure members to change their identity, preferences, or relationship expectations.'],
    ['No Misleading Posts', 'Do not impersonate someone, use misleading information, or create posts intended to scam, exploit, or manipulate other members.'],
  ];
  const block = page.slice(page.indexOf('export const LOOKING_FOR_RULES'), page.indexOf('export const SAFETY_TIPS'));
  for (const [title, text] of rules) { assert.ok(block.includes(`title: '${title}'`), title); assert.ok(block.includes(`text: '${text}'`), text); }
  assert.equal((block.match(/title: '/g) || []).length, 6);
});

test('the safety tips, the moderation statement and the closing message are word for word, with nothing promised beyond them', () => {
  const tips = [
    'Do not share passwords, financial information, or sensitive personal details.',
    'Be cautious when sharing your location.',
    'Be careful when arranging in-person meetups.',
    'Report suspicious, abusive, or misleading accounts.',
    'Block anyone who makes you uncomfortable.',
    'Remember that online identities may not always be genuine.',
  ];
  const block = page.slice(page.indexOf('export const SAFETY_TIPS'), page.indexOf('export const MODERATION'));
  for (const tip of tips) assert.ok(block.includes(`'${tip}'`), tip);
  assert.equal((block.match(/^  '/gm) || []).length, 6);
  assert.match(page, /export const MODERATION = 'Content that violates these guidelines may be removed\. Accounts involved in serious or repeated violations may face restrictions or suspension\.';/);
  assert.match(page, /export const CLOSING_TITLE = 'Your space\. Your boundaries\. Your community\.';/);
  assert.match(page, /export const CLOSING_TEXT = 'Let’s make QUEERSPACE a place where everyone can feel respected, welcome, and free to be themselves\.';/);
  const statement = page.slice(page.indexOf('export const MODERATION'), page.indexOf('const RuleList'));
  assert.doesNotMatch(statement, /banned|permanent|within \d|24 hours|automatic|appeal|always|guarantee/i, 'no moderation promise beyond the given statement');
});

test('the page is readable at every size: a centered column with side padding, safe areas, wrapping text and no animation', () => {
  assert.match(page, /mx-auto w-full max-w-xl px-4 pb-\[calc\(env\(safe-area-inset-bottom\)\+2\.5rem\)\] pt-4 sm:px-6 sm:pt-6/);
  assert.match(page, /pt-\[calc\(env\(safe-area-inset-top\)\+0\.5rem\)\]/);
  assert.match(page, /\[overflow-wrap:anywhere\]/);
  assert.match(page, /flex-1 overflow-y-auto overscroll-contain/, 'long content scrolls inside the page');
  assert.doesNotMatch(page, /animate-|transition-transform|motion\./, 'no animation');
  assert.doesNotMatch(page, /\bh-\[\d+px\]|\bw-\[\d+px\]|\bmin-w-\[\d+px\]/, 'no fixed sizes that could clip');
});

test('nothing else changed: posting, Looking For, connection requests and the rules are untouched', () => {
  for (const kept of ['createCommunityPost', 'subscribeToCommunity', 'replyToCommunityPost', '<LookingForView', 'onViewRequests']) assert.ok(feed.includes(kept), kept);
  assert.doesNotMatch(page, /firebase|fetch\(|collection\(|doc\(|api\/|useEffect\([^)]*\bposts\b/, 'the page reads nothing and writes nothing');
  assert.match(read('firestore.rules'), /match \/looking_for_posts\/\{postId\} \{\s*allow read: if isAuthenticated\(\) && isEligibleMember\(request\.auth\.uid\);/);
});

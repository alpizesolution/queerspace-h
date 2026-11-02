import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const expandable = read('src/components/ExpandableText.tsx');
const body = read('src/components/LookingForBody.tsx');
const community = read('src/components/CommunityFeedView.tsx');
const board = read('src/components/LookingForView.tsx');

test('Community post text is a three-line preview with Read more / Show less, and nothing for short posts', () => {
  assert.match(community, /<ExpandableText[\s\S]*?text=\{post\.content\}/);
  assert.doesNotMatch(community, /\{post\.content\}\s*<\/p>/, 'the full text is no longer printed straight into the card');
  assert.match(expandable, /lines = 3/, 'three lines by default, on every screen size');
  assert.match(expandable, /line-clamp-3/);
  assert.match(expandable, /\(overflows \|\| expanded\) && <MoreButton/, 'the control exists only when the text is cut off');
  assert.match(expandable, /scrollHeight - el\.clientHeight > 1/, 'measured from the page, so short text gets no control');
  assert.match(expandable, /'Read more'|more="Read more"/);
  assert.match(expandable, /less = 'Show less'/);
});

test('the control is accessible: a real button that says whether it is open and what it controls', () => {
  assert.match(expandable, /<button\s+type="button"/);
  assert.match(expandable, /aria-expanded=\{expanded\}/);
  assert.match(expandable, /aria-controls=\{controls\}/);
  assert.match(expandable, /focus-visible:ring-2/);
});

test('each card keeps its own open state: nothing is shared between posts', () => {
  assert.match(expandable, /const \[expanded, setExpanded\] = useState\(false\)/);
  assert.match(body, /const \[expanded, setExpanded\] = useState\(false\)/);
  assert.doesNotMatch(community, /expandedContent|expandedText|expandedPosts/, 'no feed-level map of open posts');
  assert.doesNotMatch(board, /expandedCards|setExpanded\(/, 'the board holds no expansion state either');
  assert.match(community, /<ExpandableText\s+key=\{post\.id\}/);
});

test('collapsing a card keeps the reader oriented, and expanding does not move anything above it', () => {
  assert.match(expandable, /if \(card\.getBoundingClientRect\(\)\.top < 0\) card\.scrollIntoView\(\{ block: 'start' \}\)/);
  assert.match(expandable, /if \(wasExpanded\) keepCardInView/);
  assert.match(body, /if \(wasExpanded\) keepCardInView/);
  assert.match(community, /scroll-mt-\[calc\(var\(--header-h\)/, 'room for the sticky header');
  assert.match(board, /scroll-mt-\[calc\(var\(--header-h\)/);
});

test('the Community card shows avatar, name, category badge, relative time, title, preview and the usual engagement', () => {
  assert.match(community, /formatRelativeTime\(post\.timestamp\)/);
  assert.match(community, /CATEGORY_LABELS\[post\.category\]/);
  assert.match(community, /\{post\.title\}/);
  for (const kept of ['handleLikePost', 'setExpandedReplies', 'handleShare', 'aria-label={`${replyCount} replies`}']) assert.ok(community.includes(kept), kept);
});

test('a Looking For card previews: three-line intro, short Looking for summary, three interests, Send Signal in reach', () => {
  assert.match(body, /line-clamp-3/);
  assert.match(body, /line-clamp-2/);
  assert.match(body, /previewTags\(post\.tags, expanded\)/);
  assert.match(body, /more="View details"/);
  // Send Signal sits in the footer row, outside anything that depends on the expanded state.
  const footer = body.slice(body.indexOf('<div className="mt-3 flex items-center gap-2">'));
  assert.match(footer, /\{!mine && <button[^>]*onClick=\{onSignal\}/);
  assert.doesNotMatch(footer.slice(footer.indexOf('{!mine'), footer.indexOf('Send Signal')), /expanded/, 'the action never depends on the open state');
  assert.match(board, /<Badge>\{INTENTION_LABELS\[post\.intention\]\}<\/Badge>/, 'the intention is a badge');
  assert.match(board, /formatRelativeTime\(post\.timestamp\)/);
});

test('mature posts: the details control exists only on an open post, so expanding can never reveal anything', () => {
  const start = board.search(/\)\s*:\s*\(\s*<div className="mt-3 relative rounded-2xl border/);
  assert.ok(start > 0);
  const covered = board.slice(start, board.indexOf('</article>', start));
  for (const leak of ['LookingForBody', 'ExpandableText', 'View details', 'Read more', 'post.intro', 'post.lookingFor', 'post.title', 'post.tags']) {
    assert.equal(covered.includes(leak), false, `${leak} must not appear in the covered branch`);
  }
  assert.match(board, /presentation === 'open' \? \(\s*<LookingForBody/, 'the body is only mounted for an open post');
  assert.match(covered, /Reveal content/, 'reveal is its own separate action');
  assert.equal(body.includes('Reveal content'), false, 'the details control has no reveal in it');
  assert.equal(body.includes('nsfwPreference'), false, 'the preference logic stays in one place');
});

test('previews never carry hidden text elsewhere: no titles, snippets or labels built from concealed fields', () => {
  const start = board.search(/\)\s*:\s*\(\s*<div className="mt-3 relative rounded-2xl border/);
  const covered = board.slice(start, board.indexOf('</article>', start));
  assert.equal(/aria-label=\{[^}]*post\.(title|intro|lookingFor)/.test(board), false);
  assert.equal(/title=\{[^}]*post\.(title|intro|lookingFor)/.test(board), false);
  assert.equal(/\bdata-[a-z-]+=\{[^}]*post\.(title|intro|lookingFor)/.test(board), false);
  assert.ok(covered.length > 0);
});

test('the preview components fetch nothing: they work from the post already on screen', () => {
  for (const [name, text] of [['ExpandableText', expandable], ['LookingForBody', body]]) {
    assert.equal(/firebase|firestore|fetch\(|services\//.test(text), false, `${name} must not read data`);
  }
  assert.match(community, /subscribeToCommunity/, 'the feed still loads through its existing live query');
  assert.match(board, /subscribeToLookingFor/);
});

test('nothing in the cards can scroll sideways: long words wrap and rows can shrink', () => {
  assert.match(expandable, /MoreButton/);
  assert.match(body, /\[overflow-wrap:anywhere\]/);
  assert.match(community, /\[overflow-wrap:anywhere\]/);
  assert.match(body, /flex-wrap gap-1\.5/, 'interest tags wrap');
});

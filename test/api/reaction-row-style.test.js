import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const view = read('src/components/UnsaidView.tsx');
const icons = read('src/components/ReactionIcons.tsx');
const css = read('src/index.css');
const row = view.slice(view.indexOf('{REACTIONS.map('), view.indexOf('{formatPostedAgo('));

test('the six reactions keep their identity: same ids, order and meaning, and Crygago keeps its original artwork', () => {
  const list = view.slice(view.indexOf('const REACTIONS'), view.indexOf('function loadReacted'));
  assert.deepEqual([...list.matchAll(/type: '(\w+)', emoji: '([^']+)'/g)].map((m) => [m[1], m[2]]), [
    ['hugs', '🫂'], ['same', '🤍'], ['felt', '🥺'], ['strong', '💪'], ['proud', '🌈'], ['cry', '😭'],
  ]);
  assert.match(list, /type: 'cry', emoji: '😭', label: 'Crying with you', img: '\/emoji\/cry\.webp'/);
  assert.ok(fs.existsSync('public/emoji/cry.webp'), 'the original Crygago is still there');
});

test('no colourful emoji glyph or colour image is drawn in the row: every reaction is a one-colour line-art icon', () => {
  assert.match(row, /<ReactionIcon type=\{type\} \/>/);
  assert.doesNotMatch(row, /\{emoji\}|<img\b/, 'neither an emoji glyph nor the colour image is rendered in the row');
  assert.match(view, /import \{ ReactionIcon \} from '\.\/ReactionIcons\.tsx'/);
  assert.doesNotMatch(icons, /<img\b/, 'no <img>: nothing keeps its own colours');
});

test('Crygago is the supplied line art, made into a one-colour mask, not a re-drawing or a generic icon', () => {
  assert.match(icons, /CRY_OUTLINE_SRC = '\/emoji\/cry-outline\.png'/);
  assert.match(icons, /maskImage: mask/);
  assert.match(icons, /bg-current/, 'painted in the button\'s colour, so it follows state and theme');
  assert.ok(fs.existsSync('scripts/assets/cry-lineart-source.png'), 'the supplied artwork is kept');
  assert.ok(fs.existsSync('scripts/make-cry-mask.py'), 'the mask can be regenerated from it');
  assert.match(read('scripts/make-cry-mask.py'), /cry-lineart-source\.png/);
  assert.ok(fs.existsSync('public/emoji/cry.webp'), 'the original colour artwork is untouched');
  // The mask is single-colour line art: an RGBA PNG (shape in the alpha channel) with a transparent margin.
  const png = fs.readFileSync('public/emoji/cry-outline.png');
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png[25], 6, 'RGBA');
  assert.ok(png.length < 40_000, 'a small asset');
});

test('colours follow the theme: muted lavender-gray at rest, accent lavender when chosen, transparent at all times', () => {
  const start = row.indexOf('className={`group');
  const button = row.slice(start, row.indexOf('`}', start));
  assert.match(button, /\bbg-transparent\b/);
  assert.match(button, /active \? 'text-lavender ring-1 ring-inset ring-lavender\/35' : 'text-\[var\(--reaction-rest\)\]'/);
  assert.doesNotMatch(button, /#[0-9a-f]{3,6}/i, 'no fixed colour in the component: both themes come from variables');
  assert.doesNotMatch(button, /(?<![-\w])(border|shadow)|bg-plum|bg-raised|bg-berry|bg-lavender/, 'no border, shadow or filled background');
  assert.match(css, /:root \{[^}]*--reaction-rest: #a99db3;/, 'dark: the specified muted lavender-gray');
  assert.match(css, /html\[data-theme='light'\] \{[^}]*--reaction-rest: #85778f;/, 'light: a deeper muted tone');
  assert.match(css, /html\[data-theme='light'\] \{[^}]*--color-lavender: #77528e;/, 'the chosen colour is theme-aware too');
});

test('icons are one consistent size (20px) and counts stay small and secondary', () => {
  assert.match(icons, /REACTION_ICON_PX = 20/);
  assert.match(row, /text-\[length:calc\(11px_\*_var\(--fs,1\)\)\] tabular-nums \$\{active \? 'text-lavender' : 'text-subtle'\}/);
});

test('mobile: touch targets stay 32px, and below 340px the spacing tightens so six reactions keep to one line', () => {
  assert.match(row, /h-8 min-w-8/);
  assert.match(row, /px-1\.5 max-\[340px\]:px-1/);
  assert.match(view, /flex flex-wrap items-center gap-1 max-\[340px\]:gap-0/);
});

test('the reaction logic is unchanged: one reaction per post, saved, sent to the same service', () => {
  assert.match(view, /if \(reacted\[postId\]\) return;/);
  assert.match(view, /await reactToUnsaid\(postId, type\);/);
  assert.match(row, /onClick=\{\(\) => handleReact\(post\.id, type\)\}/);
  assert.match(row, /disabled=\{Boolean\(myReaction\) && !active\}/);
});

test('it stays accessible: a label with the count, pressed state, keyboard focus ring, icons hidden from screen readers', () => {
  assert.match(row, /aria-pressed=\{active\}/);
  assert.match(row, /aria-label=\{`\$\{label\}, \$\{post\[type\]\}`\}/);
  assert.match(row, /focus-visible:ring-2 focus-visible:ring-berry\/60/);
  assert.match(row, /<button\b/, 'real buttons, so Enter and Space work');
  assert.equal((icons.match(/aria-hidden="true"/g) || []).length, 2, 'both the SVG and the Crygago mask are decorative');
});

test('hover and press scale the drawing, one pop plays on the chosen reaction, and reduced motion switches it off', () => {
  assert.match(row, /group-enabled:group-hover:scale-110/);
  assert.match(row, /group-enabled:group-active:scale-90/);
  assert.match(view, /setPopped\(`\$\{postId\}:\$\{type\}`\);/);
  assert.match(row, /popped === `\$\{post\.id\}:\$\{type\}` \? 'reaction-pop' : ''/);
  assert.match(css, /\.reaction-pop \{ animation: qs-react 220ms/);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  *,'));
  assert.match(reduced.slice(0, 400), /animation-duration: 0\.01ms !important/);
});

test('nothing else changed: Community, Stardust, the Galaxy Room and chat reactions do not use the new icons', () => {
  for (const file of ['src/components/CommunityFeedView.tsx', 'src/components/StardustButton.tsx', 'src/components/PublicRoomView.tsx', 'src/components/ChatView.tsx', 'src/components/SignalsConversation.tsx']) {
    assert.doesNotMatch(read(file), /ReactionIcons/, file);
  }
  const unsaid = read('src/services/unsaidService.ts');
  assert.match(unsaid, /UNSAID_REACTIONS = \['hugs', 'same', 'felt', 'strong', 'proud', 'cry'\] as const/, 'the schema is the same');
});

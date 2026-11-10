import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const view = read('src/components/UnsaidView.tsx');
const css = read('src/index.css');
const row = view.slice(view.indexOf('{REACTIONS.map('), view.indexOf('{formatPostedAgo('));

test('the reactions themselves are untouched: same emojis, same order, same ids, and the custom Crygago image', () => {
  const list = view.slice(view.indexOf('const REACTIONS'), view.indexOf('function loadReacted'));
  assert.deepEqual([...list.matchAll(/type: '(\w+)', emoji: '([^']+)'/g)].map((m) => [m[1], m[2]]), [
    ['hugs', '🫂'], ['same', '🤍'], ['felt', '🥺'], ['strong', '💪'], ['proud', '🌈'], ['cry', '😭'],
  ]);
  assert.match(list, /type: 'cry', emoji: '😭', label: 'Crying with you', img: '\/emoji\/cry\.webp'/, 'Crygago keeps its custom image');
  assert.ok(fs.existsSync('public/emoji/cry.webp'));
  assert.doesNotMatch(row, /lucide|<svg/i, 'no icon replaces an emoji');
});

test('the reaction logic is unchanged: one reaction per post, saved, sent to the same service', () => {
  assert.match(view, /if \(reacted\[postId\]\) return;/);
  assert.match(view, /await reactToUnsaid\(postId, type\);/);
  assert.match(row, /onClick=\{\(\) => handleReact\(post\.id, type\)\}/);
  assert.match(row, /disabled=\{Boolean\(myReaction\) && !active\}/);
});

test('at rest a reaction is transparent with no border, shadow or filled pill; only the chosen one is outlined, faintly', () => {
  const start = row.indexOf('className={`group');
  const button = row.slice(start, row.indexOf('`}', start));
  assert.match(button, /\bbg-transparent\b/);
  assert.doesNotMatch(button, /(?<![-\w])(border|shadow)|bg-plum|bg-raised|bg-berry|bg-lavender/, 'no border, shadow or filled background');
  assert.match(button, /active \? 'ring-1 ring-inset ring-lavender\/35' : ''/, 'a faint outline marks the chosen one');
});

test('the emoji is about 19px, counts are small and secondary, hover and press scale it a little', () => {
  assert.match(row, /text-\[length:calc\(19px_\*_var\(--fs,1\)\)\]/);
  assert.match(row, /width=\{20\} height=\{20\}/);
  assert.match(row, /text-\[length:calc\(11px_\*_var\(--fs,1\)\)\] tabular-nums \$\{active \? 'text-lavender' : 'text-subtle'\}/);
  assert.match(row, /group-enabled:group-hover:scale-110/);
  assert.match(row, /group-enabled:group-active:scale-90/);
});

test('it stays accessible: a label with the count, pressed state, keyboard focus ring', () => {
  assert.match(row, /aria-pressed=\{active\}/);
  assert.match(row, /aria-label=\{`\$\{label\}, \$\{post\[type\]\}`\}/);
  assert.match(row, /focus-visible:ring-2 focus-visible:ring-berry\/60/);
  assert.match(row, /<button\b/, 'real buttons, so Enter and Space work');
});

test('the pop plays only on the reaction just chosen, and is switched off for reduced motion', () => {
  assert.match(view, /setPopped\(`\$\{postId\}:\$\{type\}`\);/);
  assert.match(row, /popped === `\$\{post\.id\}:\$\{type\}` \? 'reaction-pop' : ''/);
  assert.match(css, /\.reaction-pop \{ animation: qs-react 220ms/);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  *,'));
  assert.match(reduced.slice(0, 400), /animation-duration: 0\.01ms !important/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HOME, PAGES, SITE } from '../scripts/seo/pages.mjs';

// Line endings differ between Windows checkouts and the generator, so compare with LF only.
const read = (f) => fs.readFileSync(f, 'utf8').split('\r\n').join('\n');
const pageFile = (p) => `public/${p.path.slice(1)}.html`;
const meta = (html, re) => (re.exec(html) || [])[1];
const index = read('index.html');
const vercel = JSON.parse(read('vercel.json'));
const stripTags = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('every public page has its own title, description, self-referential canonical and one h1', () => {
  const titles = new Set([HOME.title]);
  const descriptions = new Set([HOME.description]);
  for (const page of PAGES) {
    const html = read(pageFile(page));
    const title = meta(html, /<title>([^<]*)<\/title>/).replace(/&amp;/g, '&');
    const description = meta(html, /<meta name="description" content="([^"]*)"/).replace(/&amp;/g, '&');
    assert.equal(title, page.title);
    assert.ok(title.length <= 75, `${page.path} title length ${title.length}`);
    assert.ok(description.length >= 70 && description.length <= 175, `${page.path} description length ${description.length}`);
    assert.ok(!titles.has(title) && !descriptions.has(description), `${page.path} duplicates another page's metadata`);
    titles.add(title);
    descriptions.add(description);
    assert.equal(meta(html, /<link rel="canonical" href="([^"]*)"/), `${SITE}${page.path}`);
    assert.equal(meta(html, /<meta property="og:url" content="([^"]*)"/), `${SITE}${page.path}`);
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1, `${page.path} must have exactly one h1`);
    assert.equal(/noindex/i.test(meta(html, /<meta name="robots" content="([^"]*)"/)), false);
    assert.ok(stripTags(html).split(' ').length > 350, `${page.path} should not be thin`);
    for (const block of html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []) {
      JSON.parse(block.replace(/<\/?script[^>]*>/g, ''));
    }
  }
});

test('the homepage metadata uses the real www host and matches the page list', () => {
  assert.equal(meta(index, /<link rel="canonical" href="([^"]*)"/), `${SITE}/`);
  assert.equal(meta(index, /<meta property="og:url" content="([^"]*)"/), `${SITE}/`);
  assert.match(meta(index, /<meta property="og:image" content="([^"]*)"/), /^https:\/\/www\.queerspaceph\.com\//);
  assert.equal(/https:\/\/queerspaceph\.com/.test(index), false, 'no links to the redirecting apex host');
  assert.equal(meta(index, /<title>([^<]*)<\/title>/).replace(/&amp;/g, '&'), HOME.title);
  assert.equal(meta(index, /<meta name="description" content="([^"]*)"/), HOME.description);
  const graph = JSON.parse(meta(index, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/))['@graph'];
  assert.deepEqual(graph.map((n) => n['@type']).sort(), ['Organization', 'WebSite']);
  // Crawlable content exists in the static HTML, and it links to every landing page.
  assert.match(index, /<div id="root">\s*<!--[\s\S]*?<main class="seo-fallback">\s*<h1>/);
  for (const page of PAGES) assert.ok(index.includes(`href="${page.path}"`), `${page.path} linked from the homepage`);
});

test('the sitemap lists exactly the canonical public pages and nothing private', () => {
  const sitemap = read('public/sitemap.xml');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, [`${SITE}/`, ...PAGES.map((p) => `${SITE}${p.path}`)]);
  assert.equal(/admin|api|signal|chat\/|profile|__/i.test(locs.map((l) => l.replace('anonymous-wlw-chat', '')).join(' ')), false);
  assert.equal(new Set(locs).size, locs.length, 'no duplicate URLs');
});

test('robots.txt allows search engines on public pages, excludes admin and API, and points to the sitemap', () => {
  const robots = read('public/robots.txt');
  for (const agent of ['*', 'Googlebot', 'OAI-SearchBot']) {
    const block = new RegExp(`User-agent: ${agent.replace('*', '\\*')}\\nAllow: /\\n([\\s\\S]*?)(\\n\\n|$)`).exec(robots);
    assert.ok(block, `${agent} group`);
    assert.match(block[1], /Disallow: \/admin/);
    assert.match(block[1], /Disallow: \/api\//);
  }
  assert.match(robots, /Sitemap: https:\/\/www\.queerspaceph\.com\/sitemap\.xml/);
  assert.equal(/Disallow: \/(assets|emoji|\*\.js|\*\.css)/.test(robots), false, 'rendering assets stay crawlable');
  assert.equal(/Disallow: \/\s/.test(robots), false, 'the whole site is not blocked');
});

test('hosting config: no catch-all rewrite, clean URLs, noindex on admin and API', () => {
  // cleanUrls stays off so the Search Console verification file is served at its exact .html URL;
  // the landing pages get clean URLs through explicit rewrites, and their .html twins redirect to them.
  assert.notEqual(vercel.cleanUrls, true);
  for (const page of PAGES) {
    assert.ok(vercel.rewrites.some((r) => r.source === page.path && r.destination === `${page.path}.html`), `${page.path} rewrite`);
    assert.ok(vercel.redirects.some((r) => r.source === `${page.path}.html` && r.destination === page.path && r.permanent), `${page.path}.html redirect`);
  }
  assert.equal(vercel.redirects.some((r) => /google/.test(r.source)), false, 'the verification file is never redirected');
  const sources = vercel.rewrites.map((r) => r.source);
  assert.equal(sources.includes('/(.*)'), false, 'unknown URLs must 404 instead of returning the app');
  assert.ok(sources.includes('/admin'));
  assert.ok(sources.includes('/signals'), '/signals opens the app on the Signals inbox');
  const noindex = vercel.headers.filter((h) => h.headers.some((x) => x.key === 'X-Robots-Tag' && /noindex/.test(x.value))).map((h) => h.source);
  for (const s of ['/admin', '/signals', '/api/:path*']) assert.ok(noindex.includes(s), `${s} sends noindex`);
  assert.match(read('public/404.html'), /noindex/);
});

test('internal links on every page point to real pages or assets', () => {
  const known = new Set(['/', ...PAGES.map((p) => p.path)]);
  for (const file of ['index.html', ...PAGES.map(pageFile), 'public/404.html']) {
    for (const [, href] of read(file).matchAll(/href="(\/[^"#?]*)"/g)) {
      if (known.has(href) || fs.existsSync(`public${href}`)) continue;
      assert.fail(`${file} links to ${href}, which does not exist`);
    }
  }
});

test('the service worker never serves the app shell for the static pages', () => {
  const config = read('vite.config.ts');
  for (const page of PAGES) assert.ok(config.includes(page.path.slice(1)), `${page.path} in navigateFallbackDenylist`);
  assert.ok(config.includes('sitemap'));
});

test('the generated files are up to date with scripts/seo/pages.mjs', async () => {
  const { execFileSync } = await import('node:child_process');
  const before = ['public/robots.txt', 'public/sitemap.xml', 'public/404.html', ...PAGES.map(pageFile)].map(read);
  execFileSync(process.execPath, ['scripts/generate-seo-pages.mjs'], { stdio: 'ignore' });
  const after = ['public/robots.txt', 'public/sitemap.xml', 'public/404.html', ...PAGES.map(pageFile)].map(read);
  assert.deepEqual(after, before);
});

test('Google Search Console verification: exact file and a single exact meta tag', () => {
  const file = fs.readFileSync('public/google2171650d1368b006.html', 'utf8');
  assert.equal(file, 'google-site-verification: google2171650d1368b006.html');
  const tags = index.match(/<meta name="google-site-verification"[^>]*>/g) || [];
  assert.equal(tags.length, 1, 'exactly one verification tag');
  assert.equal(tags[0], '<meta name="google-site-verification" content="d6_mLeo2OczliZysWty_P2zp9_MTZ4jhXWRSmPeCuvw" />');
  assert.ok(index.indexOf('google-site-verification') < index.indexOf('</head>'), 'the tag is inside <head>');
  for (const f of ['public/robots.txt', 'public/sitemap.xml']) assert.equal(read(f).includes('google2171650d1368b006'), false, `${f} does not list the file`);
  assert.ok(read('vite.config.ts').includes('google['), 'the service worker never replaces the file with the app shell');
});

// Generates the static public pages, sitemap.xml, robots.txt, 404.html and their stylesheet into public/.
// Run: npm run seo (the production build runs it first). Output is committed so changes are reviewable.
import fs from 'node:fs';
import path from 'node:path';
import { ANCHORS, HOME, OG_IMAGE, PAGES, SITE, SITE_NAME, UPDATED } from './seo/pages.mjs';

const OUT = path.resolve('public');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const url = (p) => (p === '/' ? `${SITE}/` : `${SITE}${p}`);

const CSS = `:root{color-scheme:dark;--ink:#120b17;--surface:#1a111f;--line:#33253a;--fg:#f7f0f6;--muted:#c4b6c9;--berry:#e07bb8;--lav:#c8b5e6}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--ink);color:var(--fg);font:17px/1.7 "Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--berry);text-underline-offset:3px}a:hover{color:var(--fg)}
a:focus-visible{outline:2px solid var(--berry);outline-offset:3px;border-radius:4px}
header.site{border-bottom:1px solid var(--line);background:rgba(18,11,23,.9)}
.wrap{max-width:46rem;margin:0 auto;padding:0 1.25rem}
header.site .wrap{display:flex;align-items:center;justify-content:space-between;gap:1rem;min-height:3.5rem;flex-wrap:wrap;padding-top:.4rem;padding-bottom:.4rem}
.brand{font-family:"Playfair Display",Georgia,serif;font-weight:600;font-size:1.15rem;color:var(--fg);text-decoration:none;letter-spacing:.02em}
.brand span{color:var(--berry);margin-left:.25em}
.open{display:inline-flex;align-items:center;min-height:2.75rem;padding:0 1.1rem;border-radius:999px;background:var(--berry);color:var(--ink);font-weight:600;font-size:.95rem;text-decoration:none}
.open:hover{color:var(--ink);filter:brightness(1.08)}
nav.crumbs{font-size:.85rem;color:var(--muted);padding-top:1.25rem}
nav.crumbs a{color:var(--muted)}
main{padding-bottom:3rem}
h1{font-family:"Playfair Display",Georgia,serif;font-weight:600;font-size:clamp(1.9rem,6vw,2.6rem);line-height:1.15;letter-spacing:-.01em;margin:1rem 0 .75rem}
h2{font-family:"Playfair Display",Georgia,serif;font-weight:600;font-size:1.5rem;line-height:1.25;margin:2.4rem 0 .6rem}
h3{font-size:1.05rem;margin:1.5rem 0 .25rem}
p.lead{font-size:1.15rem;color:var(--muted);margin-top:0}
li{margin:.35rem 0}
ol,ul{padding-left:1.25rem}
.cta{margin:2.5rem 0 0;padding:1.4rem;border:1px solid var(--line);border-radius:1.25rem;background:var(--surface)}
.cta p{margin:.2rem 0 .9rem;color:var(--muted)}
.more{margin-top:2.5rem;border-top:1px solid var(--line);padding-top:1.25rem}
.more h2{font-size:1.1rem;margin:0 0 .5rem}
footer.site{border-top:1px solid var(--line);color:var(--muted);font-size:.9rem;padding:1.5rem 0 2.5rem}
footer.site a{color:var(--muted)}
footer.site ul{list-style:none;padding:0;margin:.5rem 0 0;display:flex;flex-wrap:wrap;gap:.25rem 1.25rem}
`;

const head = ({ title, description, path: p, robots = 'index,follow' }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="${robots}">
<link rel="canonical" href="${url(p)}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url(p)}">
<meta property="og:image" content="${OG_IMAGE}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="QUEERSPACE PH: a sapphic space for women who love women">
<meta property="og:locale" content="en_PH">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${OG_IMAGE}">
<meta name="theme-color" content="#120b17">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600&family=Playfair+Display:wght@500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/seo-pages.css">
`;

const siteHeader = `<header class="site"><div class="wrap"><a class="brand" href="/">QUEERSPACE<span>PH</span></a><a class="open" href="/">Open app</a></div></header>`;

const siteFooter = (current) => `<footer class="site"><div class="wrap">
<p>${SITE_NAME} is a sapphic space for women who love women in the Philippines. For adults, 18 and over.</p>
<ul>${[HOME.path, ...PAGES.map((p) => p.path)].filter((p) => p !== current).map((p) => `<li><a href="${p}">${esc(ANCHORS[p])}</a></li>`).join('')}</ul>
</div></footer>`;

function renderPage(page) {
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: SITE_NAME, item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: page.h1, item: url(page.path) },
    ],
  };
  const related = page.related.map((p) => `<li><a href="${p}">${esc(ANCHORS[p])}</a></li>`).join('');
  return `${head(page)}<script type="application/ld+json">${JSON.stringify(breadcrumb)}</script>
</head>
<body>
${siteHeader}
<main class="wrap">
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">${SITE_NAME}</a> › <span>${esc(page.h1)}</span></nav>
<h1>${esc(page.h1)}</h1>
<p class="lead">${esc(page.lead)}</p>
${page.body}
<section class="cta" aria-label="Open QUEERSPACE PH"><h2 style="margin-top:0;font-size:1.25rem">Ready to say hello?</h2><p>QUEERSPACE PH is anonymous, needs no account, and is for women 18 and over.</p><a class="open" href="/">Open QUEERSPACE PH</a></section>
<section class="more" aria-label="Keep reading"><h2>Keep reading</h2><ul>${related}</ul></section>
</main>
${siteFooter(page.path)}
</body>
</html>
`;
}

function renderNotFound() {
  const meta = { title: 'Page not found | QUEERSPACE PH', description: 'This page does not exist.', path: '/404', robots: 'noindex,follow' };
  return `${head(meta).replace(/<link rel="canonical"[^>]*>\n/, '')}</head>
<body>
${siteHeader}
<main class="wrap"><h1>We could not find that page</h1><p class="lead">The link may be old or mistyped.</p>
<p><a class="open" href="/">Go to QUEERSPACE PH</a></p>
<section class="more"><h2>You might want</h2><ul>${PAGES.map((p) => `<li><a href="${p.path}">${esc(ANCHORS[p.path])}</a></li>`).join('')}</ul></section></main>
</body>
</html>
`;
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[HOME, ...PAGES].map((p) => `  <url><loc>${url(p.path)}</loc><lastmod>${UPDATED}</lastmod></url>`).join('\n')}
</urlset>
`;

// Named groups repeat the rules because a crawler follows only its most specific group.
const DISALLOW = ['/admin', '/api/', '/__/'];
const group = (agent) => `User-agent: ${agent}\nAllow: /\n${DISALLOW.map((d) => `Disallow: ${d}`).join('\n')}\n`;
const robots = `# QUEERSPACE PH. Public pages are open to search engines.
# The app itself has no private URLs; /admin and /api/ are excluded and also send noindex headers.
${['*', 'Googlebot', 'OAI-SearchBot', 'Bingbot'].map(group).join('\n')}
Sitemap: ${SITE}/sitemap.xml
`;

const write = (name, content) => fs.writeFileSync(path.join(OUT, name), content);
fs.mkdirSync(OUT, { recursive: true });
write('seo-pages.css', CSS);
for (const page of PAGES) write(`${page.path.slice(1)}.html`, renderPage(page));
write('404.html', renderNotFound());
write('sitemap.xml', sitemap);
write('robots.txt', robots);
console.log(`SEO files written: ${PAGES.length} pages, sitemap.xml, robots.txt, 404.html`);

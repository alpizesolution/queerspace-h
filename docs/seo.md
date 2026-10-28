# SEO notes

Public, indexable pages live in `scripts/seo/pages.mjs`. `npm run seo` (also run by `npm run build`) writes the HTML pages,
`sitemap.xml`, `robots.txt`, `404.html` and `seo-pages.css` into `public/`. The generated files are committed so changes are reviewable;
`api/seo.test.js` fails if they drift from the source.

- The app (`index.html`) is the homepage. Its static HTML carries the metadata, structured data and a crawlable summary; React replaces the summary on start.
- Unknown URLs return a real 404 (no catch-all rewrite). `/admin` serves the app and sends `X-Robots-Tag: noindex`; `/api/*` also sends noindex.
- Canonical host is `https://www.queerspaceph.com` (the apex redirects to it).
- Add a new landing page by adding an entry to `PAGES`, adding its path to the service-worker denylist in `vite.config.ts`, then `npm run seo`.

## Manual setup (needs account access; nothing here is configured by the code)

1. **Google Search Console**: add the property `https://www.queerspaceph.com/` (URL prefix) or the domain, verify ownership (DNS TXT record, or an HTML tag / file with the token Google gives you), then submit `https://www.queerspaceph.com/sitemap.xml` under Sitemaps.
2. Use **URL Inspection** on `/` and each landing page, then "Request indexing". Indexing is decided by Google and can take days or weeks.
3. **Bing Webmaster Tools** (optional): import the site from Search Console, or add it and verify; submit the same sitemap.
4. Watch Search Console > Performance and Pages for queries, impressions and indexing problems.

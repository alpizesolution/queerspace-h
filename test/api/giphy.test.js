import test from 'node:test';
import assert from 'node:assert/strict';
import { GIF_PAGE_MAX, createGiphy, isApprovedGifUrl, isGifId, parseGifQuery, shapeGif, shapeStoredGif } from '../../api/_giphy.js';

const KEY = 'test-key-never-in-output';
const ID = 'abc123XYZ';
const media = (id, name, ext = 'gif', host = 'media2.giphy.com') => `https://${host}/media/v1.Y2lkPTc5MGI3NjEx/${id}/${name}.${ext}?cid=1&rid=${name}.${ext}`;
const img = (id, name, w = 200, h = 150) => ({ url: media(id, name), width: String(w), height: String(h) });

function giphyItem(id = ID, extra = {}) {
  return {
    id,
    rating: 'g',
    title: 'Happy dance GIF',
    images: {
      fixed_width: img(id, '200w'),
      downsized_medium: img(id, 'giphy-downsized-medium', 400, 300),
      fixed_width_still: img(id, '200w_s'),
    },
    ...extra,
  };
}

/** A fake fetch that records every call and answers from a queue. */
function fakeFetch(...answers) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url: String(url), options });
    const answer = answers.length > 1 ? answers.shift() : answers[0];
    if (answer instanceof Error) throw answer;
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => { if (answer.bad) throw new Error('bad json'); return answer.body; } };
  };
  return { impl, calls };
}

test('GIF ids are letters and digits only', () => {
  assert.equal(isGifId(ID), true);
  for (const bad of ['', 'abc', 'a/b/c/d/e', '../../x1234', 'abc 12345', 'abc12345?x=1', null, 12345, 'a'.repeat(31)]) assert.equal(isGifId(bad), false, String(bad));
});

test('only https GIPHY media addresses that belong to the GIF are approved', () => {
  assert.equal(isApprovedGifUrl(media(ID, 'giphy'), ID), true);
  assert.equal(isApprovedGifUrl(`https://media.giphy.com/media/${ID}/giphy.gif`, ID), true);
  assert.equal(isApprovedGifUrl(`https://i.giphy.com/${ID}.gif`, ID), true);
  const bad = [
    `http://media.giphy.com/media/${ID}/giphy.gif`, // not https
    `https://evil.example/media/${ID}/giphy.gif`,
    `https://media.giphy.com.evil.example/media/${ID}/giphy.gif`,
    `https://evilgiphy.com/media/${ID}/giphy.gif`,
    `https://user:pw@media.giphy.com/media/${ID}/giphy.gif`,
    `https://media.giphy.com:8443/media/${ID}/giphy.gif`,
    `https://media.giphy.com/media/OTHERID99/giphy.gif`, // another GIF's address
    `https://media.giphy.com/media/${ID}/giphy.html`,
    `javascript:alert(1)`,
    `data:image/gif;base64,R0lGOD`,
    '//media.giphy.com/media/abc123XYZ/giphy.gif',
    'not a url', '', null, undefined, 42, `https://media.giphy.com/media/${ID}/giphy.gif?${'a'.repeat(700)}`,
  ];
  for (const url of bad) assert.equal(isApprovedGifUrl(url, ID), false, String(url).slice(0, 60));
});

test('search parameters are checked and bounded', () => {
  assert.deepEqual(parseGifQuery({}), { q: '', limit: 18, offset: 0 });
  assert.deepEqual(parseGifQuery({ q: '  happy   dance  ', limit: '30', offset: '36' }), { q: 'happy dance', limit: 30, offset: 36 });
  assert.equal(parseGifQuery({ q: 'a\u0000b\nc' }).q, 'a b c', 'control characters become spaces');
  for (const bad of [
    { q: 'x'.repeat(51) }, { q: { a: 1 } }, { limit: '0' }, { limit: String(GIF_PAGE_MAX + 1) }, { limit: '-1' }, { limit: '5.5' }, { limit: 'abc' },
    { offset: '-1' }, { offset: '201' }, { offset: '1e3' }, { limit: '99999' },
  ]) {
    assert.throws(() => parseGifQuery(bad), (error) => error.statusCode === 400 && error.message === 'invalid_gif_request', JSON.stringify(bad));
  }
});

test('a GIPHY object becomes only approved fields; anything else is left out', () => {
  const gif = shapeGif(giphyItem());
  assert.equal(gif.id, ID);
  assert.equal(gif.previewUrl, media(ID, '200w'));
  assert.equal(gif.url, media(ID, 'giphy-downsized-medium'));
  assert.equal(gif.stillUrl, media(ID, '200w_s'));
  assert.equal(gif.width, 400);
  assert.equal(gif.previewWidth, 200);
  assert.equal(gif.title, 'Happy dance GIF');
  assert.deepEqual(Object.keys(gif).sort(), ['height', 'id', 'previewHeight', 'previewUrl', 'previewWidth', 'stillUrl', 'title', 'url', 'width']);

  assert.equal(shapeGif(giphyItem('bad/id/here')), null);
  assert.equal(shapeGif(giphyItem(ID, { rating: 'r' })), null, 'above the allowed rating');
  assert.equal(shapeGif(giphyItem(ID, { rating: 'pg-13' })) !== null, true);
  assert.equal(shapeGif({ id: ID, images: { fixed_width: { url: `https://evil.example/${ID}.gif`, width: '200', height: '150' } } }), null, 'a foreign host');
  assert.equal(shapeGif({ id: ID, images: { fixed_width: img(ID, '200w', 99999, 5) } }), null, 'absurd sizes');
  assert.equal(shapeGif({ id: ID }), null);
  assert.equal(shapeGif(null), null);
  const noStill = giphyItem();
  delete noStill.images.fixed_width_still;
  assert.equal(shapeGif(noStill).stillUrl, null);
  assert.equal(/[<>\u0007]/.test(shapeGif(giphyItem(ID, { title: '<script>alert(1)</script>\u0007 hi' })).title), false, 'no markup or control characters in a title');
});

test('a stored GIF is read back only if every address is still approved', () => {
  const good = shapeGif(giphyItem());
  assert.deepEqual(shapeStoredGif(good), good);
  assert.equal(shapeStoredGif({ ...good, url: 'https://evil.example/x.gif' }), null);
  assert.equal(shapeStoredGif({ ...good, previewUrl: 'https://evil.example/x.gif' }), null);
  assert.equal(shapeStoredGif({ ...good, stillUrl: 'https://evil.example/x.gif' }).stillUrl, null, 'a bad still is dropped, the GIF stays');
  assert.equal(shapeStoredGif({ ...good, width: 0 }), null);
  assert.equal(shapeStoredGif(undefined), null);
});

test('trending and search call GIPHY with the key on the server, a rating cap and the asked page', async () => {
  const body = { data: [giphyItem(), giphyItem('second12345')], pagination: { total_count: 100, count: 2, offset: 0 } };
  const { impl, calls } = fakeFetch({ status: 200, body });
  const giphy = createGiphy({ fetchImpl: impl, getKey: () => KEY });
  const trending = await giphy.browse({ q: '', limit: 18, offset: 0 });
  assert.equal(trending.gifs.length, 2);
  assert.equal(trending.nextOffset, 2);
  const trendingUrl = new URL(calls[0].url);
  assert.equal(trendingUrl.pathname, '/v1/gifs/trending');
  assert.equal(trendingUrl.searchParams.get('rating'), 'pg-13');
  assert.equal(trendingUrl.searchParams.get('limit'), '18');
  assert.equal(trendingUrl.searchParams.get('api_key'), KEY);

  const found = await giphy.browse({ q: 'happy dance', limit: 12, offset: 24 });
  const searchUrl = new URL(calls[1].url);
  assert.equal(searchUrl.pathname, '/v1/gifs/search');
  assert.equal(searchUrl.searchParams.get('q'), 'happy dance');
  assert.equal(searchUrl.searchParams.get('offset'), '24');
  assert.equal(found.nextOffset, 26);
  assert.equal(JSON.stringify(found).includes(KEY), false, 'the key is never in an answer');
});

test('search text cannot change which GIPHY endpoint or parameters are called', async () => {
  const { impl, calls } = fakeFetch({ status: 200, body: { data: [], pagination: { total_count: 0, count: 0 } } });
  const giphy = createGiphy({ fetchImpl: impl, getKey: () => KEY });
  await giphy.browse({ q: 'x&api_key=stolen&rating=r#', limit: 5, offset: 0 });
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/v1/gifs/search');
  assert.equal(url.searchParams.get('q'), 'x&api_key=stolen&rating=r#');
  assert.equal(url.searchParams.get('api_key'), KEY);
  assert.equal(url.searchParams.get('rating'), 'pg-13');
  assert.equal(url.searchParams.getAll('api_key').length, 1);
});

test('trending is kept for a minute so the quota is spared', async () => {
  let clock = 1_000;
  const { impl, calls } = fakeFetch({ status: 200, body: { data: [giphyItem()], pagination: { total_count: 1, count: 1 } } });
  const giphy = createGiphy({ fetchImpl: impl, getKey: () => KEY, now: () => clock });
  await giphy.browse({ q: '', limit: 18, offset: 0 });
  await giphy.browse({ q: '', limit: 18, offset: 0 });
  assert.equal(calls.length, 1);
  await giphy.browse({ q: '', limit: 18, offset: 18 });
  assert.equal(calls.length, 2, 'another page is another request');
  clock += 61_000;
  await giphy.browse({ q: '', limit: 18, offset: 0 });
  assert.equal(calls.length, 3, 'after a minute it is fetched again');
  await giphy.browse({ q: 'cats', limit: 18, offset: 0 });
  await giphy.browse({ q: 'cats', limit: 18, offset: 0 });
  assert.equal(calls.length, 5, 'searches are never kept');
});

test('GIPHY problems become short codes: not configured, rate limited, unavailable, not found', async () => {
  const run = async (answer, key = KEY) => {
    const logged = [];
    const original = console.error;
    console.error = (...args) => logged.push(args.join(' '));
    try {
      const giphy = createGiphy({ fetchImpl: fakeFetch(answer).impl, getKey: () => key });
      await giphy.browse({ q: 'x', limit: 5, offset: 0 });
      return { ok: true, logged };
    } catch (error) {
      return { status: error.statusCode, code: error.message, logged };
    } finally {
      console.error = original;
    }
  };
  assert.deepEqual((({ status, code }) => ({ status, code }))(await run({ status: 200, body: {} }, null)), { status: 503, code: 'gif_not_configured' });
  assert.deepEqual((({ status, code }) => ({ status, code }))(await run({ status: 200, body: {} }, '   ')), { status: 503, code: 'gif_not_configured' });
  assert.deepEqual((({ status, code }) => ({ status, code }))(await run({ status: 429 })), { status: 429, code: 'gif_rate_limited' });
  assert.deepEqual((({ status, code }) => ({ status, code }))(await run({ status: 403 })), { status: 503, code: 'gif_not_configured' });
  assert.deepEqual((({ status, code }) => ({ status, code }))(await run({ status: 500 })), { status: 502, code: 'gif_unavailable' });
  assert.deepEqual((({ status, code }) => ({ status, code }))(await run({ status: 200, bad: true })), { status: 502, code: 'gif_unavailable' });
  const network = await run(Object.assign(new Error(`connect failed https://api.giphy.com/v1/gifs/search?api_key=${KEY}`), { name: 'FetchError' }));
  assert.deepEqual({ status: network.status, code: network.code }, { status: 502, code: 'gif_unavailable' });
  for (const result of [network, await run({ status: 500 }), await run({ status: 403 })]) {
    assert.equal(result.logged.join(' ').includes(KEY), false, 'the key is never written to a log');
  }
});

test('a GIF is looked up by id, and an unknown, blocked or too-strong GIF is refused', async () => {
  const ok = fakeFetch({ status: 200, body: { data: giphyItem() } });
  const giphy = createGiphy({ fetchImpl: ok.impl, getKey: () => KEY });
  const gif = await giphy.byId(ID);
  assert.equal(gif.id, ID);
  assert.equal(new URL(ok.calls[0].url).pathname, `/v1/gifs/${ID}`);

  await assert.rejects(() => giphy.byId('../../v1/gifs/search'), { message: 'invalid_gif', statusCode: 400 });
  assert.equal(ok.calls.length, 1, 'a bad id never reaches GIPHY');

  const missing = createGiphy({ fetchImpl: fakeFetch({ status: 404 }).impl, getKey: () => KEY });
  await assert.rejects(() => missing.byId(ID), { message: 'gif_not_found', statusCode: 404 });

  const strong = createGiphy({ fetchImpl: fakeFetch({ status: 200, body: { data: giphyItem(ID, { rating: 'r' }) } }).impl, getKey: () => KEY });
  await assert.rejects(() => strong.byId(ID), { message: 'gif_not_found' });

  const other = createGiphy({ fetchImpl: fakeFetch({ status: 200, body: { data: giphyItem('otherid12345') } }).impl, getKey: () => KEY });
  await assert.rejects(() => other.byId(ID), { message: 'gif_not_found' }, 'GIPHY answering with a different GIF is refused');

  const foreign = createGiphy({ fetchImpl: fakeFetch({ status: 200, body: { data: { id: ID, rating: 'g', images: { fixed_width: { url: `https://evil.example/${ID}.gif`, width: '200', height: '100' }, downsized_medium: { url: `https://evil.example/${ID}.gif`, width: '200', height: '100' } } } } }).impl, getKey: () => KEY });
  await assert.rejects(() => foreign.byId(ID), { message: 'gif_not_found' }, 'addresses off GIPHY are never stored');
});

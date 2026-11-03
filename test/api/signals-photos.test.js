import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_PHOTO_TIMER,
  MAX_PHOTO_BYTES,
  PHOTO_TIMERS,
  PHOTOS_PER_MINUTE,
  UNOPENED_TTL_MS,
  createR2Store,
  inspectImage,
  isPhotoTimer,
  photoState,
  photoView,
  signV4,
  storeFromEnv,
  stripMetadata,
} from '../../api/_media.js';
import { EXE, GIF, GPS_MARKER, HTML, SVG, makeJpeg, makePng, makeWebp } from './media-fixtures.js';

const read = (file) => fs.readFileSync(file, 'utf8');

// ------------------------------------------------------------------------------------------------------- timers
test('only 3, 5 and 8 seconds are valid timers, and 3 is the default', () => {
  assert.deepEqual(PHOTO_TIMERS, [3, 5, 8]);
  assert.equal(DEFAULT_PHOTO_TIMER, 3);
  for (const ok of [3, 5, 8]) assert.equal(isPhotoTimer(ok), true, String(ok));
  for (const bad of [0, 1, 2, 4, 6, 7, 9, 10, 15, 30, 60, -3, 3.5, '3', '5', null, undefined, NaN, Infinity, [3], { s: 3 }, true]) assert.equal(isPhotoTimer(bad), false, String(bad));
});

// ------------------------------------------------------------------------------------------- image validation
test('real JPEG, PNG and WebP files are accepted by their content, with their size read from the file', () => {
  assert.deepEqual(inspectImage(makeJpeg({ width: 320, height: 200 })), { type: 'image/jpeg', width: 320, height: 200 });
  assert.deepEqual(inspectImage(makePng({ width: 40, height: 30 })), { type: 'image/png', width: 40, height: 30 });
  assert.deepEqual(inspectImage(makeWebp({ width: 64, height: 48 })), { type: 'image/webp', width: 64, height: 48 });
});

test('SVG, GIF, HTML, executables, text and empty or tiny input are all refused, whatever they claim to be', () => {
  for (const [name, bytes] of [['svg', SVG], ['gif', GIF], ['html', HTML], ['exe', EXE], ['text', Buffer.from('hello world'.padEnd(64, '.'))], ['empty', Buffer.alloc(0)], ['tiny', Buffer.from([0xff, 0xd8, 0xff])], ['zeros', Buffer.alloc(128)]]) {
    assert.throws(() => inspectImage(bytes), (error) => error.statusCode === 400 && error.message === 'invalid_image', name);
  }
});

test('damaged, truncated, animated and absurdly large images are refused', () => {
  const jpeg = makeJpeg();
  assert.throws(() => inspectImage(jpeg.subarray(0, jpeg.length - 6)), /invalid_image/, 'a JPEG with no end');
  assert.throws(() => inspectImage(makePng().subarray(0, 60)), /invalid_image/, 'a cut-off PNG');
  assert.throws(() => inspectImage(makeWebp({ animated: true })), /invalid_image/, 'an animated WebP');
  assert.throws(() => inspectImage(makeJpeg({ width: 60000, height: 60000 })), /invalid_image/, 'a decompression bomb');
  assert.throws(() => inspectImage(makePng({ width: 5000, height: 5000 }).subarray(0, 4000)), /invalid_image/);
  assert.throws(() => inspectImage(makeWebp({ width: 1, height: 1 }).subarray(0, 20)), /invalid_image/);
  const disguised = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(SVG)]);
  assert.throws(() => inspectImage(disguised), /invalid_image/, 'a JPEG header on SVG content');
});

test('the size limit is a real limit that fits inside a serverless request', () => {
  assert.equal(MAX_PHOTO_BYTES, 2_500_000);
  assert.ok(Math.ceil(MAX_PHOTO_BYTES / 3) * 4 < 4_500_000, 'the base64 body stays under the 4.5 MB request limit');
});

// ----------------------------------------------------------------------------------------- metadata stripping
test('GPS and other metadata are removed from a JPEG, a PNG and a WebP, and the result is still a valid image', () => {
  for (const [make, type] of [[makeJpeg, 'image/jpeg'], [makePng, 'image/png'], [makeWebp, 'image/webp']]) {
    const original = make({ width: 24, height: 12 });
    assert.ok(original.includes(GPS_MARKER), `${type} fixture carries a GPS string`);
    const clean = stripMetadata(original, type);
    assert.equal(clean.includes(GPS_MARKER), false, `${type} no longer carries it`);
    assert.ok(clean.length < original.length, `${type} is smaller`);
    assert.deepEqual(inspectImage(clean), { type, width: 24, height: 12 }, `${type} is still a valid image of the same size`);
  }
});

test('stripping keeps the picture: the pixel data is copied unchanged', () => {
  const png = makePng();
  const clean = stripMetadata(png, 'image/png');
  const idat = (buf) => buf.subarray(buf.indexOf('IDAT') - 4, buf.indexOf('IEND') - 4);
  assert.deepEqual(idat(clean), idat(png));
  const jpeg = makeJpeg({ pad: 100 });
  const cleanJpeg = stripMetadata(jpeg, 'image/jpeg');
  assert.ok(cleanJpeg.includes(Buffer.alloc(100, 0x55)));
  const webp = stripMetadata(makeWebp(), 'image/webp');
  assert.equal(webp.readUInt32LE(4) + 8, webp.length, 'the WebP size header is correct after removing chunks');
  assert.equal(webp[20] & 0x0c, 0, 'the EXIF and XMP flags are cleared');
});

// ------------------------------------------------------------------------------------------------ expiry rules
test('a photo is judged by the server clock: unopened, viewing inside its one window, or expired', () => {
  const at = (ms) => ({ toMillis: () => ms });
  const unopened = { state: 'unopened', unopenedUntil: at(1_000 + UNOPENED_TTL_MS) };
  assert.equal(photoState(unopened, 1_001).status, 'unopened');
  assert.equal(photoState(unopened, 1_000 + UNOPENED_TTL_MS).status, 'expired', 'a photo nobody opens does not last past a day');
  for (const seconds of [3, 5, 8]) {
    const viewing = { state: 'viewing', expiresAt: at(10_000 + seconds * 1000) };
    assert.equal(photoState(viewing, 10_000 + seconds * 1000 - 1).status, 'viewing', `${seconds}s: still open a millisecond before`);
    assert.equal(photoState(viewing, 10_000 + seconds * 1000).status, 'expired', `${seconds}s: closed at the moment it ends`);
    assert.equal(photoState(viewing, 10_000 + seconds * 1000 + 60_000).status, 'expired');
  }
  for (const state of ['pending', 'expired', 'deleted', undefined]) assert.equal(photoState({ state }, 0).status, 'expired', String(state));
  assert.equal(photoState(null, 0).status, 'expired', 'a missing record is expired');
  assert.equal(photoState({ state: 'viewing' }, 0).status, 'expired', 'a viewing record with no end is expired, never open forever');
});

test('what a member is shown of a photo never includes the key or the media id', () => {
  const at = (ms) => ({ toMillis: () => ms });
  const message = { senderId: 'a', kind: 'photo', durationSec: 5, mediaId: 'secret-media-id', text: '📷 Photo' };
  const meta = { state: 'unopened', unopenedUntil: at(9_999), key: 'm/secretkey' };
  const theirs = photoView(message, meta, 'b', 1);
  const mine = photoView(message, meta, 'a', 1);
  assert.deepEqual([theirs.status, theirs.mine, theirs.durationSec], ['unopened', false, 5]);
  assert.deepEqual([mine.status, mine.mine], ['sent', true]);
  assert.equal(photoView(message, { state: 'viewing', expiresAt: at(50) }, 'a', 1).status, 'opened');
  assert.equal(photoView(message, { state: 'viewing', expiresAt: at(50) }, 'b', 60).status, 'expired');
  for (const view of [theirs, mine]) {
    const json = JSON.stringify(view);
    assert.equal(json.includes('secret'), false);
    assert.equal(/key|mediaId|url/i.test(json), false);
  }
});

// ------------------------------------------------------------------------------------------------------ R2 signing
test('request signing matches the published AWS Signature Version 4 test vector', () => {
  const authorization = signV4({
    method: 'GET', path: '/', query: '', headers: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 'service', amzDate: '20150830T123600Z',
  });
  assert.equal(authorization, 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
});

test('the R2 store sends signed, path-style requests to the private bucket and treats a missing object on delete as done', async () => {
  const calls = [];
  const responses = [{ ok: true, status: 200 }, { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }, { ok: false, status: 404 }, { ok: false, status: 500 }, { ok: false, status: 404 }, { ok: false, status: 403 }];
  const store = createR2Store({
    endpoint: 'https://acct.r2.cloudflarestorage.com', bucket: 'queerspace', accessKeyId: 'KEY', secretAccessKey: 'SECRET', now: () => new Date('2026-11-03T10:00:00Z'),
    fetchImpl: async (url, init) => { calls.push({ url, init }); return responses[calls.length - 1]; },
  });
  await store.put('m/abc123', Buffer.from('x'), 'image/jpeg');
  assert.equal(calls[0].url, 'https://acct.r2.cloudflarestorage.com/queerspace/m/abc123');
  assert.equal(calls[0].init.method, 'PUT');
  assert.match(calls[0].init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=KEY\/20261103\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.equal(calls[0].init.headers['x-amz-date'], '20261103T100000Z');
  assert.doesNotMatch(JSON.stringify(calls[0]), /SECRET/, 'the secret is never sent');
  assert.deepEqual([...(await store.get('m/abc123'))], [1, 2, 3]);
  await assert.rejects(store.get('m/gone'), (error) => error.code === 'not_found');
  await assert.rejects(store.get('m/boom'), (error) => error.code === 'r2_500');
  await store.delete('m/gone');
  await assert.rejects(store.delete('m/denied'), (error) => error.code === 'r2_403');
});

test('R2 is used only when every setting is present, and no credential is ever read by the browser code', () => {
  assert.equal(storeFromEnv({}), null);
  assert.equal(storeFromEnv({ R2_ENDPOINT: 'https://a.r2.cloudflarestorage.com', R2_BUCKET: 'queerspace', R2_ACCESS_KEY_ID: 'k' }), null);
  assert.ok(storeFromEnv({ R2_ENDPOINT: 'https://a.r2.cloudflarestorage.com', R2_BUCKET: 'queerspace', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's' }));
  for (const file of fs.readdirSync('src', { recursive: true }).filter((f) => /\.(ts|tsx)$/.test(String(f)))) {
    assert.doesNotMatch(read(`src/${file}`), /R2_(ACCESS|SECRET|ENDPOINT)|r2\.cloudflarestorage/, `src/${file}`);
  }
});

// -------------------------------------------------------------------------------------------- how it is wired
const server = read('api/_media.js');
const signals = read('api/signals.js');

test('the photo is checked, stored privately and delivered without ever being given a URL or cached', () => {
  assert.match(server, /const \{ pairRef, otherUid \} = await pairAccess\(db, uid, pairId\);\s*const image = inspectImage\(raw\);/, 'permission first, then content');
  assert.match(server, /const key = `m\/\$\{randomBytes\(24\)\.toString\('base64url'\)\}`;/, 'a random key');
  assert.match(server, /if \(message\.senderId === uid\) throw fail\(403, 'not_allowed'\);/);
  assert.match(server, /await queue\.run\(`photo-rate:\$\{uid\}`/, 'sending is rate limited');
  assert.match(signals, /setNoStoreHeaders\(res\);\s*return send\(res, outcome\.status, outcome\.body\);/);
  assert.match(server, /res\.setHeader\('Cache-Control', 'no-store, max-age=0'\);/);
  assert.match(server, /res\.setHeader\('X-Content-Type-Options', 'nosniff'\);/);
  assert.doesNotMatch(server, /getSignedUrl|presign|X-Amz-Signature|publicUrl|public-read/i, 'no signed or public URLs');
  assert.match(server, /body: \{ image: bytes\.toString\('base64'\), contentType: meta\.contentType, durationSec: meta\.durationSec, expiresAt: claim\.expiresAt, remainingMs: /, 'the open answer holds the image and times only: no key, no URL');
  assert.match(server, /Fetch before starting the clock, so a storage failure never uses up the one viewing\./);
  assert.match(server, /expiresAt = startedAt \+ current\.durationSec \* 1000;/);
  assert.match(server, /if \(state\.status === 'viewing'\) return \{ expiresAt: state\.expiresAt, firstOpen: false \};/, 'a repeat open keeps the same end time');
  assert.equal(PHOTOS_PER_MINUTE, 10);
});

test('the messages view reports a photo\'s state and timer only, and the cleanup endpoint is private and scheduled', () => {
  assert.match(signals, /\.\.\.\(data\.kind === 'photo' \? \{ kind: 'photo', photo: photos\.get\(snap\.id\)/);
  const cleanup = read('api/media-cleanup.js');
  assert.match(cleanup, /timingSafeEqual/);
  assert.match(cleanup, /process\.env\.CRON_SECRET/);
  assert.match(cleanup, /if \(!authorized\(req\)\) return send\(res, 401/);
  assert.match(read('vercel.json'), /"crons": \[\{ "path": "\/api\/media-cleanup", "schedule": "0 3 \* \* \*" \}\]/);
  assert.match(server, /Math\.min\(15 \* 60_000 \* 2 \*\* Math\.min\(attempts, 5\), 6 \* 60 \* 60_000\)/, 'failed deletions are retried with a growing pause');
});

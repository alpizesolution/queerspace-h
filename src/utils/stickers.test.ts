import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { STICKERS as SERVER, STICKER_PACKS as SERVER_PACKS, STICKER_TEXT as SERVER_TEXT, isStickerId as serverHas, shapeStoredSticker } from '../../api/_stickers.js';
import { previewText } from '../../api/_inbox.js';
import { render as renderCatalog, buildCatalog, PACKS } from '../../scripts/generate-stickers.mjs';
import { STICKERS, STICKER_PACKS, STICKER_TEXT, isStickerId, parseSticker, stickerById, stickerUrl, stickersInPack } from './stickers.ts';
import { checkedSticker, mergeMessages, visibleThread, type PendingMessage, type ThreadMessage } from './signalsThread.ts';

const root = path.resolve(import.meta.dirname, '../..');

test('two regular packs with the approved names and 20 stickers each', () => {
  assert.deepEqual(STICKER_PACKS.map((p) => p.name), ['Sapphic Feelings', 'Androgynous Sapphic']);
  assert.deepEqual(STICKER_PACKS.map((p) => stickersInPack(p.id).length), [20, 20]);
  assert.equal(STICKERS.length, 40);
});

test('the server list and the app list are identical, and the generated files are up to date with the files on disk', () => {
  assert.deepEqual(SERVER, STICKERS);
  assert.deepEqual(SERVER_PACKS, STICKER_PACKS);
  assert.equal(SERVER_TEXT, STICKER_TEXT);
  const { server, client } = renderCatalog();
  const onDisk = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(onDisk('api/_stickers.generated.js'), server, 'run npm run stickers');
  assert.equal(onDisk('src/utils/stickerCatalog.ts'), client, 'run npm run stickers');
  assert.equal(buildCatalog().length, STICKERS.length);
});

test('ids are unique and stable in shape; every sticker is a real 512x512 RGBA PNG in its own pack folder', () => {
  assert.equal(new Set(STICKERS.map((s) => s.id)).size, STICKERS.length);
  for (const s of STICKERS) {
    assert.match(s.id, /^(sapphic-feelings|androgynous-sapphic)-\d{2}$/);
    assert.equal(s.id, `${s.packId}-${s.file.slice(0, 2)}`);
    assert.equal(stickerUrl(s), `/stickers/${s.packId}/${s.file}`);
    const file = path.join(root, 'public', 'stickers', s.packId, s.file);
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG', file);
    assert.equal(bytes.readUInt32BE(16), 512, `${file} width`);
    assert.equal(bytes.readUInt32BE(20), 512, `${file} height`);
    assert.equal(bytes[25], 6, `${file} must be RGBA (colour type 6) so transparency is kept`);
  }
});

test('After Dark is not in the app or on the server: no ids, no files, no folder', () => {
  assert.equal(PACKS.some((p) => /dark/i.test(p.id)), false);
  assert.equal(STICKERS.some((s) => /dark|adult|nsfw/i.test(s.id + s.file + s.packId)), false);
  for (const generated of ['api/_stickers.generated.js', 'src/utils/stickerCatalog.ts']) {
    assert.equal(/after[-_ ]?dark/i.test(fs.readFileSync(path.join(root, generated), 'utf8')), false, generated);
  }
  assert.equal(fs.existsSync(path.join(root, 'public/stickers/after-dark')), false);
  for (const id of ['after-dark-01', 'after-dark-20']) {
    assert.equal(isStickerId(id), false);
    assert.equal(serverHas(id), false);
    assert.equal(stickerById(id), null);
  }
});

test('only an exact catalog id is accepted; everything else is refused', () => {
  for (const bad of [undefined, null, 5, {}, [], '', 'sapphic-feelings-00', 'sapphic-feelings-21', 'sapphic-feelings-1', '../sapphic-feelings-01', 'sapphic-feelings-01 ', 'SAPPHIC-FEELINGS-01', 'sapphic-feelings-01.png']) {
    assert.equal(isStickerId(bad), false, String(bad));
    assert.equal(serverHas(bad), false, String(bad));
  }
  assert.equal(isStickerId('sapphic-feelings-01'), true);
  assert.equal(isStickerId('androgynous-sapphic-20'), true);
});

test('a stored sticker is re-read from the list: the pack always comes from the list, a bad record is dropped', () => {
  assert.deepEqual(shapeStoredSticker({ id: 'sapphic-feelings-05', packId: 'after-dark' }), { id: 'sapphic-feelings-05', packId: 'sapphic-feelings' });
  assert.deepEqual(parseSticker({ id: 'androgynous-sapphic-02', packId: 'x', path: '//evil' }), { id: 'androgynous-sapphic-02', packId: 'androgynous-sapphic' });
  assert.equal(shapeStoredSticker({ id: 'after-dark-01', packId: 'after-dark' }), null);
  assert.equal(shapeStoredSticker(null), null);
  assert.equal(parseSticker({ id: 'nope' }), null);
});

test('the inbox preview is "Sticker"', () => {
  // A sticker takes the ordinary text path, so its preview is its text.
  assert.equal(previewText(SERVER_TEXT, 'text'), 'Sticker');
  assert.equal(previewText('hello', 'text'), 'hello');
  assert.equal(previewText('GIF', 'gif'), 'GIF');
});

const base = { senderId: 'u1', createdAt: '2026-01-01T10:00:00.000Z', replyTo: null, reactions: [] };

test('a valid sticker message is kept as a sticker; a bad one falls back to plain "Sticker" text and loses its picture', () => {
  const ok = checkedSticker({ ...base, id: 'm1', text: 'x', kind: 'sticker', sticker: { id: 'sapphic-feelings-03', packId: 'whatever' } });
  assert.equal(ok.kind, 'sticker');
  assert.deepEqual(ok.sticker, { id: 'sapphic-feelings-03', packId: 'sapphic-feelings' });
  const bad = checkedSticker({ ...base, id: 'm2', text: 'x', kind: 'sticker', sticker: { id: 'after-dark-01', packId: 'after-dark' } });
  assert.equal(bad.kind, undefined);
  assert.equal(bad.sticker, undefined);
  assert.equal(bad.text, 'Sticker');
  const text = { ...base, id: 'm3', text: 'hello' };
  assert.equal(checkedSticker(text), text, 'other messages are untouched');
});

test('stickers merge into a thread in time order, and a pending sticker shows as a sticker until the server confirms it', () => {
  const t = (id: string, minute: number, extra: Partial<ThreadMessage> = {}): ThreadMessage => ({ ...base, id, text: 'hi', createdAt: `2026-01-01T10:0${minute}:00.000Z`, ...extra });
  const merged = mergeMessages([t('a', 1), t('c', 3)], [t('b', 2, { kind: 'sticker', text: 'Sticker', sticker: { id: 'sapphic-feelings-01', packId: 'sapphic-feelings' } })]);
  assert.deepEqual(merged.map((m) => m.id), ['a', 'b', 'c']);
  assert.equal(merged[1].kind, 'sticker');
  const pending: PendingMessage = { id: 'p1', text: 'Sticker', stickerId: 'androgynous-sapphic-04', replyTo: null, status: 'sending', retryable: true, createdAt: Date.now() };
  const shown = visibleThread(merged, [pending], 'u1');
  const last = shown[shown.length - 1];
  assert.equal(last.kind, 'sticker');
  assert.deepEqual(last.sticker, { id: 'androgynous-sapphic-04', packId: 'androgynous-sapphic' });
  assert.equal(last.pending?.status, 'sending');
  const confirmed = visibleThread([...merged, t('p1', 4, { kind: 'sticker', sticker: { id: 'androgynous-sapphic-04', packId: 'androgynous-sapphic' } })], [pending], 'u1');
  assert.equal(confirmed.filter((m) => m.id === 'p1').length, 1);
});

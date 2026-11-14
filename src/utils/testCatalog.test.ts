import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TEST_CATALOG as SERVER, shapeStoredTest, testById as serverTest, testInviteText as serverText } from '../../api/_tests.js';
import { previewText } from '../../api/_inbox.js';
import { TEST_CATALOG, TEST_PRIVACY_NOTE, parseTestInvite, testById, testInviteText } from './testCatalog.ts';
import { checkedTest, mergeMessages, type ThreadMessage } from './signalsThread.ts';

test('the catalog has exactly the three approved tests with their exact links and descriptions', () => {
  assert.deepEqual(TEST_CATALOG.map((t) => [t.name, t.url, t.description]), [
    ['BDSM Test', 'https://bdsmtest.org/', 'Explore preferences and dynamics.'],
    ['Rice Purity Test', 'https://ricepuritytest.com/', 'A personal experience questionnaire.'],
    ['Attachment Style Quiz', 'https://www.attachmentproject.com/attachment-style-quiz/', 'Explore attachment patterns.'],
  ]);
  for (const t of TEST_CATALOG) assert.ok(t.url.startsWith('https://') && !/\s/.test(t.url), t.id);
  assert.equal(new Set(TEST_CATALOG.map((t) => t.id)).size, 3);
});

test('the links live in ONE place: no component or server file repeats a test address', () => {
  for (const file of fs.readdirSync('src/components').filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))) {
    const source = fs.readFileSync(`src/components/${file}`, 'utf8');
    for (const t of TEST_CATALOG) assert.equal(source.includes(t.url), false, `${file} must not hardcode ${t.url}`);
  }
  for (const t of TEST_CATALOG) assert.equal(fs.readFileSync('api/_tests.js', 'utf8').includes(t.url), false, 'the server never holds the links');
});

test('the server list matches the app list (ids, names and descriptions)', () => {
  assert.deepEqual(SERVER, TEST_CATALOG.map(({ id, name, description }) => ({ id, name, description })));
  assert.equal(serverText(SERVER[0]), testInviteText(TEST_CATALOG[0]));
});

test('only a catalog id is a test; forged ids and words read as nothing', () => {
  assert.equal(testById('bdsm-test')?.name, 'BDSM Test');
  for (const bad of ['', 'BDSM-TEST', 'other', undefined, null, 5, {}, ['bdsm-test']]) {
    assert.equal(testById(bad), null, String(bad));
    assert.equal(serverTest(bad), null, String(bad));
  }
  assert.deepEqual(parseTestInvite({ id: 'rice-purity-test', url: 'https://evil.example/' }), { id: 'rice-purity-test' }, 'a link in the record is ignored');
  assert.deepEqual(shapeStoredTest({ id: 'rice-purity-test', url: 'https://evil.example/' }), { id: 'rice-purity-test' });
  assert.equal(shapeStoredTest({ id: 'x' }), null);
});

test('a received invitation always reads from the catalog; a bad one is plain text and never shows a link', () => {
  const ok = checkedTest({ id: 'm1', senderId: 'b', text: 'forged words', kind: 'test', test: { id: 'attachment-style-quiz' }, createdAt: '2026-01-01T00:00:00Z' } as ThreadMessage);
  assert.equal(ok.text, 'Test invitation: Attachment Style Quiz');
  assert.deepEqual(ok.test, { id: 'attachment-style-quiz' });
  const bad = checkedTest({ id: 'm2', senderId: 'b', text: 'hi', kind: 'test', test: { id: 'nope' }, createdAt: '2026-01-01T00:00:00Z' } as ThreadMessage);
  assert.equal(bad.kind, undefined);
  assert.equal(bad.test, undefined);
  assert.equal(mergeMessages([], [ok])[0].kind, 'test');
});

test('the inbox preview names the test, and the privacy note makes no diagnosis or compatibility claim', () => {
  assert.equal(previewText('Test invitation: BDSM Test', 'test'), '📝 Test invitation: BDSM Test');
  assert.match(TEST_PRIVACY_NOTE, /never sees your answers or results/);
  assert.match(TEST_PRIVACY_NOTE, /not a diagnosis/);
  assert.match(TEST_PRIVACY_NOTE, /compatibility/);
});

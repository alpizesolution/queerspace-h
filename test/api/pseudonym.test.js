// Pure helpers behind the pseudonym reservations: the comparison key, name cleaning and the numbered fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, pseudonymKey, withSuffix } from '../../api/_pseudonym.js';

test('the key ignores case, spaces, underscores and punctuation, so near-identical names collide', () => {
  const key = pseudonymKey('VelvetMuse');
  for (const same of ['velvetmuse', 'VELVETMUSE', 'Velvet Muse', 'Velvet_Muse', ' velvet-muse ', 'Velvet.Muse']) assert.equal(pseudonymKey(same), key, same);
  assert.notEqual(pseudonymKey('VelvetMuses'), key);
});

test('a key is always a safe, non-empty document id', () => {
  for (const name of ['VelvetMuse', 'a/b', '..', '__x__', '🌸🌸', 'Kilig 🌸']) {
    const key = pseudonymKey(name);
    assert.ok(key.length > 0 && !key.includes('/') && key !== '.' && key !== '..' && !/^__.*__$/.test(key), `${name} -> ${key}`);
  }
  assert.notEqual(pseudonymKey('🌸'), pseudonymKey('🌼'));
});

test('cleanName trims, enforces 2-25 characters and rejects control characters', () => {
  assert.equal(cleanName('  VelvetMuse '), 'VelvetMuse');
  assert.equal(cleanName('a'), null);
  assert.equal(cleanName('x'.repeat(26)), null);
  assert.equal(cleanName('x'.repeat(25)), 'x'.repeat(25));
  assert.equal(cleanName('Line\nBreak'), null);
  assert.equal(cleanName('Zero​Width'), null);
  assert.equal(cleanName(42), null);
  assert.equal(cleanName(null), null);
});

test('the numbered fallback stays inside the length limit', () => {
  for (const name of ['SoftMuse', 'x'.repeat(25)]) {
    const out = withSuffix(name, () => 0.999);
    assert.ok(out.length <= 25 && /\d{2,3}$/.test(out), out);
  }
});

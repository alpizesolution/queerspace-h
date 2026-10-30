import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Signals never shows or handles age, whatever a member's "Show my age" setting is.
test('Signals code never references age, birthday or the age setting', () => {
  const files = ['src/components/SignalsView.tsx', 'src/components/SignalsConversation.tsx', 'api/signals.js'];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(/\bage\b|\bages\b|birthDate|birthday|showAgeOnProfile|ageMin|ageMax/i.test(text), false, file);
  }
});

test('the matching and age endpoints are not exposed as client-readable data', () => {
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  const flat = rules.replace(/\s+/g, ' ');
  for (const name of ['matchPrefs', 'apiRateLimits', 'birthdayCorrections', 'ageAudit']) {
    const at = flat.indexOf(`match /${name}/`);
    assert.notEqual(at, -1, name);
    assert.ok(flat.slice(at, at + 90).includes('allow read, write: if false;'), name);
  }
  assert.equal(/'ageMin'|'ageMax'/.test(rules), false, 'no age range keys are allowed in any readable document');
});

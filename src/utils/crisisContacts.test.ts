import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CRISIS_OTHER, CRISIS_PRIMARY } from './crisisContacts.ts';

test('the hotline numbers are exactly as supplied', () => {
  assert.equal(CRISIS_PRIMARY.display, '1553');
  assert.deepEqual(CRISIS_OTHER.map((c) => c.display), ['1800-1888-1553', '0919-057-1553', '0966-351-4518', '0917-899-8727', '0917-899-USAP']);
});

test('each number dials digits only; USAP maps to the keypad digits 8727', () => {
  for (const contact of [CRISIS_PRIMARY, ...CRISIS_OTHER]) assert.match(contact.tel, /^\d+$/, contact.display);
  assert.equal(CRISIS_OTHER.find((c) => c.display === '0917-899-USAP')?.tel, '09178998727');
  assert.equal(CRISIS_OTHER.find((c) => c.display === '1800-1888-1553')?.tel, '180018881553');
});

test('Echoes uses the one shared card and keeps no second, hardcoded hotline', () => {
  const echoes = fs.readFileSync('src/components/UnsaidView.tsx', 'utf8');
  assert.ok(echoes.includes('CrisisSupportCard'));
  assert.equal(/href="tel:/.test(echoes), false, 'no hardcoded tel links left in Echoes');
});

test('the card does not present QUEERSPACE as a counselling service', () => {
  const card = fs.readFileSync('src/components/CrisisSupportCard.tsx', 'utf8');
  assert.match(card, /run by the National Center for Mental Health \(NCMH\), not by QUEERSPACE/);
  assert.equal(/counsel|therap|professional/i.test(card), false);
});

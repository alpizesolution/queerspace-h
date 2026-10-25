import test from 'node:test';
import assert from 'node:assert/strict';
import { upstreamUrl } from './firebase-auth.js';

test('maps the helper paths to the project firebaseapp.com host, keeping the query', () => {
  assert.equal(
    upstreamUrl('https://queerspaceph.com/api/firebase-auth?p=__/auth/handler&apiKey=k&mode=x', 'qs-prod'),
    'https://qs-prod.firebaseapp.com/__/auth/handler?apiKey=k&mode=x'
  );
  assert.equal(
    upstreamUrl('https://queerspaceph.com/api/firebase-auth?p=__/firebase/init.json', 'qs-prod'),
    'https://qs-prod.firebaseapp.com/__/firebase/init.json'
  );
});

test('refuses anything outside the auth helper', () => {
  assert.equal(upstreamUrl('https://x.com/api/firebase-auth?p=admin', 'qs'), null);
  assert.equal(upstreamUrl('https://x.com/api/firebase-auth?p=__/auth/../../etc', 'qs'), null);
  assert.equal(upstreamUrl('https://x.com/api/firebase-auth?p=__/auth/handler', undefined), null);
});

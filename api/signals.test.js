import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { partnerSummary } from './signals.js';

function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
}

test('Signals API rejects unsupported methods and advertises allowed methods', async () => {
  const req = { method: 'DELETE', headers: {} };
  const res = makeResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 405);
  assert.deepEqual(res.body, { error: 'method_not_allowed' });
  assert.equal(res.headers.Allow, 'GET, POST');
});

test('Signals API rejects requests without a bearer token before initializing Firebase Admin', async () => {
  const req = { method: 'GET', headers: {} };
  const res = makeResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'unauthenticated' });
});

test('Signals API rejects malformed authorization headers', async () => {
  const req = { method: 'POST', headers: { authorization: 'Basic abc123' }, body: { action: 'create' } };
  const res = makeResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'unauthenticated' });
});


test('partnerSummary exposes only a pseudonym and avatar, with null fallbacks', () => {
  assert.deepEqual(partnerSummary({ displayName: '  Moon_Fox ', avatar: 'fox.1.2', birthDate: 'x', email: 'a@b.c' }), { displayName: 'Moon_Fox', avatar: 'fox.1.2' });
  assert.deepEqual(partnerSummary(null), { displayName: null, avatar: null });
  assert.deepEqual(partnerSummary({ displayName: '   ', avatar: 'x'.repeat(40) }), { displayName: null, avatar: null });
  assert.equal(partnerSummary({ displayName: 'a'.repeat(80) }).displayName.length, 30);
});

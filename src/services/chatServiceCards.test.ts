import test, { mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Comfort Cards in Seek chat, through the real chat service with a small stand-in for Firestore: what is written for a card,
 * how it falls back on older rules, and how a stored card is read back.
 */
const sent: Array<Record<string, unknown>> = [];
let denyFields: string[] = []; // fields the (older) rules refuse
let snapshotDocs: Array<{ id: string; data: () => Record<string, unknown> }> = [];

const realFirestore = await import('firebase/firestore');
mock.module('../lib/firebase.ts', { namedExports: { auth: { currentUser: { uid: 'me' } }, db: { fake: true }, isFirebaseConfigured: true, ensureAnonymousAuth: async () => ({ uid: 'me' }) } });
mock.module('firebase/firestore', {
  namedExports: {
    ...realFirestore,
    collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
    doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
    query: (base: unknown) => base,
    orderBy: () => ({}),
    limitToLast: () => ({}),
    serverTimestamp: () => 'SERVER_TIME',
    updateDoc: async () => {},
    addDoc: async (_ref: unknown, data: Record<string, unknown>) => {
      if (denyFields.some((f) => f in data)) throw Object.assign(new Error('denied'), { code: 'permission-denied' });
      sent.push(data);
      return { id: `m${sent.length}` };
    },
    onSnapshot: (_q: unknown, next: (snap: { docs: typeof snapshotDocs }) => void) => { next({ docs: snapshotDocs }); return () => {}; },
  },
});

const { sendCloudMessage, subscribeToCloudMessages } = await import('./chatService.ts');
const { cardById } = await import('../utils/comfortCards.ts');
const card = cardById('comfort-03')!;

beforeEach(() => { sent.length = 0; denyFields = []; snapshotDocs = []; });

test('a card is written with kind, its id and exactly the approved question; the caller\'s own text is ignored', async () => {
  const res = await sendCloudMessage('conv', 'some words I made up', undefined, false, card.id);
  assert.equal(res.success, true);
  assert.deepEqual(sent, [{ senderId: 'me', text: card.question, timestamp: 'SERVER_TIME', kind: 'card', cardId: card.id }]);
});

test('a card answers like any message: the reply quote travels with it', async () => {
  await sendCloudMessage('conv', '', { id: 'm0', text: 'hello', senderId: 'them' }, false, card.id);
  assert.equal(sent[0].kind, 'card');
  assert.deepEqual(sent[0].replyTo, { id: 'm0', text: 'hello', senderId: 'them' });
});

test('an unknown card id is refused before anything is written', async () => {
  for (const bad of ['nope', '', 'SOFT-01', 'soft-99']) {
    const res = await sendCloudMessage('conv', 'x', undefined, false, bad);
    assert.equal(res.success, false, bad);
  }
  assert.equal(sent.length, 0);
});

test('with rules published before cards, the card still arrives as its question in plain text, with the reply kept', async () => {
  denyFields = ['kind', 'cardId'];
  const res = await sendCloudMessage('conv', '', { id: 'm0', text: 'hello', senderId: 'them' }, false, card.id);
  assert.equal(res.success, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, card.question);
  assert.equal('kind' in sent[0], false);
  assert.deepEqual(sent[0].replyTo, { id: 'm0', text: 'hello', senderId: 'them' });
});

test('with rules from before replies as well, it is still delivered as plain text', async () => {
  denyFields = ['kind', 'cardId', 'replyTo'];
  const res = await sendCloudMessage('conv', '', { id: 'm0', text: 'hello', senderId: 'them' }, false, card.id);
  assert.equal(res.success, true);
  assert.deepEqual(Object.keys(sent[0]).sort(), ['senderId', 'text', 'timestamp']);
});

test('ordinary messages are written exactly as before, and still filtered', async () => {
  assert.equal((await sendCloudMessage('conv', '  hi there ')).success, true);
  assert.deepEqual(sent[0], { senderId: 'me', text: 'hi there', timestamp: 'SERVER_TIME' });
  assert.equal((await sendCloudMessage('conv', '   ')).success, false, 'an empty message is still refused');
  assert.equal(sent.length, 1);
});

const stored = (id: string, data: Record<string, unknown>) => ({ id, data: () => ({ senderId: 'them', timestamp: { toMillis: () => 5 }, ...data }) });

test('a stored card is read back with the approved words and its category, whatever text was stored', () => {
  snapshotDocs = [stored('a', { text: 'FORGED', kind: 'card', cardId: 'love-01' }), stored('b', { text: 'plain old message' })];
  let got: Array<Record<string, unknown>> = [];
  subscribeToCloudMessages('conv', (msgs) => { got = msgs as never; });
  assert.equal(got[0].text, cardById('love-01')!.question);
  assert.deepEqual(got[0].card, { id: 'love-01', category: 'love' });
  assert.equal(got[1].text, 'plain old message');
  assert.equal(got[1].card, undefined);
});

test('a stored card with an id that is not on the list shows as plain text', () => {
  snapshotDocs = [stored('a', { text: 'whatever was stored', kind: 'card', cardId: 'gone-99' }), stored('b', { text: 'kind without id', kind: 'card' })];
  let got: Array<Record<string, unknown>> = [];
  subscribeToCloudMessages('conv', (msgs) => { got = msgs as never; });
  assert.equal(got[0].card, undefined);
  assert.equal(got[0].text, 'whatever was stored');
  assert.equal(got[1].card, undefined);
});

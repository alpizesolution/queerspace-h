// Stardust against the real Auth and Firestore emulators, for BOTH post types: giving, removing, the unified author total,
// and every refusal. The server decides; nothing here trusts a client field.
import test from 'node:test';
import assert from 'node:assert/strict';

const enabled = process.env.SIGNALS_INTEGRATION_TESTS === 'true';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ||= 'demo-queerspace-test';
const skip = !enabled ? 'Set SIGNALS_INTEGRATION_TESTS=true to run against Firebase emulators.' : false;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;
const YEAR = 365.25 * 24 * 60 * 60 * 1000;
const TYPES = ['community', 'lookingFor'];

async function newUser() {
  const r = await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  const d = await r.json();
  return { uid: d.localId, token: d.idToken };
}

async function setup() {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const { default: handler } = await import('../../api/stardust.js');
  const stardust = await import('../../api/_stardust.js');
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const db = getFirestore(getAdminApp());
  const adult = () => Timestamp.fromMillis(Date.now() - 30 * YEAR);
  const member = async ({ settings = {}, profile = {}, minor = false } = {}) => {
    const user = await newUser();
    await db.doc(`users/${user.uid}/private/settings`).set({ birthDate: minor ? Timestamp.fromMillis(Date.now() - 15 * YEAR) : adult(), ...settings });
    await db.doc(`users/${user.uid}/public/profile`).set({ displayName: `M${user.uid.slice(0, 4)}`, pronouns: 'she/her', profileComplete: true, ...profile });
    return user;
  };
  const call = async (user, body, { method = 'POST', headers } = {}) => {
    const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(x) { this.body = x; return this; }, setHeader() {} };
    await handler({ method, headers: headers ?? (user ? { authorization: `Bearer ${user.token}` } : {}), body }, res);
    return res;
  };
  const author = await member();
  let n = 0;
  /** A fresh post of the given type by `by` (default: the shared author). Looking For ids are derived from member + intention. */
  const makePost = async (type, by = author) => {
    n += 1;
    if (type === 'community') {
      const ref = db.collection('community_posts').doc(`communitypost${n}`);
      await ref.set({ authorId: by.uid, authorName: 'W', authorPronouns: 'she/her', title: 't', content: 'c', category: 'general', tags: [], likes: 0, replyCount: 0, timestamp: Timestamp.now() });
      return { type, id: ref.id, ref };
    }
    const intentions = ['dating', 'friendship', 'talk', 'gaming', 'open'];
    const id = `${by.uid}_${intentions[n % intentions.length]}`;
    const ref = db.doc(`looking_for_posts/${id}`);
    // The id is derived, so a test starts from a clean slate: no reactions left from an earlier post with the same id.
    await Promise.all((await ref.collection('stardust').get()).docs.map((d) => d.ref.delete()));
    await ref.set({ authorId: by.uid, intention: 'friendship', title: 't', intro: 'i', lookingFor: 'l', tags: [], isNsfw: false, contentWarning: null, timestamp: Timestamp.now() });
    return { type, id, ref };
  };
  const give = (user, post) => call(user, { action: 'give', postType: post.type, postId: post.id });
  const remove = (user, post) => call(user, { action: 'remove', postType: post.type, postId: post.id });
  const countOf = async (post) => (await post.ref.get()).data()?.stardustCount;
  const totalOf = async (user = author) => (await db.doc(`stardust_totals/${user.uid}`).get()).data()?.total;
  const reactions = async (post) => (await post.ref.collection('stardust').get()).docs;
  const clearLimits = (user) => db.doc(`apiRateLimits/${user.uid}_stardust`).delete();
  return { db, Timestamp, member, call, author, makePost, give, remove, countOf, totalOf, reactions, clearLimits, stardust, handler };
}

test('Stardust API', { skip }, async (t) => {
  const s = await setup();

  for (const type of TYPES) {
    await t.test(`${type}: giving Stardust adds one to the post and to the author's total`, async () => {
      const post = await s.makePost(type);
      const fan = await s.member();
      const before = (await s.totalOf()) ?? 0;
      const res = await s.give(fan, post);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, { given: true, count: 1, changed: true });
      assert.equal(await s.countOf(post), 1);
      assert.equal(await s.totalOf(), before + 1);
      const docs = await s.reactions(post);
      assert.equal(docs.length, 1);
      assert.equal(docs[0].id, fan.uid);
      const data = docs[0].data();
      assert.equal(data.uid, fan.uid);
      assert.equal(data.postType, type);
      assert.equal(data.authorId, s.author.uid);
      assert.ok(data.createdAt);
    });

    await t.test(`${type}: removing takes exactly one point back and deletes the reaction`, async () => {
      const post = await s.makePost(type);
      const fan = await s.member();
      await s.give(fan, post);
      const mid = await s.totalOf();
      const res = await s.remove(fan, post);
      assert.deepEqual(res.body, { given: false, count: 0, changed: true });
      assert.equal(await s.countOf(post), 0);
      assert.equal(await s.totalOf(), mid - 1);
      assert.equal((await s.reactions(post)).length, 0);
    });

    await t.test(`${type}: giving twice, or removing twice, never changes a count a second time`, async () => {
      const post = await s.makePost(type);
      const fan = await s.member();
      const start = (await s.totalOf()) ?? 0;
      assert.equal((await s.give(fan, post)).body.changed, true);
      const again = await s.give(fan, post);
      assert.equal(again.statusCode, 200);
      assert.deepEqual(again.body, { given: true, count: 1, changed: false });
      assert.equal(await s.countOf(post), 1);
      assert.equal(await s.totalOf(), start + 1);
      await s.remove(fan, post);
      const gone = await s.remove(fan, post);
      assert.deepEqual(gone.body, { given: false, count: 0, changed: false });
      assert.equal(await s.totalOf(), start);
    });

    await t.test(`${type}: rapid repeated requests from one member award exactly one point`, async () => {
      const post = await s.makePost(type);
      const fan = await s.member();
      const start = (await s.totalOf()) ?? 0;
      const results = await Promise.all(Array.from({ length: 8 }, () => s.give(fan, post)));
      assert.ok(results.every((r) => r.statusCode === 200), JSON.stringify(results.map((r) => r.body)));
      assert.equal(results.filter((r) => r.body.changed).length, 1);
      assert.equal(await s.countOf(post), 1);
      assert.equal((await s.reactions(post)).length, 1);
      assert.equal(await s.totalOf(), start + 1);
    });

    await t.test(`${type}: concurrent gives and removes from several members end with matching counts`, async () => {
      const post = await s.makePost(type);
      const fans = await Promise.all(Array.from({ length: 6 }, () => s.member()));
      const start = (await s.totalOf()) ?? 0;
      const gave = await Promise.all(fans.map((f) => s.give(f, post)));
      assert.ok(gave.every((r) => r.statusCode === 200), JSON.stringify(gave.map((r) => r.body)));
      assert.equal(await s.countOf(post), 6);
      assert.equal((await s.reactions(post)).length, 6);
      assert.equal(await s.totalOf(), start + 6);
      const mixed = await Promise.all([...fans.slice(0, 3).map((f) => s.remove(f, post)), ...fans.slice(0, 3).map((f) => s.give(f, post))]);
      assert.ok(mixed.every((r) => r.statusCode === 200), JSON.stringify(mixed.map((r) => r.body)));
      const docs = (await s.reactions(post)).length;
      assert.equal(await s.countOf(post), docs, 'the count always equals the real reaction documents');
      assert.equal(await s.totalOf(), start + docs);
    });

    await t.test(`${type}: members cannot give Stardust to their own post`, async () => {
      const mine = await s.member();
      const post = await s.makePost(type, mine);
      const res = await s.give(mine, post);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.error, 'own_post');
      assert.equal((await s.reactions(post)).length, 0);
      assert.equal(await s.countOf(post), undefined);
      assert.equal(await s.totalOf(mine), undefined);
      assert.equal((await s.remove(mine, post)).statusCode, 403);
    });

    await t.test(`${type}: signed-out and invalid-token requests are refused and write nothing`, async () => {
      const post = await s.makePost(type);
      const body = { action: 'give', postType: type, postId: post.id };
      assert.equal((await s.call(null, body)).statusCode, 401);
      assert.equal((await s.call(null, body, { headers: { authorization: 'Bearer not-a-real-token' } })).statusCode, 401);
      assert.equal((await s.call(null, body, { headers: { authorization: 'Basic abc' } })).statusCode, 401);
      assert.equal((await s.reactions(post)).length, 0);
    });

    await t.test(`${type}: a suspended account cannot give Stardust, and a suspended author's post is unavailable`, async () => {
      const post = await s.makePost(type);
      const suspended = await s.member();
      await s.db.doc(`suspensions/${suspended.uid}`).set({ reason: 'test' });
      const res = await s.give(suspended, post);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.error, 'account_unavailable');
      const badAuthor = await s.member();
      await s.db.doc(`suspensions/${badAuthor.uid}`).set({ reason: 'test' });
      const theirs = await s.makePost(type, badAuthor);
      const fan = await s.member();
      const second = await s.give(fan, theirs);
      assert.equal(second.statusCode, 404);
      assert.equal((await s.reactions(post)).length + (await s.reactions(theirs)).length, 0);
    });

    await t.test(`${type}: a block in either direction stops Stardust, and the answer does not say who blocked`, async () => {
      const post = await s.makePost(type);
      const blocker = await s.member({ settings: { blockedPartnerIds: [s.author.uid] } });
      const first = await s.give(blocker, post);
      assert.equal(first.statusCode, 404);
      assert.equal(first.body.error, 'post_unavailable');
      const blockedByAuthor = await s.member();
      const blockingAuthor = await s.member({ settings: { blockedPartnerIds: [blockedByAuthor.uid] } });
      const theirs = await s.makePost(type, blockingAuthor);
      const second = await s.give(blockedByAuthor, theirs);
      assert.equal(second.statusCode, 404);
      assert.equal(second.body.error, 'post_unavailable');
      assert.equal((await s.reactions(post)).length + (await s.reactions(theirs)).length, 0);
    });

    await t.test(`${type}: a member who blocks the author afterwards can still take their Stardust back`, async () => {
      const post = await s.makePost(type);
      const fan = await s.member();
      await s.give(fan, post);
      await s.db.doc(`users/${fan.uid}/private/settings`).update({ blockedPartnerIds: [s.author.uid] });
      const res = await s.remove(fan, post);
      assert.equal(res.statusCode, 200);
      assert.equal(await s.countOf(post), 0);
    });

    await t.test(`${type}: members who are not adults with a saved profile cannot give Stardust`, async () => {
      const post = await s.makePost(type);
      const minor = await s.member({ minor: true });
      const draft = await s.member({ profile: { profileComplete: false } });
      for (const who of [minor, draft]) {
        const res = await s.give(who, post);
        assert.equal(res.statusCode, 403);
        assert.equal(res.body.error, 'not_allowed');
      }
      assert.equal((await s.reactions(post)).length, 0);
    });

    await t.test(`${type}: a deleted or unknown post cannot receive Stardust, and nothing is created`, async () => {
      const post = await s.makePost(type);
      const fan = await s.member();
      await post.ref.delete();
      const res = await s.give(fan, post);
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.error, 'post_unavailable');
      assert.equal((await s.reactions(post)).length, 0);
      assert.equal((await s.remove(fan, post)).statusCode, 404);
      const unknown = await s.call(fan, { action: 'give', postType: type, postId: 'doesnotexist123' });
      assert.equal(unknown.statusCode, 404);
    });

    await t.test(`${type}: counts and totals cannot go below zero, even from a damaged state`, async () => {
      const post = await s.makePost(type);
      const fan = await s.member();
      // A reaction exists but the counters were left at zero (for instance a manual edit).
      await post.ref.update({ stardustCount: 0 });
      await post.ref.collection('stardust').doc(fan.uid).set({ uid: fan.uid, postType: type, authorId: s.author.uid, createdAt: s.Timestamp.now() });
      await s.db.doc(`stardust_totals/${s.author.uid}`).set({ total: 0 });
      const res = await s.remove(fan, post);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.count, 0);
      assert.equal(await s.countOf(post), 0);
      assert.equal(await s.totalOf(), 0);
      const noField = await s.makePost(type);
      assert.equal((await s.remove(fan, noField)).body.count, 0);
    });

    await t.test(`${type}: if the transaction fails part-way nothing is written (rollback)`, async () => {
      const post = await s.makePost(type);
      const fan = await s.member();
      const start = (await s.totalOf()) ?? 0;
      const failing = new Proxy(s.db, {
        get(target, prop) {
          if (prop === 'runTransaction') {
            return (fn, options) => target.runTransaction((tx) => fn(new Proxy(tx, {
              get(inner, name) {
                if (name === 'set') return (ref, ...rest) => { if (ref.path.startsWith('stardust_totals/')) throw new Error('simulated failure'); return inner.set(ref, ...rest); };
                const value = inner[name];
                return typeof value === 'function' ? value.bind(inner) : value;
              },
            })), options);
          }
          const value = target[prop];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      await assert.rejects(() => s.stardust.setStardust(failing, fan.uid, { postType: type, postId: post.id, give: true }), /simulated failure/);
      assert.equal((await s.reactions(post)).length, 0, 'no reaction');
      assert.equal(await s.countOf(post), undefined, 'no post count');
      assert.equal((await s.totalOf()) ?? 0, start, 'no author total');
      assert.equal((await s.give(fan, post)).statusCode, 200, 'and the member can still give afterwards');
    });
  }

  await t.test('one unified total counts Community and Looking For together', async () => {
    const writer = await s.member();
    const community = await s.makePost('community', writer);
    const lookingFor = await s.makePost('lookingFor', writer);
    const [a, b] = await Promise.all([s.member(), s.member()]);
    assert.equal((await s.give(a, community)).statusCode, 200);
    assert.equal((await s.give(a, lookingFor)).statusCode, 200); // the same member, a different post: an independent act
    assert.equal((await s.give(b, lookingFor)).statusCode, 200);
    assert.equal(await s.totalOf(writer), 3);
    assert.equal(await s.countOf(community), 1);
    assert.equal(await s.countOf(lookingFor), 2);
    await s.remove(a, community);
    assert.equal(await s.totalOf(writer), 2);
    await s.remove(b, lookingFor);
    assert.equal(await s.totalOf(writer), 1);
    const totalDocs = await s.db.collection('stardust_totals').where('total', '>=', 0).get();
    assert.equal(totalDocs.docs.filter((d) => d.id === writer.uid).length, 1, 'one document per author');
  });

  await t.test('the viewer state is one batched read and lists only their own reactions', async () => {
    const posts = [await s.makePost('community'), await s.makePost('community'), await s.makePost('community')];
    const fan = await s.member();
    const other = await s.member();
    await s.give(fan, posts[0]);
    await s.give(fan, posts[2]);
    await s.give(other, posts[1]);
    const res = await s.call(fan, { action: 'state', postType: 'community', postIds: posts.map((p) => p.id) });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.given.sort(), [posts[0].id, posts[2].id].sort());
    assert.deepEqual((await s.call(fan, { action: 'state', postType: 'community', postIds: [] })).body, { given: [] });
    assert.equal((await s.call(fan, { action: 'state', postType: 'community', postIds: Array.from({ length: 61 }, (_, i) => `postid${String(i).padStart(4, '0')}`) })).statusCode, 400);
    assert.equal((await s.call(null, { action: 'state', postType: 'community', postIds: [] })).statusCode, 401);
  });

  await t.test('a Looking For post written again does not inherit the old post\'s Stardust, in the count or the viewer state', async () => {
    const writer = await s.member();
    const id = `${writer.uid}_dating`;
    const ref = s.db.doc(`looking_for_posts/${id}`);
    const base = { authorId: writer.uid, intention: 'dating', title: 't', intro: 'i', lookingFor: 'l', tags: [], isNsfw: false, contentWarning: null };
    await ref.set({ ...base, timestamp: s.Timestamp.fromMillis(Date.now() - 60_000) });
    const post = { type: 'lookingFor', id, ref };
    const fan = await s.member();
    await s.give(fan, post);
    await ref.delete(); // the member deletes it, then posts again: same id, new post
    await ref.set({ ...base, timestamp: s.Timestamp.now() });
    const state = await s.call(fan, { action: 'state', postType: 'lookingFor', postIds: [id] });
    assert.deepEqual(state.body.given, [], 'the old reaction is not shown as given');
    const res = await s.give(fan, post);
    assert.deepEqual(res.body, { given: true, count: 1, changed: true }, 'giving again counts, and starts from 0');
    assert.equal((await s.reactions(post)).length, 1);
  });

  await t.test('the per-member rate limit stops scripted toggling', async () => {
    const post = await s.makePost('community');
    const fan = await s.member();
    let limited = null;
    for (let i = 0; i < 32 && !limited; i++) {
      const res = i % 2 === 0 ? await s.give(fan, post) : await s.remove(fan, post);
      if (res.statusCode === 429) limited = res;
    }
    assert.ok(limited, 'a 429 appeared within 32 quick actions');
    assert.equal(limited.body.error, 'rate_limited');
    const count = await s.countOf(post);
    assert.ok(count === 0 || count === 1);
    assert.equal(count, (await s.reactions(post)).length);
  });

  await t.test('bad input and wrong methods are refused', async () => {
    const fan = await s.member();
    const post = await s.makePost('community');
    assert.equal((await s.call(fan, { action: 'give', postType: 'unsaid', postId: post.id })).statusCode, 400);
    assert.equal((await s.call(fan, { action: 'give', postType: '__proto__', postId: post.id })).statusCode, 400);
    assert.equal((await s.call(fan, { action: 'give', postType: 'community', postId: '../x' })).statusCode, 400);
    assert.equal((await s.call(fan, { action: 'give', postType: 'community', postId: 'a/b/c/d/e/f/g' })).statusCode, 400);
    assert.equal((await s.call(fan, { action: 'give', postType: 'community' })).statusCode, 400);
    assert.equal((await s.call(fan, { action: 'like', postType: 'community', postId: post.id })).statusCode, 400);
    assert.equal((await s.call(fan, { action: 'give', postType: 'community', postId: post.id, count: 999, total: 999 })).body.count, 1, 'client-sent numbers are ignored');
    assert.equal((await s.call(fan, undefined, { method: 'GET' })).statusCode, 405);
    assert.equal((await s.reactions(post)).length, 1);
  });
});

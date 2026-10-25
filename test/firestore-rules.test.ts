import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import fs from 'node:fs';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

let testEnv: RulesTestEnvironment;

before(async () => {
  try {
    const rulesContent = fs.readFileSync('./firestore.rules', 'utf8');

    testEnv = await initializeTestEnvironment({
      projectId: 'demo-queerspace-test',
      firestore: {
        rules: rulesContent,
        host: '127.0.0.1',
        port: 8080,
      },
    });
  } catch (err: any) {
    console.error('ERROR INITIALIZING TEST ENV:', err?.stack || err?.message || err);
    throw err;
  }
});

after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

beforeEach(async () => {
  if (testEnv) {
    await testEnv.clearFirestore();
  }
});

// ------------------------------------------------------------------
// 1. Private Settings & Profile Privacy Tests
// ------------------------------------------------------------------
test('T-01: Profile Owner CAN write valid private settings', async () => {
  const alice = testEnv.authenticatedContext('alice');
  await assertSucceeds(
    alice.firestore().doc('users/alice/private/settings').set({
      exactLocation: 'Quezon City, Manila',
      sexualOrientation: 'Lesbian',
      genderExpression: ['Femme'],
      preferredGenderExpressions: ['Femme', 'Androgynous'],
      blockedPartnerIds: ['userX'],
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  );
});

test('T-02: Non-owner CANNOT read another user private settings', async () => {
  const bob = testEnv.authenticatedContext('bob');
  await assertFails(bob.firestore().doc('users/alice/private/settings').get());
});

test('T-03: User CANNOT assign role or isAdmin privilege', async () => {
  const alice = testEnv.authenticatedContext('alice');
  await assertFails(
    alice.firestore().doc('users/alice/private/settings').set({
      role: 'admin',
      isAdmin: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  );
});

// ------------------------------------------------------------------
// 2. Public Profile Access & Validation
// ------------------------------------------------------------------
test('T-04: Authenticated users CAN read public profiles', async () => {
  const bob = testEnv.authenticatedContext('bob');
  await assertSucceeds(bob.firestore().doc('users/alice/public/profile').get());
});

test('T-05: Public profile fails if displayName is over 30 chars', async () => {
  const alice = testEnv.authenticatedContext('alice');
  await assertFails(
    alice.firestore().doc('users/alice/public/profile').set({
      displayName: 'A'.repeat(35),
      pronouns: 'she/her',
      intention: 'open',
      region: 'Worldwide',
      topics: ['Books'],
      updatedAt: new Date(),
    })
  );
});

// ------------------------------------------------------------------
// 3. Conversation & Ephemeral Chat Security
// ------------------------------------------------------------------
test('T-06: Conversation creation fails if participants are duplicate self', async () => {
  const alice = testEnv.authenticatedContext('alice');
  await assertFails(
    alice.firestore().doc('conversations/conv1').set({
      participants: ['alice', 'alice'],
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'active',
    })
  );
});

test('T-07: Non-participant CANNOT read conversation messages', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc('conversations/conv1').set({
      participants: ['alice', 'bob'],
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'active',
    });
  });

  const charlie = testEnv.authenticatedContext('charlie');
  await assertFails(charlie.firestore().doc('conversations/conv1/messages/msg1').get());
});

test('T-08: Ended conversation status CANNOT be set back to active', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc('conversations/conv_ended').set({
      participants: ['alice', 'bob'],
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'ended',
    });
  });

  const alice = testEnv.authenticatedContext('alice');
  await assertFails(
    alice.firestore().doc('conversations/conv_ended').update({
      status: 'active',
      updatedAt: new Date(),
    })
  );
});

test('T-13: Sender CANNOT spoof senderId in messages', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc('conversations/conv_spoof').set({
      participants: ['alice', 'bob'],
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'active',
    });
  });

  const alice = testEnv.authenticatedContext('alice');
  // Alice attempts to forge senderId as 'bob'
  await assertFails(
    alice.firestore().doc('conversations/conv_spoof/messages/m1').set({
      senderId: 'bob',
      text: 'Forged message from Bob',
      timestamp: new Date(),
    })
  );
});

test('T-14: Valid participant CAN send message to active conversation', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc('conversations/conv_valid').set({
      participants: ['alice', 'bob'],
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'active',
    });
  });

  const alice = testEnv.authenticatedContext('alice');
  await assertSucceeds(
    alice.firestore().doc('conversations/conv_valid/messages/m2').set({
      senderId: 'alice',
      text: 'Hello Bob! So glad we matched.',
      timestamp: new Date(),
    })
  );
});

test('T-15: Message creation FAILS if text exceeds 1000 characters', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc('conversations/conv_long').set({
      participants: ['alice', 'bob'],
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'active',
    });
  });

  const alice = testEnv.authenticatedContext('alice');
  await assertFails(
    alice.firestore().doc('conversations/conv_long/messages/m3').set({
      senderId: 'alice',
      text: 'X'.repeat(1005),
      timestamp: new Date(),
    })
  );
});

test('T-17: Replies quote a short snippet; padded or oversized quotes are rejected', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc('conversations/conv_reply').set({
      participants: ['alice', 'bob'],
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'active',
    });
  });

  const alice = testEnv.authenticatedContext('alice').firestore();
  const reply = (replyTo: unknown) => ({ senderId: 'alice', text: 'Same!', timestamp: new Date(), replyTo });
  await assertSucceeds(
    alice.doc('conversations/conv_reply/messages/r1').set(reply({ id: 'm1', text: 'I love cats', senderId: 'bob' }))
  );
  await assertFails(
    alice.doc('conversations/conv_reply/messages/r2').set(reply({ id: 'm1', text: 'x'.repeat(141), senderId: 'bob' }))
  );
  await assertFails(
    alice.doc('conversations/conv_reply/messages/r3').set(reply({ id: 'm1', text: 'hi', senderId: 'bob', extra: true }))
  );
  await assertFails(alice.doc('conversations/conv_reply/messages/r4').set(reply('m1')));
});

test('T-16: Conversation creation FAILS if caller is not listed in participants', async () => {
  const alice = testEnv.authenticatedContext('alice');
  // Alice tries to create a conversation between Bob and Charlie
  await assertFails(
    alice.firestore().doc('conversations/conv_unauth').set({
      participants: ['bob', 'charlie'],
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'active',
    })
  );
});

// ------------------------------------------------------------------
// 4. Community Posts & Per-User Like Locks
// ------------------------------------------------------------------
test('T-09: User CANNOT forge a post like on behalf of another user', async () => {
  const alice = testEnv.authenticatedContext('alice');
  await assertFails(
    alice.firestore().doc('community_posts/post1/likes/bob').set({
      createdAt: new Date(),
    })
  );
});

test('T-10: Like document creation fails if extra arbitrary fields are passed', async () => {
  const alice = testEnv.authenticatedContext('alice');
  await assertFails(
    alice.firestore().doc('community_posts/post1/likes/alice').set({
      createdAt: new Date(),
      extraHackField: 'malicious',
    })
  );
});

test('T-11: User CAN like a post for themselves (marker + counter in one batch)', async () => {
  await seedCommunityPost('post1', 'bob');
  await assertSucceeds(likeAs('alice', 'post1', 1));
});

// ------------------------------------------------------------------
// 5. Abuse Reports Protection
// ------------------------------------------------------------------
test('T-12: Clients CANNOT read or scrape report documents', async () => {
  const alice = testEnv.authenticatedContext('alice');
  await assertFails(alice.firestore().doc('reports/rep1').get());
});

// ------------------------------------------------------------------
// 6. Live Matchmaking Queue
// ------------------------------------------------------------------
const waitingEntry = () => ({
  status: 'waiting',
  partnerId: null,
  convId: null,
  createdAt: new Date(),
  heartbeatAt: new Date(),
  updatedAt: new Date(),
});

test('Q-01: User CAN join the queue as themselves, but not as someone else', async () => {
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertSucceeds(alice.doc('match_queue/alice').set(waitingEntry()));
  await assertFails(alice.doc('match_queue/bob').set(waitingEntry()));
  await assertFails(testEnv.unauthenticatedContext().firestore().doc('match_queue/anon').set(waitingEntry()));
});

test('Q-02: Authenticated users CAN list waiting entries; signed-out users cannot', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('match_queue/bob').set(waitingEntry());
  });
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertSucceeds(alice.collection('match_queue').where('status', '==', 'waiting').limit(25).get());
  await assertFails(testEnv.unauthenticatedContext().firestore().collection('match_queue').where('status', '==', 'waiting').get());
});

test('Q-03: Searcher CAN claim a waiting user together with a new shared conversation', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('match_queue/alice').set(waitingEntry());
    await ctx.firestore().doc('match_queue/bob').set(waitingEntry());
  });
  const alice = testEnv.authenticatedContext('alice').firestore();
  const convRef = alice.collection('conversations').doc();
  await assertSucceeds(
    alice.runTransaction(async (tx) => {
      await tx.get(alice.doc('match_queue/bob'));
      tx.set(convRef, { participants: ['alice', 'bob'], status: 'active', createdAt: new Date(), updatedAt: new Date() });
      tx.update(alice.doc('match_queue/bob'), { status: 'matched', partnerId: 'alice', convId: convRef.id, updatedAt: new Date() });
      tx.update(alice.doc('match_queue/alice'), { status: 'matched', partnerId: 'bob', convId: convRef.id, updatedAt: new Date() });
    })
  );
  // Bob can read his matched entry; an outsider cannot.
  await assertSucceeds(testEnv.authenticatedContext('bob').firestore().doc('match_queue/bob').get());
  await assertFails(testEnv.authenticatedContext('carol').firestore().doc('match_queue/bob').get());
});

test('Q-04: Searcher CANNOT claim a waiting user without a conversation that includes both', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('match_queue/bob').set(waitingEntry());
    await ctx.firestore().doc('conversations/other').set({ participants: ['carol', 'dana'], status: 'active', createdAt: new Date(), updatedAt: new Date() });
  });
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertFails(
    alice.doc('match_queue/bob').update({ status: 'matched', partnerId: 'alice', convId: 'other', updatedAt: new Date() })
  );
  await assertFails(
    alice.doc('match_queue/bob').update({ status: 'matched', partnerId: 'carol', convId: 'other', updatedAt: new Date() })
  );
});

test('Q-05: Nobody else CAN re-claim or delete an already matched entry', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('conversations/c1').set({ participants: ['alice', 'bob'], status: 'active', createdAt: new Date(), updatedAt: new Date() });
    await ctx.firestore().doc('match_queue/bob').set({ ...waitingEntry(), status: 'matched', partnerId: 'alice', convId: 'c1' });
  });
  const carol = testEnv.authenticatedContext('carol').firestore();
  await assertFails(carol.doc('match_queue/bob').update({ partnerId: 'carol', updatedAt: new Date() }));
  await assertFails(carol.doc('match_queue/bob').delete());
  await assertSucceeds(testEnv.authenticatedContext('bob').firestore().doc('match_queue/bob').delete());
});

// ------------------------------------------------------------------
// Slow mode: posts are written together with a rate_limits stamp
// ------------------------------------------------------------------
const now = () => firebase.firestore.FieldValue.serverTimestamp();

function stampedAdd(uid: string, collectionPath: string, data: Record<string, unknown>, field: string) {
  const fs = testEnv.authenticatedContext(uid).firestore();
  const batch = fs.batch();
  batch.set(fs.collection(collectionPath).doc(), data);
  batch.set(fs.doc(`rate_limits/${uid}`), { [field]: now() }, { merge: true });
  return batch.commit();
}

async function seedStamp(uid: string, field: string, secondsAgo: number) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`rate_limits/${uid}`).set({ [field]: new Date(Date.now() - secondsAgo * 1000) });
  });
}

// ------------------------------------------------------------------
// Suggestions
// ------------------------------------------------------------------
const suggestion = (authorId: string, overrides: Record<string, unknown> = {}) => ({
  authorId,
  category: 'idea',
  text: 'Add voice notes to chat',
  createdAt: now(),
  ...overrides,
});

test('S-01: Signed-in user CAN send a valid suggestion as themselves', async () => {
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertSucceeds(stampedAdd('alice', 'suggestions', suggestion('alice'), 'suggestion'));
});

test('S-02: Suggestions CANNOT be spoofed, malformed or sent signed-out', async () => {
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertFails(stampedAdd('alice', 'suggestions', suggestion('bob'), 'suggestion'));
  await assertFails(stampedAdd('alice', 'suggestions', suggestion('alice', { category: 'spam' }), 'suggestion'));
  await assertFails(stampedAdd('alice', 'suggestions', suggestion('alice', { text: 'x'.repeat(1001) }), 'suggestion'));
  await assertFails(stampedAdd('alice', 'suggestions', suggestion('alice', { email: 'a@b.c' }), 'suggestion'));
  const anon = testEnv.unauthenticatedContext().firestore();
  await assertFails(anon.collection('suggestions').add({ ...suggestion('alice'), createdAt: new Date() }));
});

test('S-03: Nobody CAN read, edit or delete suggestions from the app', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('suggestions/s1').set({ ...suggestion('alice'), createdAt: new Date() });
  });
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertFails(alice.doc('suggestions/s1').get());
  await assertFails(alice.collection('suggestions').get());
  await assertFails(alice.doc('suggestions/s1').update({ text: 'changed text' }));
  await assertFails(alice.doc('suggestions/s1').delete());
});

// ------------------------------------------------------------------
// Unsaid wall
// ------------------------------------------------------------------
const HOUR = 60 * 60 * 1000;

async function postUnsaidAs(uid: string, id: string, overrides: Record<string, unknown> = {}) {
  const fs = testEnv.authenticatedContext(uid).firestore();
  const batch = fs.batch();
  batch.set(fs.doc(`unsaid/${id}`), {
    kind: 'confession',
    text: 'I never told anyone I like her',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 48 * HOUR),
    hugs: 0,
    same: 0,
    flags: 0,
    ...overrides,
  });
  batch.set(fs.doc(`unsaid_owners/${id}`), { authorId: uid });
  batch.set(fs.doc(`rate_limits/${uid}`), { unsaid: now() }, { merge: true });
  return batch.commit();
}

async function seedUnsaid(id: string, author: string, counts: Record<string, number> = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`unsaid/${id}`).set({
      kind: 'vent',
      text: 'seeded',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 48 * HOUR),
      hugs: 0,
      same: 0,
      flags: 0,
      ...counts,
    });
    await ctx.firestore().doc(`unsaid_owners/${id}`).set({ authorId: author });
  });
}

function reactAs(uid: string, id: string, type: string, bump = 1) {
  const fs = testEnv.authenticatedContext(uid).firestore();
  const batch = fs.batch();
  batch.update(fs.doc(`unsaid/${id}`), { [type]: firebase.firestore.FieldValue.increment(bump) });
  batch.set(fs.doc(`unsaid/${id}/reactions/${uid}`), {
    type,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  return batch.commit();
}

test('U-01: User CAN post anonymously with a 48h expiry and an owner record', async () => {
  await assertSucceeds(postUnsaidAs('alice', 'p1'));
  const bob = testEnv.authenticatedContext('bob').firestore();
  const snap = await assertSucceeds(bob.doc('unsaid/p1').get());
  if ('authorId' in (snap.data() ?? {})) throw new Error('post leaks its author');
});

test('U-02: Posts CANNOT be created with an author field, a long expiry, preset counts or no owner record', async () => {
  await assertFails(postUnsaidAs('alice', 'p1', { authorId: 'alice' }));
  await assertFails(postUnsaidAs('alice', 'p2', { expiresAt: new Date(Date.now() + 30 * 24 * HOUR) }));
  await assertFails(postUnsaidAs('alice', 'p3', { hugs: 50 }));
  await assertFails(postUnsaidAs('alice', 'p4', { text: 'x'.repeat(501) }));
  await assertFails(postUnsaidAs('alice', 'p6', { kind: 'rant' }));
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertFails(
    alice.doc('unsaid/p5').set({
      kind: 'vent', text: 'no owner', createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + 48 * HOUR), hugs: 0, same: 0, flags: 0,
    })
  );
});

test('U-03: Only the author CAN read the owner record or delete the post', async () => {
  await seedUnsaid('p1', 'alice');
  const bob = testEnv.authenticatedContext('bob').firestore();
  await assertFails(bob.doc('unsaid_owners/p1').get());
  await assertFails(bob.collection('unsaid_owners').where('authorId', '==', 'alice').get());
  await assertFails(bob.doc('unsaid/p1').delete());
  // Nobody can claim an existing post.
  await assertFails(bob.doc('unsaid_owners/p1').set({ authorId: 'bob' }));

  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertSucceeds(alice.collection('unsaid_owners').where('authorId', '==', 'alice').get());
  const batch = alice.batch();
  batch.delete(alice.doc('unsaid/p1'));
  batch.delete(alice.doc('unsaid_owners/p1'));
  await assertSucceeds(batch.commit());
});

test('U-04: Each person CAN react once, by exactly one', async () => {
  await seedUnsaid('p1', 'alice');
  await assertSucceeds(reactAs('bob', 'p1', 'hugs'));
  await assertFails(reactAs('bob', 'p1', 'hugs'));
  await assertFails(reactAs('bob', 'p1', 'same'));
  await assertFails(reactAs('carol', 'p1', 'same', 5));
  await assertSucceeds(reactAs('carol', 'p1', 'same'));
  // Newer reactions count up from a missing field on older posts.
  await assertSucceeds(reactAs('erin', 'p1', 'felt'));
  await assertSucceeds(reactAs('fay', 'p1', 'proud'));
  await assertSucceeds(reactAs('ivy', 'p1', 'cry'));
  await assertFails(reactAs('jo', 'p1', 'gasp'));
  await assertFails(reactAs('gail', 'p1', 'felt', 2));
  await assertFails(reactAs('hana', 'p1', 'angry'));
  // A bare counter bump without the marker doc is rejected.
  const dana = testEnv.authenticatedContext('dana').firestore();
  await assertFails(dana.doc('unsaid/p1').update({ hugs: firebase.firestore.FieldValue.increment(1) }));
  // Text can never be edited.
  await assertFails(testEnv.authenticatedContext('alice').firestore().doc('unsaid/p1').update({ text: 'edited' }));
});

test('U-05: Each person CAN flag a post once', async () => {
  await seedUnsaid('p1', 'alice');
  const flag = (uid: string) => {
    const fs = testEnv.authenticatedContext(uid).firestore();
    const batch = fs.batch();
    batch.update(fs.doc('unsaid/p1'), { flags: firebase.firestore.FieldValue.increment(1) });
    batch.set(fs.doc(`unsaid/p1/flags/${uid}`), { createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    return batch.commit();
  };
  await assertSucceeds(flag('bob'));
  await assertFails(flag('bob'));
  await assertFails(testEnv.authenticatedContext('carol').firestore().doc('unsaid/p1/flags/bob').get());
});

// ------------------------------------------------------------------
// Avatars
// ------------------------------------------------------------------
const profile = (overrides: Record<string, unknown> = {}) => ({
  displayName: 'Willow',
  pronouns: 'she/her',
  intention: 'open',
  region: 'Worldwide',
  topics: ['Books'],
  updatedAt: new Date(),
  ...overrides,
});

test('A-01: Users CAN save a short avatar code on their public profile, not a long or non-string one', async () => {
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertSucceeds(alice.doc('users/alice/public/profile').set(profile({ avatar: 'cat.1.2' })));
  await assertSucceeds(alice.doc('users/alice/public/profile').set(profile()));
  await assertFails(alice.doc('users/alice/public/profile').set(profile({ avatar: 'x'.repeat(200) })));
  await assertFails(alice.doc('users/alice/public/profile').set(profile({ avatar: 42 })));
});

// ------------------------------------------------------------------
// Public room
// ------------------------------------------------------------------
const roomMessage = (authorId: string, overrides: Record<string, unknown> = {}) => ({
  authorId,
  authorName: 'Willow',
  authorPronouns: 'she/her',
  text: 'hi everyone',
  timestamp: now(),
  ...overrides,
});

test('R-01: Users CAN post to the public room as themselves, with or without an avatar', async () => {
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertSucceeds(stampedAdd('alice', 'public_room_messages', roomMessage('alice'), 'publicRoom'));
  await assertSucceeds(stampedAdd('bob', 'public_room_messages', roomMessage('bob', { authorAvatar: 'fox.1.2' }), 'publicRoom'));
  await assertSucceeds(testEnv.authenticatedContext('bob').firestore().collection('public_room_messages').get());
});

test('R-02: Public room messages CANNOT be spoofed, padded or edited', async () => {
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertFails(stampedAdd('alice', 'public_room_messages', roomMessage('bob'), 'publicRoom'));
  await assertFails(stampedAdd('alice', 'public_room_messages', roomMessage('alice', { authorAvatar: 'x'.repeat(100) }), 'publicRoom'));
  await assertFails(stampedAdd('alice', 'public_room_messages', roomMessage('alice', { isAdmin: true }), 'publicRoom'));
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('public_room_messages/m1').set({ ...roomMessage('alice'), timestamp: new Date() });
  });
  await assertFails(alice.doc('public_room_messages/m1').update({ text: 'edited' }));
  await assertFails(testEnv.unauthenticatedContext().firestore().collection('public_room_messages').get());
});

test('L-01: Slow mode blocks rapid repeat posts and unstamped posts', async () => {
  const alice = testEnv.authenticatedContext('alice').firestore();
  // No stamp in the batch: rejected.
  await assertFails(alice.collection('public_room_messages').add(roomMessage('alice')));
  // First stamped post OK, an immediate second one is too fast.
  await assertSucceeds(stampedAdd('alice', 'public_room_messages', roomMessage('alice'), 'publicRoom'));
  await assertFails(stampedAdd('alice', 'public_room_messages', roomMessage('alice'), 'publicRoom'));
  // Once the window has passed, posting works again.
  await seedStamp('alice', 'publicRoom', 10);
  await assertSucceeds(stampedAdd('alice', 'public_room_messages', roomMessage('alice'), 'publicRoom'));
});

test('L-02: Unsaid allows one post a minute and suggestions one per 30 seconds', async () => {
  await assertSucceeds(postUnsaidAs('alice', 'u1'));
  await assertFails(postUnsaidAs('alice', 'u2'));
  await seedStamp('alice', 'unsaid', 61);
  await assertSucceeds(postUnsaidAs('alice', 'u3'));

  await assertSucceeds(stampedAdd('bob', 'suggestions', suggestion('bob'), 'suggestion'));
  await assertFails(stampedAdd('bob', 'suggestions', suggestion('bob'), 'suggestion'));
});

test('L-03: Users CANNOT backdate or erase their own slow-mode stamps', async () => {
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertFails(alice.doc('rate_limits/alice').set({ publicRoom: new Date(0) }));
  await assertFails(alice.doc('rate_limits/alice').set({ other: now() }));
  await assertFails(testEnv.authenticatedContext('bob').firestore().doc('rate_limits/alice').set({ publicRoom: now() }));
  await seedStamp('alice', 'publicRoom', 1);
  await assertFails(alice.doc('rate_limits/alice').delete());
  await assertFails(alice.doc('rate_limits/alice').update({ publicRoom: new Date(0) }));
});

// ------------------------------------------------------------------
// Admin page
// ------------------------------------------------------------------
const google = { firebase: { sign_in_provider: 'google.com' } } as any;
const adminDb = () => testEnv.authenticatedContext('cha', google).firestore();

async function seedAdmin(uid = 'cha') {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`admins/${uid}`).set({ note: 'owner' });
  });
}

async function seedInbox() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await fs.doc('suggestions/s1').set({ ...suggestion('alice'), createdAt: new Date() });
    await fs.doc('reports/r1').set({
      reporterId: 'alice', targetId: 'bob', targetType: 'user', reason: 'rude', timestamp: new Date(),
    });
  });
}

test('AD-01: A Google-signed-in admin CAN read the inbox and mark items done, but not rewrite them', async () => {
  await seedAdmin();
  await seedInbox();
  const cha = adminDb();
  await assertSucceeds(cha.collection('suggestions').get());
  await assertSucceeds(cha.collection('reports').get());
  await assertSucceeds(cha.doc('suggestions/s1').update({ status: 'done' }));
  await assertSucceeds(cha.doc('reports/r1').update({ status: 'done' }));
  await assertFails(cha.doc('suggestions/s1').update({ text: 'rewritten' }));
  await assertFails(cha.doc('reports/r1').update({ status: 'banned' }));
  await assertSucceeds(cha.doc('suggestions/s1').delete());
  await assertSucceeds(cha.doc('reports/r1').delete());
});

test('AD-02: Nobody else CAN act as an admin or make themselves one', async () => {
  await seedAdmin();
  await seedInbox();
  // Right uid but an anonymous session: not an admin.
  const anonCha = testEnv.authenticatedContext('cha', { firebase: { sign_in_provider: 'anonymous' } } as any).firestore();
  await assertFails(anonCha.collection('suggestions').get());
  // Google account without an admins doc: not an admin.
  const eve = testEnv.authenticatedContext('eve', google).firestore();
  await assertFails(eve.collection('reports').get());
  await assertFails(eve.doc('admins/eve').set({ note: 'me' }));
  await assertFails(eve.doc('admins/cha').get());
  await assertSucceeds(adminDb().doc('admins/cha').get());
  await assertFails(adminDb().doc('admins/eve').set({ note: 'friend' }));
});

test('AD-03: Admins CAN moderate and count, but still CANNOT read private chats or Unsaid authors', async () => {
  await seedAdmin();
  await seedUnsaid('p1', 'alice', { flags: 3 });
  await seedUnsaid('p2', 'bob', { flags: 4 });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await fs.doc('public_room_messages/m1').set({ ...roomMessage('alice'), timestamp: new Date() });
    await fs.doc('community_posts/c1').set({
      authorId: 'alice', authorName: 'Willow', title: 't', content: 'c', category: 'general', tags: [], timestamp: new Date(),
    });
    await fs.doc('conversations/k1').set({ participants: ['alice', 'bob'], status: 'active', createdAt: new Date(), updatedAt: new Date() });
    await fs.doc('conversations/k1/messages/x').set({ senderId: 'alice', text: 'private', timestamp: new Date() });
    await fs.doc('users/alice/public/profile').set(profile({ createdAt: new Date() }));
  });
  const cha = adminDb();
  await assertSucceeds(cha.doc('public_room_messages/m1').delete());
  await assertSucceeds(cha.doc('community_posts/c1').delete());
  // Restore a wrongly hidden post (flags back to 0 only).
  await assertFails(cha.doc('unsaid/p1').update({ flags: 0, text: 'edited' }));
  await assertSucceeds(cha.doc('unsaid/p1').update({ flags: 0 }));
  // Remove a post together with its owner record.
  const batch = cha.batch();
  batch.delete(cha.doc('unsaid/p2'));
  batch.delete(cha.doc('unsaid_owners/p2'));
  await assertSucceeds(batch.commit());
  await assertFails(cha.doc('unsaid_owners/p1').get());
  await assertFails(cha.collection('unsaid_owners').get());
  // Conversations can be counted, messages stay private.
  await assertSucceeds(cha.collection('conversations').get());
  await assertFails(cha.doc('conversations/k1/messages/x').get());
  await assertSucceeds(cha.collectionGroup('public').get());
  await assertFails(testEnv.authenticatedContext('bob').firestore().collectionGroup('public').get());
  await assertFails(testEnv.authenticatedContext('bob').firestore().collection('conversations').get());
});

test('AD-04: A profile join date CAN only be set once, to now', async () => {
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertFails(alice.doc('users/alice/public/profile').set(profile({ createdAt: new Date(0) })));
  await assertSucceeds(alice.doc('users/alice/public/profile').set(profile({ createdAt: now() })));
  await assertSucceeds(alice.doc('users/alice/public/profile').set(profile({ displayName: 'Ivy' }), { merge: true }));
  await assertFails(alice.doc('users/alice/public/profile').set(profile({ createdAt: now() }), { merge: true }));
  // Profiles saved before join dates existed can get one later.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('users/bob/public/profile').set(profile());
  });
  const bob = testEnv.authenticatedContext('bob').firestore();
  await assertSucceeds(bob.doc('users/bob/public/profile').set({ createdAt: now(), updatedAt: new Date() }, { merge: true }));
});

// ------------------------------------------------------------------
// Community (shared posts, likes, replies)
// ------------------------------------------------------------------
async function seedCommunityPost(id: string, author: string, counts: Record<string, number> = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`community_posts/${id}`).set({
      authorId: author, authorName: 'Willow', authorPronouns: 'she/her', title: 'Hi', content: 'Hello',
      category: 'general', tags: [], likes: 0, replyCount: 0, timestamp: new Date(), ...counts,
    });
  });
}

function likeAs(uid: string, id: string, by: 1 | -1) {
  const fs = testEnv.authenticatedContext(uid).firestore();
  const batch = fs.batch();
  batch.update(fs.doc(`community_posts/${id}`), { likes: firebase.firestore.FieldValue.increment(by) });
  if (by === 1) batch.set(fs.doc(`community_posts/${id}/likes/${uid}`), { createdAt: now() });
  else batch.delete(fs.doc(`community_posts/${id}/likes/${uid}`));
  return batch.commit();
}

function replyAs(uid: string, id: string, overrides: Record<string, unknown> = {}, bump = 1) {
  const fs = testEnv.authenticatedContext(uid).firestore();
  const batch = fs.batch();
  batch.set(fs.collection(`community_posts/${id}/replies`).doc(), {
    authorId: uid, authorName: 'Ivy', authorPronouns: 'she/her', content: 'same here!', timestamp: now(), ...overrides,
  });
  batch.update(fs.doc(`community_posts/${id}`), { replyCount: firebase.firestore.FieldValue.increment(bump) });
  batch.set(fs.doc(`rate_limits/${uid}`), { communityReply: now() }, { merge: true });
  return batch.commit();
}

const communityPost = (authorId: string, overrides: Record<string, unknown> = {}) => ({
  authorId, authorName: 'Willow', authorPronouns: 'she/her', authorAvatar: 'cat.1.2', title: 'Book recs?',
  content: 'Looking for sapphic novels', category: 'media', tags: ['Books'], likes: 0, replyCount: 0, timestamp: now(),
  ...overrides,
});

test('C-01: Posts CAN be shared with everyone, but not spoofed or pre-liked', async () => {
  await assertSucceeds(stampedAdd('alice', 'community_posts', communityPost('alice'), 'communityPost'));
  await assertSucceeds(testEnv.authenticatedContext('bob').firestore().collection('community_posts').get());
  await seedStamp('alice', 'communityPost', 60);
  await assertFails(stampedAdd('alice', 'community_posts', communityPost('bob'), 'communityPost'));
  await assertFails(stampedAdd('alice', 'community_posts', communityPost('alice', { likes: 99 }), 'communityPost'));
  await assertFails(stampedAdd('alice', 'community_posts', communityPost('alice', { category: 'spam' }), 'communityPost'));
  await assertFails(testEnv.unauthenticatedContext().firestore().collection('community_posts').get());
});

test('C-02: Posting is limited to one every 30 seconds', async () => {
  await assertSucceeds(stampedAdd('alice', 'community_posts', communityPost('alice'), 'communityPost'));
  await assertFails(stampedAdd('alice', 'community_posts', communityPost('alice'), 'communityPost'));
  await seedStamp('alice', 'communityPost', 31);
  await assertSucceeds(stampedAdd('alice', 'community_posts', communityPost('alice'), 'communityPost'));
});

test('C-03: Each person CAN like once and unlike, and counts move by exactly one', async () => {
  await seedCommunityPost('p1', 'alice');
  await assertSucceeds(likeAs('bob', 'p1', 1));
  await assertFails(likeAs('bob', 'p1', 1));
  await assertSucceeds(likeAs('bob', 'p1', -1));
  await assertFails(likeAs('bob', 'p1', -1));
  const carol = testEnv.authenticatedContext('carol').firestore();
  await assertFails(carol.doc('community_posts/p1').update({ likes: 50 }));
  await assertFails(carol.doc('community_posts/p1').update({ title: 'hijacked' }));
});

test('C-04: Replies CAN be added with the count, not spoofed, padded or edited', async () => {
  await seedCommunityPost('p1', 'alice');
  await assertSucceeds(replyAs('bob', 'p1'));
  await seedStamp('bob', 'communityReply', 10);
  await assertFails(replyAs('bob', 'p1', { authorId: 'alice' }));
  await assertFails(replyAs('bob', 'p1', { content: 'x'.repeat(501) }));
  await assertFails(replyAs('bob', 'p1', {}, 5));
  await assertSucceeds(testEnv.authenticatedContext('carol').firestore().collection('community_posts/p1/replies').get());
});

test('C-05: Only the author or an admin CAN delete a post', async () => {
  await seedCommunityPost('p1', 'alice');
  await seedCommunityPost('p2', 'alice');
  await assertFails(testEnv.authenticatedContext('bob').firestore().doc('community_posts/p1').delete());
  await assertSucceeds(testEnv.authenticatedContext('alice').firestore().doc('community_posts/p1').delete());
  await seedAdmin();
  await assertSucceeds(adminDb().doc('community_posts/p2').delete());
});

// ---------------------------------------------------------------- Support chat

function supportSend(uid: string, text: string, fs = testEnv.authenticatedContext(uid).firestore()) {
  const batch = fs.batch();
  batch.set(fs.collection(`support_threads/${uid}/messages`).doc(), { from: 'user', text, timestamp: now() });
  batch.set(
    fs.doc(`support_threads/${uid}`),
    { displayName: 'Moody_Raccoon', lastMessage: text.slice(0, 140), lastFrom: 'user', updatedAt: now(), unreadForTeam: true },
    { merge: true }
  );
  batch.set(fs.doc(`rate_limits/${uid}`), { support: now() }, { merge: true });
  return batch.commit();
}

function teamReply(uid: string, text: string, fs = adminDb()) {
  const batch = fs.batch();
  batch.set(fs.collection(`support_threads/${uid}/messages`).doc(), { from: 'team', text, timestamp: now() });
  batch.update(fs.doc(`support_threads/${uid}`), {
    lastMessage: text.slice(0, 140), lastFrom: 'team', updatedAt: now(), unreadForUser: true, unreadForTeam: false,
  });
  return batch.commit();
}

test('S-01: A member CAN open a private support thread; only they and admins can read it', async () => {
  await seedAdmin();
  await assertSucceeds(supportSend('ivy', 'How do I change my name?'));
  const ivy = testEnv.authenticatedContext('ivy').firestore();
  await assertSucceeds(ivy.doc('support_threads/ivy').get());
  await assertSucceeds(ivy.collection('support_threads/ivy/messages').get());
  const eve = testEnv.authenticatedContext('eve').firestore();
  await assertFails(eve.doc('support_threads/ivy').get());
  await assertFails(eve.collection('support_threads/ivy/messages').get());
  await assertFails(eve.collection('support_threads').get());
  await assertSucceeds(adminDb().collection('support_threads').get());
  await assertSucceeds(adminDb().collection('support_threads/ivy/messages').get());
});

test('S-02: Members CANNOT pose as the team, write into others threads, or skip slow mode', async () => {
  await seedAdmin();
  const ivy = testEnv.authenticatedContext('ivy').firestore();
  await assertFails(ivy.collection('support_threads/ivy/messages').add({ from: 'team', text: 'fake', timestamp: now() }));
  await assertFails(supportSend('ivy', 'hi', testEnv.authenticatedContext('eve').firestore()));
  await assertSucceeds(supportSend('ivy', 'first'));
  await assertFails(supportSend('ivy', 'too fast'));
  // Members can clear only their own unread flag, never the team's.
  await assertSucceeds(ivy.doc('support_threads/ivy').update({ unreadForUser: false }));
  await assertFails(ivy.doc('support_threads/ivy').update({ unreadForTeam: false }));
});

test('S-03: Admins CAN reply as the team and mark threads read; members see the reply', async () => {
  await seedAdmin();
  await assertSucceeds(supportSend('ivy', 'Is this app safe?'));
  await assertSucceeds(teamReply('ivy', 'Yes! Here is how we keep it safe…'));
  await assertSucceeds(adminDb().doc('support_threads/ivy').update({ unreadForTeam: false }));
  await assertFails(adminDb().doc('support_threads/ivy').update({ lastMessage: 'rewritten' }));
  // A Google user without an admins doc cannot reply.
  const eve = testEnv.authenticatedContext('eve', google).firestore();
  await assertFails(teamReply('ivy', 'not staff', eve));
  const msgs = await testEnv.authenticatedContext('ivy').firestore().collection('support_threads/ivy/messages').get();
  assert.equal(msgs.docs.filter((d) => d.data().from === 'team').length, 1);
});

test('S-04: Only admins CAN post verified team messages in the Public Room', async () => {
  await seedAdmin();
  const teamMsg = (uid: string) => ({
    authorId: uid, authorName: 'QUEERSPACE Team', authorPronouns: 'team', text: 'Welcome!', timestamp: now(), team: true,
  });
  await assertSucceeds(adminDb().collection('public_room_messages').add(teamMsg('cha')));
  await assertFails(testEnv.authenticatedContext('ivy').firestore().collection('public_room_messages').add(teamMsg('ivy')));
  await assertFails(stampedAdd('ivy', 'public_room_messages', teamMsg('ivy'), 'publicRoom'));
});

test('S-05: Team posts CAN quote a message; members cannot, and quotes must be well-formed', async () => {
  await seedAdmin();
  const quote = { id: 'm1', author: 'Ivy', text: 'How do I rename?' };
  const teamReply = (extra: object) => ({
    authorId: 'cha', authorName: 'QUEERSPACE Team', authorPronouns: 'team', text: 'Tap your avatar!', timestamp: now(), team: true, ...extra,
  });
  await assertSucceeds(adminDb().collection('public_room_messages').add(teamReply({ replyTo: quote })));
  await assertFails(adminDb().collection('public_room_messages').add(teamReply({ replyTo: { ...quote, text: 'x'.repeat(141) } })));
  await assertFails(adminDb().collection('public_room_messages').add(teamReply({ replyTo: { ...quote, extra: 1 } })));
  await assertFails(
    stampedAdd('ivy', 'public_room_messages', {
      authorId: 'ivy', authorName: 'Ivy', authorPronouns: 'she/her', text: 'hi', timestamp: now(), replyTo: quote,
    }, 'publicRoom')
  );
});

// ------------------------------------------------------------------
// Suspensions
// ------------------------------------------------------------------
const UNDERAGE = 'Underage participant (violating 18+ policy)';

async function seedChat(id = 'c1', participants = ['alice', 'bob']) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`conversations/${id}`).set({
      participants, createdAt: new Date(), updatedAt: new Date(), status: 'blocked',
    });
  });
}

const autoSuspension = (reporterId: string, convId = 'c1', overrides: Record<string, unknown> = {}) => ({
  source: 'auto-underage', reason: UNDERAGE, createdAt: now(), reporterId, convId, ...overrides,
});

async function seedSuspension(uid: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`suspensions/${uid}`).set({ source: 'admin', reason: 'test', createdAt: new Date() });
  });
}

test('SU-01: A chat partner CAN auto-suspend someone they reported as underage; nobody else can', async () => {
  await seedChat('c1', ['alice', 'bob']);
  const alice = testEnv.authenticatedContext('alice').firestore();
  const carol = testEnv.authenticatedContext('carol').firestore();
  // Not in that conversation, spoofed reporter, self-suspension, wrong source, extra fields: rejected.
  await assertFails(carol.doc('suspensions/bob').set(autoSuspension('carol')));
  await assertFails(alice.doc('suspensions/bob').set(autoSuspension('carol')));
  await assertFails(alice.doc('suspensions/alice').set(autoSuspension('alice')));
  await assertFails(alice.doc('suspensions/bob').set(autoSuspension('alice', 'c1', { source: 'admin' })));
  await assertFails(alice.doc('suspensions/bob').set(autoSuspension('alice', 'c1', { until: 'forever' })));
  await assertSucceeds(alice.doc('suspensions/bob').set(autoSuspension('alice')));
  // Can't be rewritten or lifted by members, including the suspended person.
  const bob = testEnv.authenticatedContext('bob').firestore();
  await assertSucceeds(bob.doc('suspensions/bob').get());
  await assertFails(carol.doc('suspensions/bob').get());
  await assertFails(bob.doc('suspensions/bob').delete());
  await assertFails(alice.doc('suspensions/bob').update({ reason: 'x' }));
});

test('SU-02: Admins CAN suspend and lift; members cannot use the admin form', async () => {
  await seedAdmin();
  const suspension = { source: 'admin', reason: UNDERAGE, createdAt: now(), reportId: 'r1' };
  await assertFails(testEnv.authenticatedContext('alice').firestore().doc('suspensions/bob').set(suspension));
  await assertSucceeds(adminDb().doc('suspensions/bob').set(suspension));
  await assertSucceeds(adminDb().collection('suspensions').get());
  await assertSucceeds(adminDb().doc('suspensions/bob').delete());
});

test('SU-03: A suspended account CANNOT match, chat or post publicly, but CAN still message support', async () => {
  await seedSuspension('bob');
  await seedChat('c2', ['alice', 'bob']);
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('conversations/c2').update({ status: 'active' });
    await ctx.firestore().doc('match_queue/alice').set(waitingEntry());
  });
  const bob = testEnv.authenticatedContext('bob').firestore();
  await assertFails(bob.doc('match_queue/bob').set(waitingEntry()));
  await assertFails(bob.doc('conversations/c2/messages/m1').set({ senderId: 'bob', text: 'hi', timestamp: new Date() }));
  await assertFails(stampedAdd('bob', 'public_room_messages', roomMessage('bob'), 'publicRoom'));
  await assertFails(postUnsaidAs('bob', 'u1'));
  await assertFails(stampedAdd('bob', 'community_posts', communityPost('bob'), 'communityPost'));
  await assertSucceeds(supportSend('bob', 'Please review my account'));
  // Everyone else is unaffected.
  await assertSucceeds(stampedAdd('alice', 'public_room_messages', roomMessage('alice'), 'publicRoom'));
  await assertSucceeds(
    testEnv.authenticatedContext('alice').firestore().doc('conversations/c2/messages/m2').set({ senderId: 'alice', text: 'hey', timestamp: new Date() })
  );
});

test('Q-06: Queue entries CAN carry an 18+ age and a valid age range, nothing else', async () => {
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertSucceeds(alice.doc('match_queue/alice').set({ ...waitingEntry(), age: 27, ageMin: 22, ageMax: 35 }));
  await assertSucceeds(alice.doc('match_queue/alice').set({ ...waitingEntry(), age: 27 }));
  await assertFails(alice.doc('match_queue/alice').set({ ...waitingEntry(), age: 16 }));
  await assertFails(alice.doc('match_queue/alice').set({ ...waitingEntry(), age: 27, ageMin: 30, ageMax: 20 }));
  await assertFails(alice.doc('match_queue/alice').set({ ...waitingEntry(), age: 27, ageMin: 17, ageMax: 30 }));
  await assertFails(alice.doc('match_queue/alice').set({ ...waitingEntry(), age: 27, ageMin: 20 }));
  await assertFails(alice.doc('match_queue/alice').set({ ...waitingEntry(), age: '27' }));
});

test('Q-07: Queue entries CAN carry short location, gender expression and topic lists', async () => {
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertSucceeds(
    alice.doc('match_queue/alice').set({
      ...waitingEntry(),
      areas: ['Cebu City'],
      wantAreas: ['Cebu City'],
      expr: ['Femme'],
      wantExpr: ['Butch', 'Stem'],
      topics: ['cats & dogs'],
    })
  );
  await assertFails(alice.doc('match_queue/alice').set({ ...waitingEntry(), areas: 'Cebu City' }));
  await assertFails(alice.doc('match_queue/alice').set({ ...waitingEntry(), wantExpr: [] }));
  await assertFails(alice.doc('match_queue/alice').set({ ...waitingEntry(), areas: Array.from({ length: 21 }, (_, i) => `a${i}`) }));
  await assertFails(alice.doc('match_queue/alice').set({ ...waitingEntry(), city: 'Cebu City' }));
});

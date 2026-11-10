import { loadActivityStats, loadRetention } from '../src/services/adminGrowthService.ts';
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
        host: (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':')[0],
        port: Number((process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':')[1]),
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

/** Adult (self-reported 30y) members with a complete public profile: the minimum to pass isEligibleMember. */
const ELIGIBLE_UIDS = ['alice', 'bob', 'carol', 'cha', 'charlie', 'dana', 'dave', 'eve', 'ivy', 'uid', 'erin', 'fay', 'gail', 'hana', 'jo'];
async function seedEligibleMember(uid: string, birthDate: Date = new Date(Date.now() - 30 * 365 * 86400000)) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`users/${uid}/private/settings`).set({ birthDate, createdAt: new Date(), updatedAt: new Date() });
    await db.doc(`users/${uid}/public/profile`).set({
      displayName: uid, pronouns: 'she/her', intention: 'open', region: 'Anywhere', topics: [], profileComplete: true, updatedAt: new Date(),
    });
  });
}

beforeEach(async () => {
  if (testEnv) {
    await testEnv.clearFirestore();
    for (const uid of ELIGIBLE_UIDS) await seedEligibleMember(uid);
  }
});

// ------------------------------------------------------------------
// 1. Private Settings & Profile Privacy Tests
// ------------------------------------------------------------------
test('T-01: Profile Owner CAN write valid private settings', async () => {
  await testEnv.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('users/alice/private/settings').delete());
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

test('T-11: Likes are retired: a client can no longer like a post (Stardust is given through /api/stardust only)', async () => {
  await seedCommunityPost('post1', 'bob');
  await assertFails(likeAs('alice', 'post1', 1));
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

test('Q-03: Clients CANNOT claim a waiting user or create the conversation (the matching API does)', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('match_queue/alice').set(waitingEntry());
    await ctx.firestore().doc('match_queue/bob').set(waitingEntry());
  });
  const alice = testEnv.authenticatedContext('alice').firestore();
  const convRef = alice.collection('conversations').doc();
  const batch = alice.batch();
  batch.set(convRef, { participants: ['alice', 'bob'], status: 'active', createdAt: new Date(), updatedAt: new Date() });
  batch.update(alice.doc('match_queue/bob'), { status: 'matched', partnerId: 'alice', convId: convRef.id, updatedAt: new Date() });
  batch.update(alice.doc('match_queue/alice'), { status: 'matched', partnerId: 'bob', convId: convRef.id, updatedAt: new Date() });
  await assertFails(batch.commit());
  await assertFails(alice.doc('conversations/solo').set({ participants: ['alice', 'bob'], status: 'active', createdAt: new Date(), updatedAt: new Date() }));
  // The server (Admin SDK) pairs them; each side can then read their own matched entry, an outsider cannot.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('conversations/c9').set({ participants: ['alice', 'bob'], status: 'active', createdAt: new Date(), updatedAt: new Date() });
    await ctx.firestore().doc('match_queue/bob').update({ status: 'matched', partnerId: 'alice', convId: 'c9' });
  });
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
    // Echoes are permanent: no expiresAt unless a test adds one.
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

test('U-01: User CAN post anonymously, with no expiry, and an owner record', async () => {
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
  await reserveFor('alice', 'Willow'); // names must be reserved by the server first
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
  await reserveFor('alice', 'Willow');
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertFails(alice.doc('users/alice/public/profile').set(profile({ createdAt: new Date(0) })));
  await assertSucceeds(alice.doc('users/alice/public/profile').set(profile({ createdAt: now() })));
  await reserveFor('alice', 'Ivy');
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

test('C-03: No client can like, unlike or edit a post, and the old like counter cannot be moved', async () => {
  await seedCommunityPost('p1', 'alice', { likes: 1 });
  await assertFails(likeAs('bob', 'p1', 1));
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

test('C-06: Only an admin CAN delete someone else\'s reply, and only with the counter', async () => {
  await seedCommunityPost('p1', 'alice', { replyCount: 1 });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('community_posts/p1/replies/r1').set({
      authorId: 'bob', authorName: 'Ivy', authorPronouns: 'she/her', content: 'hi', timestamp: new Date(),
    });
  });
  await seedAdmin();
  const del = (fs: firebase.firestore.Firestore, bump = -1) => {
    const batch = fs.batch();
    batch.delete(fs.doc('community_posts/p1/replies/r1'));
    batch.update(fs.doc('community_posts/p1'), { replyCount: firebase.firestore.FieldValue.increment(bump) });
    return batch.commit();
  };
  // Neither the post author, the reply author nor a stranger can.
  await assertFails(del(testEnv.authenticatedContext('alice').firestore()));
  await assertFails(del(testEnv.authenticatedContext('bob').firestore()));
  await assertFails(del(testEnv.authenticatedContext('eve').firestore()));
  // An anonymous session on the admin's uid isn't an admin either.
  await assertFails(del(testEnv.authenticatedContext('cha').firestore()));
  // The admin can't leave the counter wrong.
  await assertFails(del(adminDb(), 0));
  await assertSucceeds(del(adminDb()));
});

test('C-07: Only an admin CAN clear a deleted post\'s likes, and not while the post exists', async () => {
  await seedCommunityPost('p1', 'alice', { likes: 1 });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('community_posts/p1/likes/bob').set({ createdAt: new Date() });
  });
  await seedAdmin();
  await assertFails(testEnv.authenticatedContext('eve').firestore().collection('community_posts/p1/likes').get());
  await assertFails(adminDb().doc('community_posts/p1/likes/bob').delete());
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('community_posts/p1').delete();
  });
  await assertFails(testEnv.authenticatedContext('eve').firestore().doc('community_posts/p1/likes/bob').delete());
  await assertSucceeds(adminDb().doc('community_posts/p1/likes/bob').delete());
});

test('R-ADM: Only an admin CAN delete a public room message', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('public_room_messages/m9').set({ ...roomMessage('alice'), timestamp: new Date() });
  });
  await seedAdmin();
  await assertFails(testEnv.authenticatedContext('alice').firestore().doc('public_room_messages/m9').delete());
  await assertFails(testEnv.authenticatedContext('eve').firestore().doc('public_room_messages/m9').delete());
  await assertFails(testEnv.authenticatedContext('cha').firestore().doc('public_room_messages/m9').delete());
  await assertSucceeds(adminDb().doc('public_room_messages/m9').delete());
});

test('T-01: Participants CAN set, refresh and clear only their own typing stamp', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('conversations/tc').set({
      participants: ['alice', 'bob'], status: 'active', createdAt: new Date(), updatedAt: new Date(),
    });
  });
  const FV = firebase.firestore.FieldValue;
  const FP = firebase.firestore.FieldPath;
  const alice = testEnv.authenticatedContext('alice').firestore();
  const bob = testEnv.authenticatedContext('bob').firestore();
  await assertSucceeds(alice.doc('conversations/tc').update(new FP('typing', 'alice'), FV.serverTimestamp()));
  await assertSucceeds(alice.doc('conversations/tc').update(new FP('typing', 'alice'), FV.serverTimestamp()));
  // Not someone else's entry, not a made-up time, not stray fields.
  await assertFails(alice.doc('conversations/tc').update(new FP('typing', 'bob'), FV.serverTimestamp()));
  await assertFails(alice.doc('conversations/tc').update(new FP('typing', 'alice'), new Date(0)));
  await assertFails(alice.doc('conversations/tc').update({ typingNow: true }));
  // Bob's stamp doesn't block Alice sending (updatedAt bump + clearing her own).
  await assertSucceeds(bob.doc('conversations/tc').update(new FP('typing', 'bob'), FV.serverTimestamp()));
  await assertFails(alice.doc('conversations/tc').update(new FP('typing', 'bob'), FV.delete()));
  await assertSucceeds(
    alice.doc('conversations/tc').update('updatedAt', FV.serverTimestamp(), new FP('typing', 'alice'), FV.delete())
  );
  await assertSucceeds(alice.doc('conversations/tc').update(new FP('typing', 'alice'), FV.delete()));
  // Strangers can neither read nor write it.
  const eve = testEnv.authenticatedContext('eve').firestore();
  await assertFails(eve.doc('conversations/tc').get());
  await assertFails(eve.doc('conversations/tc').update(new FP('typing', 'eve'), FV.serverTimestamp()));
});

test('T-03: A typing update CAN\'T smuggle in other changes or a replaced map', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('conversations/tx').set({
      participants: ['alice', 'bob'], status: 'active', createdAt: new Date(), updatedAt: new Date(),
      typing: { bob: new Date() },
    });
  });
  const FV = firebase.firestore.FieldValue;
  const FP = firebase.firestore.FieldPath;
  const ref = () => testEnv.authenticatedContext('alice').firestore().doc('conversations/tx');
  const stamp = new FP('typing', 'alice');
  // Whole-map replacement would wipe or forge Bob's entry.
  await assertFails(ref().update({ typing: { alice: FV.serverTimestamp() } }));
  await assertFails(ref().update({ typing: { alice: FV.serverTimestamp(), bob: FV.serverTimestamp() } }));
  await assertFails(ref().update({ typing: 'yes' }));
  // Protected fields can't ride along.
  await assertFails(ref().update(stamp, FV.serverTimestamp(), 'participants', ['alice', 'eve']));
  await assertFails(ref().update(stamp, FV.serverTimestamp(), 'createdAt', new Date()));
  await assertFails(ref().update(stamp, FV.serverTimestamp(), 'admin', true));
  // Clearing when no entry exists yet (a message sent without typing first) is fine.
  await assertSucceeds(ref().update('updatedAt', FV.serverTimestamp(), stamp, FV.delete()));
  // The legacy write (updatedAt only) still works, with Bob's stamp present.
  await assertSucceeds(ref().update({ updatedAt: FV.serverTimestamp() }));
});

test('T-02: Typing CAN\'T be written once a conversation has ended', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('conversations/te').set({
      participants: ['alice', 'bob'], status: 'ended', createdAt: new Date(), updatedAt: new Date(),
    });
  });
  const FP = firebase.firestore.FieldPath;
  await assertFails(
    testEnv.authenticatedContext('alice').firestore().doc('conversations/te')
      .update(new FP('typing', 'alice'), firebase.firestore.FieldValue.serverTimestamp())
  );
});

const roomGif = { id: 'abc123XYZ', url: 'https://media.giphy.com/media/abc123XYZ/giphy.gif', previewUrl: 'https://media.giphy.com/media/abc123XYZ/200w.gif', width: 400, height: 300 };

test('GIF-02: no client, member or admin, can create or edit a room GIF message; a member CAN react, an admin CAN remove it, and listeners see it go', async () => {
  // Members and the team cannot write GIF fields at all: only the server (Admin SDK) creates GIF messages.
  await assertFails(stampedAdd('alice', 'public_room_messages', roomMessage('alice', { text: 'GIF', kind: 'gif', gif: roomGif }), 'publicRoom'));
  await assertFails(stampedAdd('alice', 'public_room_messages', roomMessage('alice', { text: 'GIF', kind: 'gif', gif: { ...roomGif, url: 'https://evil.example/x.gif' } }), 'publicRoom'));
  await seedAdmin();
  await assertFails(adminDb().collection('public_room_messages').add({ ...roomMessage('cha', { text: 'GIF', kind: 'gif', gif: roomGif, team: true }), timestamp: now() }));

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('public_room_messages/g1').set({ ...roomMessage('alice', { text: 'GIF', kind: 'gif', gif: roomGif }), timestamp: new Date() });
  });
  const alice = testEnv.authenticatedContext('alice').firestore();
  const bob = testEnv.authenticatedContext('bob').firestore();
  await assertFails(alice.doc('public_room_messages/g1').update({ gif: { ...roomGif, url: 'https://evil.example/x.gif' } }));
  await assertFails(alice.doc('public_room_messages/g1').update({ kind: 'text' }));
  await assertFails(alice.doc('public_room_messages/g1').delete());
  await assertFails(bob.doc('public_room_messages/g1').delete());
  await assertFails(testEnv.unauthenticatedContext().firestore().doc('public_room_messages/g1').get());

  // Reactions still work on a GIF message.
  const FV = firebase.firestore.FieldValue;
  const batch = bob.batch();
  batch.update(bob.doc('public_room_messages/g1'), { heart: FV.increment(1) });
  batch.set(bob.doc('public_room_messages/g1/reactions/bob'), { type: 'heart', createdAt: now() });
  await assertSucceeds(batch.commit());

  // Members' live listeners get the GIF, then see it disappear when a moderator removes it.
  const seen: string[][] = [];
  let step!: () => void;
  const next = () => new Promise<void>((resolve) => { step = resolve; });
  let waiting = next();
  const stop = bob.collection('public_room_messages').onSnapshot((snap: any) => { seen.push(snap.docs.map((d: any) => d.id)); step?.(); });
  await waiting;
  assert.deepEqual(seen[seen.length - 1], ['g1']);
  waiting = next();
  await assertSucceeds(adminDb().doc('public_room_messages/g1').delete());
  await waiting;
  assert.deepEqual(seen[seen.length - 1], []);
  stop();
});

test('AR-01: only an admin can allow another birthday try; only that member can use it up; nobody can list them', async () => {
  await seedAdmin();
  const cha = adminDb();
  const ana = testEnv.authenticatedContext('ana').firestore();
  const ben = testEnv.authenticatedContext('ben').firestore();
  const grant = (extra: Record<string, unknown> = {}) => ({ clearedBy: 'cha', clearedAt: now(), reportId: 'r1', ...extra });

  // Members, even the locked one, cannot give themselves (or anyone) another try.
  await assertFails(ana.doc('age_review_clearances/ana').set(grant({ clearedBy: 'ana' })));
  await assertFails(ben.doc('age_review_clearances/ana').set(grant({ clearedBy: 'ben' })));
  // An admin who is not signed in with Google is not an admin.
  await assertFails(testEnv.authenticatedContext('cha').firestore().doc('age_review_clearances/ana').set(grant()));
  // The admin grant must be signed with their own id and the server time, and carry nothing extra.
  await assertFails(cha.doc('age_review_clearances/ana').set(grant({ clearedBy: 'someone-else' })));
  await assertFails(cha.doc('age_review_clearances/ana').set(grant({ clearedAt: new Date() })));
  await assertFails(cha.doc('age_review_clearances/ana').set(grant({ birthDate: '2000-01-01' })));
  await assertSucceeds(cha.doc('age_review_clearances/ana').set(grant()));

  // Only the member it is for (and the admin) can see it; no one can list them.
  await assertSucceeds(ana.doc('age_review_clearances/ana').get());
  await assertFails(ben.doc('age_review_clearances/ana').get());
  await assertFails(cha.collection('age_review_clearances').get());
  await assertFails(testEnv.unauthenticatedContext().firestore().doc('age_review_clearances/ana').get());

  // The member cannot edit it, another member cannot use it up, and the member can.
  await assertFails(ana.doc('age_review_clearances/ana').update({ clearedBy: 'ana' }));
  await assertFails(ben.doc('age_review_clearances/ana').delete());
  await assertSucceeds(ana.doc('age_review_clearances/ana').delete());
  // Used up: it is gone, so a second birthday failure locks them again until an admin allows another try.
  assert.equal((await assertSucceeds(ana.doc('age_review_clearances/ana').get())).exists, false);
});

// ------------------------------------------------------------------
// Echoes: eight categories, and replies only where they belong
// ------------------------------------------------------------------
const REACTION_ONLY_KINDS = ['confession', 'vent', 'unsent', 'thoughts'];
const REPLY_KINDS = ['advice', 'wins', 'gratitude', 'daydreams'];
const ALL_KINDS = [...REACTION_ONLY_KINDS, ...REPLY_KINDS];
const takesReplies = (kind: string) => REPLY_KINDS.includes(kind);

/** An Echo written the way the app writes it: replies carry a counter, and their owner record remembers the kind. */
function echoAs(uid: string, id: string, kind: string, over: { post?: Record<string, unknown>; owner?: Record<string, unknown> } = {}) {
  const fs = testEnv.authenticatedContext(uid).firestore();
  const batch = fs.batch();
  batch.set(fs.doc(`unsaid/${id}`), {
    kind, text: 'an anonymous echo', createdAt: firebase.firestore.FieldValue.serverTimestamp(), hugs: 0, same: 0, flags: 0,
    ...(takesReplies(kind) ? { replyCount: 0 } : {}), ...over.post,
  });
  batch.set(fs.doc(`unsaid_owners/${id}`), takesReplies(kind) ? { authorId: uid, kind, seenReplies: 0, ...over.owner } : { authorId: uid, ...over.owner });
  batch.set(fs.doc(`rate_limits/${uid}`), { unsaid: now() }, { merge: true });
  return batch.commit();
}

/** An Echo that already exists (written with the rules off), as the app would have stored it. */
async function seedEcho(id: string, author: string, kind: string, replyCount = 0) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`unsaid/${id}`).set({ kind, text: 'seeded', createdAt: new Date(), hugs: 0, same: 0, flags: 0, ...(takesReplies(kind) ? { replyCount } : {}) });
    await ctx.firestore().doc(`unsaid_owners/${id}`).set(takesReplies(kind) ? { authorId: author, kind, seenReplies: 0 } : { authorId: author });
  });
}

const replyBatch = (uid: string, postId: string, replyId: string, text = 'You can do this!') => {
  const fs = testEnv.authenticatedContext(uid).firestore();
  const b = fs.batch();
  b.set(fs.doc(`unsaid/${postId}/replies/${replyId}`), { text, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  b.set(fs.doc(`unsaid_reply_owners/${replyId}`), { authorId: uid, postId });
  b.update(fs.doc(`unsaid/${postId}`), { replyCount: firebase.firestore.FieldValue.increment(1), lastReply: replyId });
  b.set(fs.doc(`rate_limits/${uid}`), { unsaidReply: now() }, { merge: true });
  return { fs, batch: b };
};
const replyAsFull = (uid: string, postId: string, replyId: string, text?: string) => replyBatch(uid, postId, replyId, text).batch.commit();

const deleteReplyBatch = (ctxDb: any, postId: string, replyId: string) => {
  const b = ctxDb.batch();
  b.delete(ctxDb.doc(`unsaid/${postId}/replies/${replyId}`));
  b.delete(ctxDb.doc(`unsaid_reply_owners/${replyId}`));
  b.update(ctxDb.doc(`unsaid/${postId}`), { replyCount: firebase.firestore.FieldValue.increment(-1), lastReply: replyId });
  return b;
};

/** A reply that already exists on a post (rules off), with its owner record and the counter moved to match. */
async function seedReply(postId: string, replyId: string, author: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    const post = await fs.doc(`unsaid/${postId}`).get();
    await fs.doc(`unsaid/${postId}/replies/${replyId}`).set({ text: 'seeded reply', createdAt: new Date() });
    await fs.doc(`unsaid_reply_owners/${replyId}`).set({ authorId: author, postId });
    await fs.doc(`unsaid/${postId}`).update({ replyCount: (post.data()!?.replyCount ?? 0) + 1 });
  });
}

test('EC-01: all eight categories CAN be published anonymously, and only those eight', async () => {
  const authors = ['alice', 'bob', 'carol', 'cha', 'dana', 'dave', 'eve', 'ivy'];
  for (const [i, kind] of ALL_KINDS.entries()) await assertSucceeds(echoAs(authors[i], `e-${kind}`, kind));
  const reader = testEnv.authenticatedContext('erin').firestore();
  for (const kind of ALL_KINDS) {
    const snap = await assertSucceeds(reader.doc(`unsaid/e-${kind}`).get());
    assert.equal(snap.data()!.kind, kind);
    assert.ok(!('authorId' in snap.data()!), `${kind}: the public post leaks no author`);
    assert.equal('replyCount' in snap.data()!, takesReplies(kind), `${kind}: only categories that take replies carry a reply counter`);
  }
  // Anything else is refused: an unknown kind, an author field, and a reply counter on a reactions-only category.
  await assertFails(echoAs('fay', 'e-rant', 'rant'));
  await assertFails(echoAs('fay', 'e-leak', 'wins', { post: { authorId: 'fay' } }));
  for (const kind of REACTION_ONLY_KINDS) await assertFails(echoAs('fay', `e-bad-${kind}`, kind, { post: { replyCount: 0 } }));
  // A reply counter must start at zero, and the owner record cannot lie about the kind or pre-set what the author has seen.
  await assertFails(echoAs('fay', 'e-count', 'wins', { post: { replyCount: 5 } }));
  await assertFails(echoAs('fay', 'e-kindlie', 'wins', { owner: { kind: 'vent' } }));
  await assertFails(echoAs('fay', 'e-seen', 'wins', { owner: { seenReplies: 3 } }));
});

test('EC-02: replies CAN be posted on Need Advice, Little Wins, Gratitude and Daydreams, in order, with the count going up', async () => {
  const repliers = ['bob', 'carol', 'cha', 'dana'];
  for (const [i, kind] of REPLY_KINDS.entries()) {
    await seedEcho(`r-${kind}`, 'alice', kind);
    await assertSucceeds(replyAsFull(repliers[i], `r-${kind}`, `reply-${kind}-0001`, `A kind word on ${kind}`));
    const reader = testEnv.authenticatedContext('erin').firestore();
    const post = await assertSucceeds(reader.doc(`unsaid/r-${kind}`).get());
    assert.equal(post.data()!.replyCount, 1, `${kind}: the counter went up`);
    const replies = await assertSucceeds(reader.collection(`unsaid/r-${kind}/replies`).orderBy('createdAt', 'asc').get());
    assert.equal(replies.size, 1);
    assert.deepEqual(Object.keys(replies.docs[0].data()!).sort(), ['createdAt', 'text'], `${kind}: a reply is just text and a time, so it is anonymous`);
  }
  // Several replies, one after another (past the 5 second slow mode), stay in order.
  await seedStamp('bob', 'unsaidReply', 10);
  await assertSucceeds(replyAsFull('bob', 'r-advice', 'reply-advice-0002', 'Second reply'));
  const post = await assertSucceeds(testEnv.authenticatedContext('erin').firestore().doc('unsaid/r-advice').get());
  assert.equal(post.data()!.replyCount, 2);
});

test('EC-03: replies are REFUSED on Confession, Vent, Unsent Letters and Random Thoughts, whatever the client tries', async () => {
  let n = 0;
  for (const kind of REACTION_ONLY_KINDS) {
    const id = `n-${kind}`;
    await seedEcho(id, 'alice', kind);
    const replier = ['bob', 'carol', 'cha', 'dana'][n++];
    // The full, correctly formed reply batch is refused...
    await assertFails(replyAsFull(replier, id, `reply-${kind}-0001`));
    // ...the reply on its own, with no counter change, is refused...
    const fs = testEnv.authenticatedContext(replier).firestore();
    await assertFails(fs.doc(`unsaid/${id}/replies/reply-${kind}-0002`).set({ text: 'sneaky', createdAt: now() }));
    // ...and so is a reply counter appearing on the post (alone, or with a reply).
    await assertFails(fs.doc(`unsaid/${id}`).update({ replyCount: 1, lastReply: `reply-${kind}-0003` }));
    // The owner record of a reply that cannot exist is refused too.
    await assertFails(fs.doc('unsaid_reply_owners/reply-' + kind + '-0004').set({ authorId: replier, postId: id }));
    const snap = await assertSucceeds(testEnv.authenticatedContext('erin').firestore().doc(`unsaid/${id}`).get());
    assert.ok(!('replyCount' in snap.data()!), `${kind}: still no reply counter`);
    // Reactions still work on it.
    await assertSucceeds(reactAs('erin', id, 'hugs'));
  }
  // Even a post of a reactions-only kind that someone forced a reply counter onto (rules off) cannot take a reply.
  await testEnv.withSecurityRulesDisabled(async (ctx) => { await ctx.firestore().doc('unsaid/n-confession').update({ replyCount: 0 }); });
  await seedStamp('bob', 'unsaidReply', 60);
  await assertFails(replyAsFull('bob', 'n-confession', 'reply-forced-0001'));
});

test('EC-04: unauthorized replies are refused: not signed in, not an adult member, suspended, too fast, forged counter, wrong owner', async () => {
  await seedEcho('a1', 'alice', 'advice');
  // Not signed in; not an eligible member (no adult birthday / profile on file).
  const anon = testEnv.unauthenticatedContext().firestore();
  await assertFails(anon.doc('unsaid/a1/replies/reply-anon-0001').set({ text: 'hi', createdAt: now() }));
  await assertFails(replyAsFull('zed', 'a1', 'reply-zed-00001'));
  // Suspended members cannot reply.
  await testEnv.withSecurityRulesDisabled(async (ctx) => { await ctx.firestore().doc('suspensions/bob').set({ source: 'admin', reason: 'x', createdAt: new Date() }); });
  await assertFails(replyAsFull('bob', 'a1', 'reply-bob-00001'));

  // A counter that moves without a reply, by two, or with the wrong reply id.
  const carol = testEnv.authenticatedContext('carol').firestore();
  const inflate = carol.batch();
  inflate.update(carol.doc('unsaid/a1'), { replyCount: firebase.firestore.FieldValue.increment(1), lastReply: 'reply-fake-0001' });
  inflate.set(carol.doc('rate_limits/carol'), { unsaidReply: now() }, { merge: true });
  await assertFails(inflate.commit());
  const byTwo = replyBatch('carol', 'a1', 'reply-two-00001');
  byTwo.batch.update(byTwo.fs.doc('unsaid/a1'), { replyCount: firebase.firestore.FieldValue.increment(1) });
  await assertFails(byTwo.batch.commit());
  const wrongId = carol.batch();
  wrongId.set(carol.doc('unsaid/a1/replies/reply-real-00001'), { text: 'x', createdAt: now() });
  wrongId.set(carol.doc('unsaid_reply_owners/reply-real-00001'), { authorId: 'carol', postId: 'a1' });
  wrongId.update(carol.doc('unsaid/a1'), { replyCount: firebase.firestore.FieldValue.increment(1), lastReply: 'reply-other-0001' });
  wrongId.set(carol.doc('rate_limits/carol'), { unsaidReply: now() }, { merge: true });
  await assertFails(wrongId.commit());

  // An owner record in someone else's name; a reply with extra fields, a client-chosen time, no text or too much text.
  const forged = replyBatch('carol', 'a1', 'reply-forge-0001');
  forged.batch.set(forged.fs.doc('unsaid_reply_owners/reply-forge-0001'), { authorId: 'bob', postId: 'a1' });
  await assertFails(forged.batch.commit());
  for (const [i, bad] of [{ text: 'x', createdAt: now(), authorId: 'carol' }, { text: 'x', createdAt: new Date() }, { createdAt: now() }, { text: '', createdAt: now() }, { text: 'x'.repeat(301), createdAt: now() }].entries()) {
    const id = `reply-bad-${String(i).padStart(5, '0')}`;
    const b = carol.batch();
    b.set(carol.doc(`unsaid/a1/replies/${id}`), bad);
    b.set(carol.doc(`unsaid_reply_owners/${id}`), { authorId: 'carol', postId: 'a1' });
    b.update(carol.doc('unsaid/a1'), { replyCount: firebase.firestore.FieldValue.increment(1), lastReply: id });
    b.set(carol.doc('rate_limits/carol'), { unsaidReply: now() }, { merge: true });
    await assertFails(b.commit());
  }

  // Slow mode: a second reply within five seconds is refused; later it is fine. And a reply cannot be edited afterwards.
  await assertSucceeds(replyAsFull('dana', 'a1', 'reply-dana-00001'));
  await assertFails(replyAsFull('dana', 'a1', 'reply-dana-00002'));
  await seedStamp('dana', 'unsaidReply', 10);
  await assertSucceeds(replyAsFull('dana', 'a1', 'reply-dana-00003'));
  await assertFails(testEnv.authenticatedContext('dana').firestore().doc('unsaid/a1/replies/reply-dana-00001').update({ text: 'edited' }));
  const post = await assertSucceeds(testEnv.authenticatedContext('erin').firestore().doc('unsaid/a1').get());
  assert.equal(post.data()!.replyCount, 2, 'only the two real replies were counted');
});

test('EC-05: members CAN delete their own replies and posts, nobody else can, and the counter follows', async () => {
  await seedEcho('w1', 'alice', 'wins');
  await seedReply('w1', 'reply-bob-00001', 'bob');
  await seedReply('w1', 'reply-carol-0001', 'carol');
  const bob = testEnv.authenticatedContext('bob').firestore();
  const carol = testEnv.authenticatedContext('carol').firestore();
  // Someone else's reply, and the post's own author, cannot delete a reply that is not theirs.
  await assertFails(deleteReplyBatch(carol, 'w1', 'reply-bob-00001').commit());
  await assertFails(deleteReplyBatch(testEnv.authenticatedContext('alice').firestore(), 'w1', 'reply-bob-00001').commit());
  // Leaving the owner record alone does not help a stranger: a reply cannot be deleted and the counter lowered by anyone but its writer.
  for (const stranger of [carol, testEnv.authenticatedContext('alice').firestore()]) {
    const sneaky = stranger.batch();
    sneaky.delete(stranger.doc('unsaid/w1/replies/reply-bob-00001'));
    sneaky.update(stranger.doc('unsaid/w1'), { replyCount: firebase.firestore.FieldValue.increment(-1), lastReply: 'reply-bob-00001' });
    await assertFails(sneaky.commit());
  }
  // The counter cannot be lowered without really deleting a reply of one's own, or at all by a stranger.
  await assertFails(bob.doc('unsaid/w1').update({ replyCount: firebase.firestore.FieldValue.increment(-1), lastReply: 'reply-carol-0001' }));
  await assertFails(carol.doc('unsaid/w1').update({ replyCount: firebase.firestore.FieldValue.increment(-1), lastReply: 'reply-carol-0001' }));
  // The reply alone, with no counter change, cannot be deleted.
  await assertFails(bob.doc('unsaid/w1/replies/reply-bob-00001').delete());
  // The author of a reply deletes it: the reply, its owner record and one off the counter, together.
  await assertSucceeds(deleteReplyBatch(bob, 'w1', 'reply-bob-00001').commit());
  assert.equal((await assertSucceeds(bob.doc('unsaid/w1').get())).data()!.replyCount, 1);
  assert.equal((await assertSucceeds(bob.doc('unsaid/w1/replies/reply-bob-00001').get())).exists, false);
  // A moderator can remove any reply, but still cannot read who wrote it.
  await seedAdmin();
  const cha = adminDb();
  await assertFails(cha.doc('unsaid_reply_owners/reply-carol-0001').get());
  await assertSucceeds(deleteReplyBatch(cha, 'w1', 'reply-carol-0001').commit());
  assert.equal((await assertSucceeds(bob.doc('unsaid/w1').get())).data()!.replyCount, 0);
  // The author deletes their own post (with its owner record), as before.
  const alice = testEnv.authenticatedContext('alice').firestore();
  const del = alice.batch();
  del.delete(alice.doc('unsaid/w1'));
  del.delete(alice.doc('unsaid_owners/w1'));
  await assertSucceeds(del.commit());
});

test('EC-06: a reply\'s author stays private, and an author can mark the replies they have seen (and nothing else)', async () => {
  await seedEcho('d1', 'alice', 'daydreams');
  await seedReply('d1', 'reply-bob-00001', 'bob');
  await seedReply('d1', 'reply-carol-0001', 'carol');
  const alice = testEnv.authenticatedContext('alice').firestore();
  const bob = testEnv.authenticatedContext('bob').firestore();
  // Only a reply's own writer can read its owner record: not another member, and not the post's author.
  await assertSucceeds(bob.doc('unsaid_reply_owners/reply-bob-00001').get());
  await assertFails(alice.doc('unsaid_reply_owners/reply-bob-00001').get());
  await assertFails(testEnv.authenticatedContext('erin').firestore().collection('unsaid_reply_owners').get());
  await assertFails(alice.collection('unsaid_reply_owners').where('postId', '==', 'd1').get());
  await assertSucceeds(bob.collection('unsaid_reply_owners').where('authorId', '==', 'bob').where('postId', '==', 'd1').get());
  // Nobody can claim an existing reply.
  await assertFails(testEnv.authenticatedContext('erin').firestore().doc('unsaid_reply_owners/reply-bob-00001').set({ authorId: 'erin', postId: 'd1' }));

  // The post's author can list their own posts and mark replies as seen, up to the real count.
  await assertSucceeds(alice.collection('unsaid_owners').where('authorId', '==', 'alice').get());
  await assertSucceeds(alice.doc('unsaid_owners/d1').update({ seenReplies: 2 }));
  await assertFails(alice.doc('unsaid_owners/d1').update({ seenReplies: 3 }));
  await assertFails(alice.doc('unsaid_owners/d1').update({ seenReplies: -1 }));
  await assertFails(alice.doc('unsaid_owners/d1').update({ authorId: 'bob' }));
  await assertFails(alice.doc('unsaid_owners/d1').update({ seenReplies: 1, kind: 'vent' }));
  // Nobody else can touch that record.
  await assertFails(bob.doc('unsaid_owners/d1').update({ seenReplies: 1 }));
});

test('EC-07: existing Echoes and reactions are untouched: old posts read, react, flag and delete as before, and new kinds react too', async () => {
  // An Echo written before the new categories existed: a vent with no reply counter, and an owner record with only the author.
  await seedUnsaid('old1', 'alice');
  await testEnv.withSecurityRulesDisabled(async (ctx) => { await ctx.firestore().doc('unsaid/old2').set({ kind: 'confession', text: 'old', createdAt: new Date(), expiresAt: new Date(Date.now() + 48 * HOUR), hugs: 1, same: 0, flags: 0 }); await ctx.firestore().doc('unsaid_owners/old2').set({ authorId: 'alice' }); });
  const bob = testEnv.authenticatedContext('bob').firestore();
  assert.equal((await assertSucceeds(bob.doc('unsaid/old1').get())).data()!.kind, 'vent');
  assert.equal((await assertSucceeds(bob.doc('unsaid/old2').get())).data()!.hugs, 1);
  await assertSucceeds(reactAs('bob', 'old1', 'felt'));
  await assertSucceeds(reactAs('carol', 'old2', 'hugs'));
  // Flagging still works, on old and new kinds.
  await seedEcho('new1', 'dana', 'advice');
  for (const [uid, id] of [['bob', 'old1'], ['carol', 'new1']] as const) {
    const fs = testEnv.authenticatedContext(uid).firestore();
    const b = fs.batch();
    b.update(fs.doc(`unsaid/${id}`), { flags: firebase.firestore.FieldValue.increment(1) });
    b.set(fs.doc(`unsaid/${id}/flags/${uid}`), { createdAt: now() });
    await assertSucceeds(b.commit());
  }
  // Reactions work on every new category, including those that take replies (whose counter must not get in the way).
  let i = 0;
  for (const kind of ['unsent', 'thoughts', 'wins', 'gratitude', 'daydreams']) {
    await seedEcho(`k-${kind}`, 'dana', kind);
    await assertSucceeds(reactAs(['erin', 'fay', 'gail', 'hana', 'jo'][i++], `k-${kind}`, 'hugs'));
  }
  // The author of an old post can still delete it.
  const alice = testEnv.authenticatedContext('alice').firestore();
  const del = alice.batch();
  del.delete(alice.doc('unsaid/old2'));
  del.delete(alice.doc('unsaid_owners/old2'));
  await assertSucceeds(del.commit());
});

test('EC-08: the rules list the same eight categories and the same four reply categories as the app', async () => {
  const rules = fs.readFileSync('./firestore.rules', 'utf8');
  const list = (name: string) => [...(rules.match(new RegExp(`function ${name}\\(\\) \\{\\s*return \\[([^\\]]+)\\]`))?.[1].matchAll(/'([a-z]+)'/g) ?? [])].map((m) => m[1]);
  assert.deepEqual([...list('unsaidKinds')].sort(), [...ALL_KINDS].sort());
  assert.deepEqual([...list('unsaidReplyKinds')].sort(), [...REPLY_KINDS].sort());
});

test('RX-01: Room reactions CAN be added once per person, changed only by one counter, and removed', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('public_room_messages/m1').set({ ...roomMessage('alice'), timestamp: new Date() });
  });
  const FV = firebase.firestore.FieldValue;
  const react = (uid: string, type: string, by: 1 | -1, fieldType = type) => {
    const fs = testEnv.authenticatedContext(uid).firestore();
    const batch = fs.batch();
    batch.update(fs.doc('public_room_messages/m1'), { [type]: FV.increment(by) });
    if (by === 1) batch.set(fs.doc(`public_room_messages/m1/reactions/${uid}`), { type: fieldType, createdAt: now() });
    else batch.delete(fs.doc(`public_room_messages/m1/reactions/${uid}`));
    return batch.commit();
  };
  await assertSucceeds(react('bob', 'heart', 1));
  await assertSucceeds(react('carol', 'heart', 1));
  // Twice, or a marker that disagrees with the counter, or an unknown type: no.
  await assertFails(react('bob', 'fire', 1));
  await assertFails(react('dave', 'heart', 1, 'fire'));
  await assertFails(react('dave', 'wow', 1));
  // Can't bump by more than one or edit the text.
  const dave = testEnv.authenticatedContext('dave').firestore();
  await assertFails(dave.doc('public_room_messages/m1').update({ heart: 50 }));
  await assertFails(dave.doc('public_room_messages/m1').update({ text: 'hijacked' }));
  // Can't take back someone else's reaction, or fake one without a marker.
  await assertFails(react('dave', 'heart', -1));
  await assertFails(dave.doc('public_room_messages/m1').update({ heart: FV.increment(1) }));
  // The owner can remove theirs.
  await assertSucceeds(react('bob', 'heart', -1));
  await assertSucceeds(react('bob', 'laugh', 1));
  // Markers are private to their owner.
  await assertFails(dave.doc('public_room_messages/m1/reactions/bob').get());
  await assertSucceeds(testEnv.authenticatedContext('bob').firestore().doc('public_room_messages/m1/reactions/bob').get());
});

test('AD-05: Only a real admin CAN delete someone else\'s Unsaid post (post and owner record together)', async () => {
  await seedUnsaid('p5', 'alice');
  await seedAdmin();
  const del = (fs: firebase.firestore.Firestore) => {
    const batch = fs.batch();
    batch.delete(fs.doc('unsaid/p5'));
    batch.delete(fs.doc('unsaid_owners/p5'));
    return batch.commit();
  };
  await assertFails(del(testEnv.authenticatedContext('bob').firestore()));
  // Admin uid but an anonymous session, and a Google account that isn't in admins/.
  await assertFails(del(testEnv.authenticatedContext('cha').firestore()));
  await assertFails(del(testEnv.authenticatedContext('eve', google).firestore()));
  await assertSucceeds(del(adminDb()));
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

test('S-05: Team posts CAN quote a message, quotes must be well-formed, and a member cannot quote a message that does not exist', async () => {
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

test('Q-06: Queue entries CANNOT carry an age or an age range', async () => {
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertSucceeds(alice.doc('match_queue/alice').set(waitingEntry()));
  await assertFails(alice.doc('match_queue/alice').set({ ...waitingEntry(), age: 27 }));
  await assertFails(alice.doc('match_queue/alice').set({ ...waitingEntry(), ageMin: 22, ageMax: 35 }));
  await assertFails(alice.doc('match_queue/alice').set({ ...waitingEntry(), age: 27, ageMin: 22, ageMax: 35 }));
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
      intent: 'deep_talk',
    })
  );
  await assertFails(alice.doc('match_queue/alice').set({ ...waitingEntry(), areas: 'Cebu City' }));
  await assertFails(alice.doc('match_queue/alice').set({ ...waitingEntry(), wantExpr: [] }));
  await assertFails(alice.doc('match_queue/alice').set({ ...waitingEntry(), areas: Array.from({ length: 21 }, (_, i) => `a${i}`) }));
  await assertFails(alice.doc('match_queue/alice').set({ ...waitingEntry(), city: 'Cebu City' }));
  await assertFails(alice.doc('match_queue/alice').set({ ...waitingEntry(), intent: 'anything' }));
});


// ------------------------------------------------------------------
// Signals: server-managed consent records must never be client-accessible.
// ------------------------------------------------------------------
test('SIG-01: Clients CANNOT read or create Signals invitations', async () => {
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertFails(alice.doc('signalsInvitations/invite1234').get());
  await assertFails(alice.doc('signalsInvitations/invite1234').set({
    senderId: 'alice',
    recipientId: 'bob',
    status: 'pending',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  }));
});

test('SIG-02: Clients CANNOT read or create Signals pairs', async () => {
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertFails(alice.doc('signalsPairs/invite1234').get());
  await assertFails(alice.doc('signalsPairs/invite1234').set({
    invitationId: 'invite1234',
    participants: ['alice', 'bob'],
    status: 'active',
    createdAt: new Date(),
  }));
});

test('SIG-03: Clients CANNOT access Signals idempotency or rate-limit records', async () => {
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertFails(alice.doc('signalsIdempotency/request1234').get());
  await assertFails(alice.doc('signalsIdempotency/request1234').set({ action: 'create' }));
  await assertFails(alice.doc('signalsRateLimits/alice').get());
  await assertFails(alice.doc('signalsRateLimits/alice').set({ lastCreatedAt: new Date() }));
});

// ------------------------------------------------------------------
// Age eligibility and profile privacy
// ------------------------------------------------------------------
test('A-01: Underage or incomplete accounts CANNOT join the queue, chat, or post', async () => {
  await testEnv.clearFirestore();
  await seedEligibleMember('kid', new Date(Date.now() - 15 * 365 * 86400000));
  await assertFails(testEnv.authenticatedContext('kid').firestore().doc('match_queue/kid').set(waitingEntry()));
  await assertFails(testEnv.authenticatedContext('nobody').firestore().doc('match_queue/nobody').set(waitingEntry()));
});

test('A-02: Birthday CANNOT be set to an underage date, and others CANNOT read it', async () => {
  const alice = testEnv.authenticatedContext('alice').firestore();
  const base = { createdAt: new Date(), updatedAt: new Date() };
  await assertFails(alice.doc('users/newbie/private/settings').set({ ...base, birthDate: new Date() }));
  await assertSucceeds(testEnv.authenticatedContext('newbie').firestore().doc('users/newbie/private/settings').set({ ...base, birthDate: new Date(Date.now() - 25 * 365 * 86400000) }));
  await assertFails(testEnv.authenticatedContext('bob').firestore().doc('users/newbie/private/settings').get());
});

test('A-03: Incomplete public profiles are hidden from other members but not from their owner', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('users/draft/public/profile').set({ displayName: 'draft', profileComplete: false });
  });
  await assertFails(testEnv.authenticatedContext('bob').firestore().doc('users/draft/public/profile').get());
  await assertSucceeds(testEnv.authenticatedContext('draft').firestore().doc('users/draft/public/profile').get());
});

test('N-01: Only the owner can read their Signals inbox, and nobody can write it from the client', async () => {
  await testEnv.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('signalsInbox/alice').set({ rev: 1, pending: {} }));
  await assertSucceeds(testEnv.authenticatedContext('alice').firestore().doc('signalsInbox/alice').get());
  await assertFails(testEnv.authenticatedContext('bob').firestore().doc('signalsInbox/alice').get());
  await assertFails(testEnv.unauthenticatedContext().firestore().doc('signalsInbox/alice').get());
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertFails(alice.doc('signalsInbox/alice').set({ rev: 99, pending: {} }));
  await assertFails(alice.doc('signalsInbox/bob').set({ rev: 1 }));
  await assertFails(alice.doc('signalsInbox/alice').delete());
  // The invitations themselves stay server-only; a recipient cannot read or forge them directly.
  await assertFails(alice.doc('signalsInvitations/x').get());
  await assertFails(alice.doc('signalsInvitations/x').set({ senderId: 'bob', recipientId: 'alice', status: 'pending' }));
});

test('N-02: acceptance notifications are readable only by their owner and cannot be forged or edited from a client', async () => {
  await testEnv.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('signalsInbox/alice').set({
    rev: 2, pending: {}, notifications: { pair12345: { type: 'accepted', read: false, createdAt: new Date() } },
  }));
  const alice = testEnv.authenticatedContext('alice').firestore();
  const snap = await assertSucceeds(alice.doc('signalsInbox/alice').get());
  assert.equal(snap.data()?.notifications?.pair12345?.type, 'accepted');
  await assertFails(testEnv.authenticatedContext('bob').firestore().doc('signalsInbox/alice').get());
  await assertFails(testEnv.unauthenticatedContext().firestore().doc('signalsInbox/alice').get());
  const bob = testEnv.authenticatedContext('bob').firestore();
  // Nobody can plant a fake notification in someone else's inbox, or in their own, or flip one to read.
  await assertFails(bob.doc('signalsInbox/alice').set({ notifications: { fake1234: { type: 'accepted', read: false } } }, { merge: true }));
  await assertFails(alice.doc('signalsInbox/alice').set({ notifications: { fake1234: { type: 'accepted', read: false } } }, { merge: true }));
  await assertFails(alice.doc('signalsInbox/alice').update({ 'notifications.pair12345.read': true }));
  await assertFails(alice.doc('signalsInbox/alice').delete());
});

// ------------------------------------------------------------------
// Cosmos "Looking For" board (adult connection posts)
// ------------------------------------------------------------------
const LF_ME = 'I am a quiet, bookish person who loves cozy cafes, slow weekends, and long talks about nothing in particular. I warm up slowly.';
const LF_YOU = 'I would like to meet someone kind and curious who enjoys simple dates, good books, and building something real over time.';
const lfPost = (uid: string, overrides: Record<string, unknown> = {}) => ({
  authorId: uid, authorName: 'Willow', authorPronouns: 'she/her', title: 'Coffee and books?', intro: LF_ME,
  lookingFor: LF_YOU, intention: 'friendship', tags: ['Books'], isNsfw: false, contentWarning: null,
  age: 30, flair: 'Masc × Femme', timestamp: now(), ...overrides,
});
const lfId = (uid: string, intention = 'friendship') => `${uid}_${intention}`;

function lfCreate(uid: string, data: Record<string, unknown>, id = lfId(uid, String(data.intention ?? 'friendship'))) {
  const fs = testEnv.authenticatedContext(uid).firestore();
  const batch = fs.batch();
  batch.set(fs.doc(`looking_for_posts/${id}`), data);
  batch.set(fs.doc(`rate_limits/${uid}`), { lookingForPost: now() }, { merge: true });
  return batch.commit();
}

async function seedLfPost(uid: string, intention = 'friendship', extra: Record<string, unknown> = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`looking_for_posts/${lfId(uid, intention)}`).set({
      authorId: uid, authorName: 'Willow', authorPronouns: 'she/her', title: 't', intro: 'i', lookingFor: 'l', intention,
      tags: [], isNsfw: false, contentWarning: null, timestamp: new Date(), ...extra,
    });
  });
}

test('LF-01: Adult members CAN post and read; minors, signed-out and incomplete profiles CANNOT', async () => {
  await assertSucceeds(lfCreate('alice', lfPost('alice')));
  await assertSucceeds(testEnv.authenticatedContext('bob').firestore().collection('looking_for_posts').get());
  await assertFails(testEnv.unauthenticatedContext().firestore().collection('looking_for_posts').get());
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('users/minor/private/settings').set({ birthDate: new Date(Date.now() - 15 * 365 * 86400000), createdAt: new Date(), updatedAt: new Date() });
    await ctx.firestore().doc('users/minor/public/profile').set({ displayName: 'minor', profileComplete: true, updatedAt: new Date() });
    await ctx.firestore().doc('users/draft/private/settings').set({ birthDate: new Date(Date.now() - 30 * 365 * 86400000), createdAt: new Date(), updatedAt: new Date() });
    await ctx.firestore().doc('users/draft/public/profile').set({ displayName: 'draft', profileComplete: false, updatedAt: new Date() });
  });
  const minor = testEnv.authenticatedContext('minor').firestore();
  await assertFails(minor.collection('looking_for_posts').get());
  await assertFails(lfCreate('minor', lfPost('minor')));
  await assertFails(testEnv.authenticatedContext('draft').firestore().collection('looking_for_posts').get());
  await assertFails(lfCreate('draft', lfPost('draft')));
});

test('LF-02: A post must be the author own, in their own derived id, with only the allowed fields', async () => {
  await assertFails(lfCreate('alice', lfPost('bob'), lfId('alice')));
  await assertFails(lfCreate('alice', lfPost('alice'), 'alice_dating'));
  await assertFails(lfCreate('alice', lfPost('alice'), 'someone-elses-id'));
  await assertFails(lfCreate('alice', lfPost('alice', { birthDate: new Date() })));
  await assertFails(lfCreate('alice', lfPost('alice', { role: 'admin' })));
  await assertFails(lfCreate('alice', lfPost('alice', { status: 'approved' })));
  await assertFails(lfCreate('alice', lfPost('alice', { intention: 'hookup' }), 'alice_hookup'));
  await assertFails(lfCreate('alice', lfPost('alice', { title: '' })));
  await assertFails(lfCreate('alice', lfPost('alice', { intro: 'x'.repeat(401) })));
  await assertFails(lfCreate('alice', lfPost('alice', { timestamp: new Date(0) })));
  await assertFails(lfCreate('alice', lfPost('alice', { tags: ['1', '2', '3', '4', '5', '6', '7'] })));
  await assertFails(lfCreate('alice', lfPost('alice', { region: 'x'.repeat(61) })));
  await assertFails(lfCreate('alice', lfPost('alice', { seekAgeMin: 40, seekAgeMax: 20 })));
  await assertFails(lfCreate('alice', lfPost('alice', { seekAgeMin: 15 })));
  await assertSucceeds(lfCreate('alice', lfPost('alice', { seekAgeMin: 24, seekAgeMax: 32, region: 'Quezon City', authorAvatar: 'cat.1.2' })));
});

test('LF-03: A shown age must match the private birthday; no age needs no proof', async () => {
  await assertSucceeds(lfCreate('alice', lfPost('alice', { intention: 'dating', age: 30 })));
  await seedStamp('alice', 'lookingForPost', 61);
  await assertFails(lfCreate('alice', lfPost('alice', { intention: 'gaming', age: 22 })));
  await assertFails(lfCreate('alice', lfPost('alice', { intention: 'gaming', age: 41 })));
  await assertFails(lfCreate('alice', lfPost('alice', { intention: 'gaming', age: 17 })));
  await assertFails(lfCreate('alice', lfPost('alice', { intention: 'gaming', age: 30.5 })));
  await assertFails(lfCreate('alice', lfPost('alice', { intention: 'gaming', age: '30' })));
  await assertSucceeds(lfCreate('alice', lfPost('alice', { intention: 'gaming' })));
});

test('LF-04: NSFW is a flag with an optional, bounded warning that only exists when the flag is on', async () => {
  await assertSucceeds(lfCreate('alice', lfPost('alice', { intention: 'dating', isNsfw: true, contentWarning: 'Mature themes' })));
  await seedStamp('alice', 'lookingForPost', 61);
  await assertSucceeds(lfCreate('alice', lfPost('alice', { intention: 'gaming', isNsfw: true, contentWarning: null })));
  await seedStamp('alice', 'lookingForPost', 61);
  await assertFails(lfCreate('alice', lfPost('alice', { intention: 'talk', isNsfw: false, contentWarning: 'sneaky' })));
  await assertFails(lfCreate('alice', lfPost('alice', { intention: 'talk', isNsfw: true, contentWarning: 'x'.repeat(121) })));
  await assertFails(lfCreate('alice', lfPost('alice', { intention: 'talk', isNsfw: 'yes' })));
  await assertFails(lfCreate('alice', lfPost('alice', { intention: 'talk', isNsfw: true, contentWarning: 5 })));
});

test('LF-05: New posts are limited to one a minute, and a suspended member cannot post', async () => {
  await assertSucceeds(lfCreate('alice', lfPost('alice', { intention: 'dating' })));
  await assertFails(lfCreate('alice', lfPost('alice', { intention: 'friendship' })));
  await seedStamp('alice', 'lookingForPost', 61);
  await assertSucceeds(lfCreate('alice', lfPost('alice', { intention: 'friendship' })));
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('suspensions/bob').set({ source: 'admin', reason: 'test', createdAt: new Date() });
  });
  await assertFails(lfCreate('bob', lfPost('bob')));
});

test('LF-06: Only the author edits a post, and identity, intention and first-posted time never change', async () => {
  await seedLfPost('alice', 'friendship', { age: 30, flair: 'Masc × Femme' });
  const path = `looking_for_posts/${lfId('alice')}`;
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertSucceeds(alice.doc(path).update({ title: 'Updated', updatedAt: now() }));
  await assertFails(alice.doc(path).update({ title: 'No stamp' }));
  await assertFails(alice.doc(path).update({ intention: 'dating', updatedAt: now() }));
  await assertFails(alice.doc(path).update({ authorId: 'bob', updatedAt: now() }));
  await assertFails(alice.doc(path).update({ timestamp: now(), updatedAt: now() }));
  await assertFails(alice.doc(path).update({ age: 22, updatedAt: now() }));
  await assertSucceeds(alice.doc(path).update({ age: 30, updatedAt: now() }));
  await assertFails(alice.doc(path).update({ isNsfw: false, contentWarning: 'leftover', updatedAt: now() }));
  await assertFails(testEnv.authenticatedContext('bob').firestore().doc(path).update({ title: 'Hijack', updatedAt: now() }));
  await assertFails(testEnv.unauthenticatedContext().firestore().doc(path).update({ title: 'Hijack', updatedAt: now() }));
});

test('LF-07: The author or an admin can delete a post; nobody else can', async () => {
  await seedLfPost('alice');
  await seedLfPost('carol');
  await assertFails(testEnv.authenticatedContext('bob').firestore().doc(`looking_for_posts/${lfId('alice')}`).delete());
  await assertFails(testEnv.unauthenticatedContext().firestore().doc(`looking_for_posts/${lfId('alice')}`).delete());
  await assertSucceeds(testEnv.authenticatedContext('alice').firestore().doc(`looking_for_posts/${lfId('alice')}`).delete());
  await seedAdmin();
  await assertSucceeds(adminDb().doc(`looking_for_posts/${lfId('carol')}`).delete());
});

test('LF-08: Reports about a Looking For post are accepted from members, never readable by them', async () => {
  await seedLfPost('alice');
  const bob = testEnv.authenticatedContext('bob').firestore();
  await assertSucceeds(bob.collection('reports').add({ reporterId: 'bob', targetId: `looking_for:${lfId('alice')}`, targetType: 'post', reason: 'Spam, scam or solicitation', timestamp: now() }));
  await assertFails(bob.collection('reports').add({ reporterId: 'alice', targetId: `looking_for:${lfId('alice')}`, targetType: 'post', reason: 'forged reporter', timestamp: now() }));
  await assertFails(bob.collection('reports').get());
});

test('CR-01: Connection requests, their locks and the audit trail are closed to clients, even to the two people involved', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await fs.doc('connection_requests/req-1').set({ senderId: 'alice', recipientId: 'bob', lookingForPostId: 'p1', status: 'pending', message: 'hi' });
    await fs.doc('connection_request_locks/alice_bob').set({ state: 'pending' });
    await fs.doc('connection_request_events/e1').set({ requestId: 'req-1', actorId: 'alice', action: 'create' });
  });
  const alice = testEnv.authenticatedContext('alice').firestore();
  const bob = testEnv.authenticatedContext('bob').firestore();
  const carol = testEnv.authenticatedContext('carol').firestore();
  for (const db of [alice, bob, carol, testEnv.unauthenticatedContext().firestore()]) {
    await assertFails(db.doc('connection_requests/req-1').get());
    await assertFails(db.collection('connection_requests').get());
    await assertFails(db.doc('connection_request_locks/alice_bob').get());
    await assertFails(db.doc('connection_request_events/e1').get());
  }
  // Nobody can create a request, forge an acceptance, rewrite a participant, or clear a lock from a client.
  await assertFails(alice.doc('connection_requests/req-2').set({ senderId: 'alice', recipientId: 'bob', lookingForPostId: 'p1', status: 'pending' }));
  await assertFails(bob.doc('connection_requests/req-1').update({ status: 'accepted', conversationId: 'x' }));
  await assertFails(alice.doc('connection_requests/req-1').update({ status: 'withdrawn' }));
  await assertFails(alice.doc('connection_requests/req-1').update({ recipientId: 'carol' }));
  await assertFails(alice.doc('connection_requests/req-1').delete());
  await assertFails(alice.doc('connection_request_locks/alice_bob').delete());
  await assertFails(alice.doc('connection_request_events/e2').set({ requestId: 'req-1', action: 'accept' }));
});

test('CR-02: Admins can read the audit trail for moderation, but cannot write it, and cannot read or change requests directly', async () => {
  await seedAdmin();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('connection_request_events/e1').set({ requestId: 'req-1', actorId: 'alice', action: 'create' });
    await ctx.firestore().doc('connection_requests/req-1').set({ senderId: 'alice', recipientId: 'bob', status: 'pending' });
  });
  const admin = adminDb();
  await assertSucceeds(admin.doc('connection_request_events/e1').get());
  await assertFails(admin.doc('connection_request_events/e2').set({ requestId: 'req-1', action: 'x' }));
  await assertFails(admin.doc('connection_requests/req-1').get());
  await assertFails(admin.doc('connection_requests/req-1').update({ status: 'accepted' }));
});

test('LF-09: The author can pause and resume requests on their own post; nobody else can, and only a boolean is accepted', async () => {
  await seedLfPost('alice');
  const path = `looking_for_posts/${lfId('alice')}`;
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertSucceeds(alice.doc(path).update({ requestsPaused: true, updatedAt: now() }));
  await assertSucceeds(alice.doc(path).update({ requestsPaused: false, updatedAt: now() }));
  await assertFails(alice.doc(path).update({ requestsPaused: 'yes', updatedAt: now() }));
  await assertFails(alice.doc(path).update({ requestsPaused: 1, updatedAt: now() }));
  await assertFails(alice.doc(path).update({ requestsPaused: true }));
  await assertFails(testEnv.authenticatedContext('bob').firestore().doc(path).update({ requestsPaused: true, updatedAt: now() }));
  await assertFails(testEnv.unauthenticatedContext().firestore().doc(path).update({ requestsPaused: true, updatedAt: now() }));
  // A new post may be created already paused, but not with an invalid flag.
  await assertSucceeds(lfCreate('bob', lfPost('bob', { intention: 'gaming', requestsPaused: true })));
  await seedStamp('bob', 'lookingForPost', 61);
  await assertFails(lfCreate('bob', lfPost('bob', { intention: 'talk', requestsPaused: 'no' })));
});

// ------------------------------------------------------------------
// Age privacy and birthday integrity
// ------------------------------------------------------------------
const publicProfile = (extra: Record<string, unknown> = {}) => ({
  displayName: 'Alice', pronouns: 'she/her', intention: 'open', region: 'Anywhere', topics: [], profileComplete: true, updatedAt: new Date(), ...extra,
});

test('P-01: The public profile CANNOT carry an age, but CAN carry the Show my age switch', async () => {
  await reserveFor('alice', 'Alice');
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertFails(alice.doc('users/alice/public/profile').set(publicProfile({ age: 27 })));
  await assertSucceeds(alice.doc('users/alice/public/profile').set(publicProfile({ showAgeOnProfile: true })));
  await assertSucceeds(alice.doc('users/alice/public/profile').set(publicProfile({ showAgeOnProfile: false })));
  await assertFails(alice.doc('users/alice/public/profile').set(publicProfile({ showAgeOnProfile: 'yes' })));
});

test('P-02: A legacy age field can be cleared by a merge write (the client scrubs it on next save)', async () => {
  await testEnv.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('users/alice/public/profile').set(publicProfile({ age: 31 })));
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertSucceeds(alice.doc('users/alice/public/profile').set(publicProfile({ age: firebase.firestore.FieldValue.delete() }), { merge: true }));
  assert.equal((await alice.doc('users/alice/public/profile').get()).data()?.age, undefined);
});

test('P-03: Birthday is set once; a client CANNOT change it afterwards, and cannot set an under-18 one', async () => {
  const ref = (uid: string) => testEnv.authenticatedContext(uid).firestore().doc(`users/${uid}/private/settings`);
  const adult = new Date(Date.now() - 30 * 365 * 86400000);
  const other = new Date(Date.now() - 40 * 365 * 86400000);
  const base = { createdAt: new Date(), updatedAt: new Date() };
  await testEnv.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('users/zed/private/settings').set(base));
  await assertFails(ref('zed').update({ birthDate: new Date(), updatedAt: new Date() }));
  await assertSucceeds(ref('zed').update({ birthDate: adult, updatedAt: new Date() }));
  await assertFails(ref('zed').update({ birthDate: other, updatedAt: new Date() }));
  await assertFails(ref('zed').set({ ...base, birthDate: other }));
  // Saving other private fields alongside the same birthday still works.
  await assertSucceeds(ref('zed').update({ birthDate: adult, exactLocation: 'Cebu', updatedAt: new Date() }));
  await assertSucceeds(ref('zed').update({ exactLocation: 'Manila', updatedAt: new Date() }));
});

test('P-04: Private birthdays, age ranges, corrections, audit entries and rate limits are unreadable and unwritable from clients', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('matchPrefs/alice').set({ ageMin: 20, ageMax: 30 });
    await db.doc('birthdayCorrections/alice').set({ uid: 'alice', status: 'pending' });
    await db.doc('ageAudit/a1').set({ action: 'x' });
    await db.doc('apiRateLimits/alice_x').set({ start: 1, count: 1 });
  });
  for (const uid of ['alice', 'bob']) {
    const db = testEnv.authenticatedContext(uid).firestore();
    for (const path of ['matchPrefs/alice', 'birthdayCorrections/alice', 'ageAudit/a1', 'apiRateLimits/alice_x']) {
      await assertFails(db.doc(path).get());
      await assertFails(db.doc(path).set({ status: 'approved', ageMin: 18, ageMax: 99 }));
    }
  }
  // Another member cannot read your private settings (birthday).
  await assertFails(testEnv.authenticatedContext('bob').firestore().doc('users/alice/private/settings').get());
});

test('P-05: An under-18 account is blocked from queue, chat and posting by the eligibility rules', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('users/minor/public/profile').set(publicProfile({ displayName: 'minor' }));
    // A birthday that is not an adult one can only exist if written server-side or tampered with; rules still refuse access.
    await ctx.firestore().doc('users/minor/private/settings').set({ birthDate: new Date(Date.now() - 15 * 365 * 86400000), createdAt: new Date(), updatedAt: new Date() });
  });
  await assertFails(testEnv.authenticatedContext('minor').firestore().doc('match_queue/minor').set(waitingEntry()));
});

test('SG-01: Clients CANNOT write Signals or conversations directly, so a Signal cannot bypass the match check', async () => {
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertFails(alice.doc('signalsInvitations/inv1').set({ senderId: 'alice', recipientId: 'bob', status: 'pending', message: 'hi', createdAt: new Date() }));
  await assertFails(alice.doc('signalsPairs/pair1').set({ participants: ['alice', 'bob'], status: 'active', createdAt: new Date() }));
  await assertFails(alice.doc('signalsInbox/bob').set({ rev: 99, pending: { x: new Date() } }));
  await assertFails(alice.doc('conversations/fake-match').set({ participants: ['alice', 'bob'], status: 'active', createdAt: new Date(), updatedAt: new Date() }));
  await assertFails(alice.collection('signalsInvitations').get());
});

// ------------------------------------------------------------------
// Echoes are permanent
// ------------------------------------------------------------------
async function seedOldEcho(id: string, author: string, ageHours: number, extra: Record<string, unknown> = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`unsaid/${id}`).set({
      kind: 'confession', text: `echo ${id}`, createdAt: new Date(Date.now() - ageHours * HOUR), hugs: 0, same: 0, flags: 0, ...extra,
    });
    await ctx.firestore().doc(`unsaid_owners/${id}`).set({ authorId: author });
  });
}

test('EP-01: An Echo older than 48 hours (no expiry) stays readable, listed newest first, with no author exposed', async () => {
  await seedOldEcho('old-10d', 'alice', 24 * 10);
  await seedOldEcho('old-3d', 'bob', 24 * 3);
  await seedOldEcho('fresh', 'carol', 1);
  const dana = testEnv.authenticatedContext('dana').firestore();
  const snap = await assertSucceeds(dana.collection('unsaid').orderBy('createdAt', 'desc').limit(10).get());
  assert.deepEqual(snap.docs.map((d) => d.id), ['fresh', 'old-3d', 'old-10d']);
  for (const d of snap.docs) assert.equal('authorId' in d.data(), false, 'no author on a public Echo');
  // A range query (what the app's feed uses) works too.
  await assertSucceeds(
    dana.collection('unsaid').where('createdAt', '>=', new Date(Date.now() - 30 * 24 * HOUR)).orderBy('createdAt', 'desc').limit(5).get()
  );
  await assertFails(dana.doc('unsaid_owners/old-10d').get());
});

test('EP-02: The author CAN delete an old Echo; others CANNOT; an admin CAN (moderation)', async () => {
  await seedAdmin();
  await seedOldEcho('mine', 'alice', 24 * 20);
  await seedOldEcho('theirs', 'alice', 24 * 20);
  await seedOldEcho('flagged', 'bob', 24 * 40, { flags: 4 });
  const bob = testEnv.authenticatedContext('bob').firestore();
  await assertFails(bob.doc('unsaid/mine').delete());
  const alice = testEnv.authenticatedContext('alice').firestore();
  const batch = alice.batch();
  batch.delete(alice.doc('unsaid/mine'));
  batch.delete(alice.doc('unsaid_owners/mine'));
  await assertSucceeds(batch.commit());
  assert.equal((await adminDb().doc('unsaid/mine').get()).exists, false, 'removed Echoes stay removed');
  // Moderation: an admin removes someone else's old Echo; a plain member cannot.
  await assertFails(testEnv.authenticatedContext('eve').firestore().doc('unsaid/theirs').delete());
  await assertSucceeds(adminDb().doc('unsaid/flagged').delete());
  assert.equal((await adminDb().doc('unsaid/flagged').get()).exists, false);
  // Existing Echoes are untouched by all of this.
  assert.equal((await adminDb().doc('unsaid/theirs').get()).exists, true);
});

test('EP-03: A new Echo with an expiry outside the legacy 47-49 hour window is still refused', async () => {
  await assertFails(postUnsaidAs('alice', 'x1', { expiresAt: new Date(Date.now() + 5 * HOUR) }));
  await assertFails(postUnsaidAs('alice', 'x2', { expiresAt: new Date(Date.now() + 365 * 24 * HOUR) }));
  await assertSucceeds(postUnsaidAs('alice', 'x3'));
});

test('EP-04: Older app versions can still post with the legacy 48-hour expiry, and it is still honoured', async () => {
  await assertSucceeds(postUnsaidAs('alice', 'legacy1', { expiresAt: new Date(Date.now() + 48 * HOUR) }));
  const snap = await assertSucceeds(testEnv.authenticatedContext('bob').firestore().doc('unsaid/legacy1').get());
  assert.ok(snap.data()?.expiresAt, 'the expiry the writer chose is kept on the post');
});

// ---------------------------------------------------------------- What's New (app_updates)

const stamp = () => firebase.firestore.FieldValue.serverTimestamp();
const appUpdate = (over: Record<string, unknown> = {}) => ({
  title: 'Dark mode', body: 'Now in Settings.', category: 'feature', status: 'draft',
  createdAt: stamp(), updatedAt: stamp(), publishedAt: null, ...over,
});
const seedUpdates = () => testEnv.withSecurityRulesDisabled(async (ctx) => {
  const fs = ctx.firestore();
  const base = { title: 'Title', body: 'Body', category: 'fix', createdAt: new Date(), updatedAt: new Date() };
  await fs.doc('app_updates/pub').set({ ...base, status: 'published', publishedAt: new Date() });
  await fs.doc('app_updates/draft').set({ ...base, status: 'draft', publishedAt: null });
});

test('WN-01: Only an admin CAN create, publish, edit, unpublish and delete a draft', async () => {
  await seedAdmin();
  const admin = adminDb();
  await assertSucceeds(admin.doc('app_updates/n1').set(appUpdate()));
  await assertSucceeds(admin.doc('app_updates/n2').set(appUpdate({ status: 'published', publishedAt: stamp() })));
  await assertSucceeds(admin.doc('app_updates/n1').update({ status: 'published', publishedAt: stamp(), updatedAt: stamp() }));
  await assertSucceeds(admin.doc('app_updates/n1').update({ title: 'Dark mode is here', updatedAt: stamp() }));
  await assertSucceeds(admin.doc('app_updates/n1').update({ status: 'draft', updatedAt: stamp() }));
  await assertSucceeds(admin.doc('app_updates/n1').delete());
  // Published updates are unpublished first; they cannot be deleted outright.
  await assertFails(admin.doc('app_updates/n2').delete());
});

test('WN-02: Members and anonymous users CANNOT create, edit, publish or delete updates', async () => {
  await seedAdmin();
  await seedUpdates();
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertFails(alice.doc('app_updates/x').set(appUpdate()));
  await assertFails(alice.doc('app_updates/x').set(appUpdate({ status: 'published', publishedAt: stamp() })));
  await assertFails(alice.doc('app_updates/draft').update({ status: 'published', publishedAt: stamp(), updatedAt: stamp() }));
  await assertFails(alice.doc('app_updates/pub').update({ title: 'Hacked', updatedAt: stamp() }));
  await assertFails(alice.doc('app_updates/pub').delete());
  await assertFails(alice.doc('app_updates/draft').delete());
  // A non-Google account is never an admin, even if its uid has an admins doc.
  const notGoogle = testEnv.authenticatedContext('cha').firestore();
  await assertFails(notGoogle.doc('app_updates/x').set(appUpdate()));
  await assertFails(testEnv.unauthenticatedContext().firestore().doc('app_updates/x').set(appUpdate()));
});

test('WN-03: Members CAN read published updates but NOT drafts, and queries must ask for published only', async () => {
  await seedAdmin();
  await seedUpdates();
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertSucceeds(alice.doc('app_updates/pub').get());
  await assertFails(alice.doc('app_updates/draft').get());
  await assertSucceeds(alice.collection('app_updates').where('status', '==', 'published').get());
  await assertFails(alice.collection('app_updates').get());
  await assertFails(alice.collection('app_updates').where('status', '==', 'draft').get());
  await assertFails(testEnv.unauthenticatedContext().firestore().doc('app_updates/pub').get());
  const admin = adminDb();
  await assertSucceeds(admin.doc('app_updates/draft').get());
  await assertSucceeds(admin.collection('app_updates').get());
});

test('WN-04: Update content is validated (title, body, category, link, extra fields)', async () => {
  await seedAdmin();
  const admin = adminDb();
  await assertFails(admin.doc('app_updates/b1').set(appUpdate({ title: 'hi' })));
  await assertFails(admin.doc('app_updates/b2').set(appUpdate({ title: 'x'.repeat(81) })));
  await assertFails(admin.doc('app_updates/b3').set(appUpdate({ body: '' })));
  await assertFails(admin.doc('app_updates/b4').set(appUpdate({ body: 'x'.repeat(501) })));
  await assertFails(admin.doc('app_updates/b5').set(appUpdate({ category: 'spam' })));
  await assertFails(admin.doc('app_updates/b6').set(appUpdate({ status: 'archived' })));
  await assertFails(admin.doc('app_updates/b7').set(appUpdate({ extra: 'nope' })));
  await assertFails(admin.doc('app_updates/b8').set(appUpdate({ status: 'published', publishedAt: null })));
  await assertFails(admin.doc('app_updates/b9').set(appUpdate({ link: { url: 'http://x.com', label: 'Go' } })));
  await assertFails(admin.doc('app_updates/b10').set(appUpdate({ link: { url: 'javascript:alert(1)', label: 'Go' } })));
  await assertFails(admin.doc('app_updates/b11').set(appUpdate({ link: { url: 'https://x.com', label: '' } })));
  await assertFails(admin.doc('app_updates/b12').set(appUpdate({ link: { url: 'https://x.com', label: 'Go', extra: 1 } })));
  await assertSucceeds(admin.doc('app_updates/ok').set(appUpdate({ link: { url: 'https://example.com/a', label: 'Read more' } })));
});

test('WN-05: Read state is private: each member CAN write only their own, never another member', async () => {
  const alice = testEnv.authenticatedContext('alice').firestore();
  const bob = testEnv.authenticatedContext('bob').firestore();
  await assertSucceeds(alice.doc('app_update_reads/alice').set({ reads: { pub: true }, updatedAt: stamp() }, { merge: true }));
  await assertSucceeds(alice.doc('app_update_reads/alice').set({ reads: { other: true }, updatedAt: stamp() }, { merge: true }));
  const mine = await alice.doc('app_update_reads/alice').get();
  assert.deepEqual(Object.keys(mine.data()!.reads).sort(), ['other', 'pub']);
  await assertFails(bob.doc('app_update_reads/alice').get());
  await assertFails(bob.doc('app_update_reads/alice').set({ reads: { pub: true }, updatedAt: stamp() }));
  await assertFails(testEnv.unauthenticatedContext().firestore().doc('app_update_reads/alice').get());
  await assertFails(alice.doc('app_update_reads/alice').set({ reads: { pub: true }, updatedAt: stamp(), extra: 1 }));
  await assertFails(alice.doc('app_update_reads/alice').set({ reads: 'all', updatedAt: stamp() }));
  const many = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`u${i}`, true]));
  await assertFails(alice.doc('app_update_reads/alice').set({ reads: many, updatedAt: stamp() }));
});

// ---------------------------------------------------------------- Public room: member replies

const seedRoomOriginal = (id: string, over: Record<string, unknown> = {}) =>
  testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`public_room_messages/${id}`).set({ ...roomMessage('bob', { authorName: 'Bea', text: 'Anyone read anything good lately?' }), timestamp: new Date(), ...over });
  });
const memberReply = (uid: string, replyTo: unknown, over: Record<string, unknown> = {}) =>
  roomMessage(uid, { text: 'Yes! I loved it.', replyTo, ...over });

test('RR-01: A member CAN reply to an existing message, quoting it exactly', async () => {
  await seedRoomOriginal('orig1');
  await assertSucceeds(stampedAdd('alice', 'public_room_messages',
    memberReply('alice', { id: 'orig1', author: 'Bea', text: 'Anyone read anything good lately?' }), 'publicRoom'));
});

test('RR-02: A member reply CANNOT forge the author or the text, quote a missing message, or add extra fields', async () => {
  await seedRoomOriginal('orig1');
  const ok = { id: 'orig1', author: 'Bea', text: 'Anyone read anything good lately?' };
  const stamped = (reply: unknown, uid = 'alice') => stampedAdd(uid, 'public_room_messages', memberReply(uid, reply), 'publicRoom');
  await assertFails(stamped({ ...ok, author: 'Someone Else' }));
  await assertFails(stamped({ ...ok, text: 'I hate everyone here' }));
  await assertFails(stamped({ ...ok, id: 'does-not-exist' }));
  await assertFails(stamped({ ...ok, id: 'orig1/reactions/alice' }));
  await assertFails(stamped({ ...ok, extra: 1 }));
  await assertFails(stamped({ id: 'orig1', author: 'Bea' }));
  await assertFails(stamped('orig1'));
  await assertFails(stamped({ ...ok, text: 'x'.repeat(141) }));
  // Nothing else about the message can be bent: still your own id, still no admin/team flags.
  await assertFails(stampedAdd('alice', 'public_room_messages', memberReply('bob', ok), 'publicRoom'));
  await assertFails(stampedAdd('alice', 'public_room_messages', memberReply('alice', ok, { team: true }), 'publicRoom'));
});

test('RR-03: Replying to a long message quotes its first 140 characters; any other length is refused', async () => {
  await seedRoomOriginal('long1', { text: 'long '.repeat(60) });
  const author = 'Bea';
  await assertSucceeds(stampedAdd('alice', 'public_room_messages', memberReply('alice', { id: 'long1', author, text: ('long '.repeat(60)).slice(0, 140) }), 'publicRoom'));
  await assertFails(stampedAdd('carol', 'public_room_messages', memberReply('carol', { id: 'long1', author, text: 'long' }), 'publicRoom'));
});

test('RR-04: A suspended member CANNOT reply, and the slow mode still applies to replies', async () => {
  await seedRoomOriginal('orig1');
  const quote = { id: 'orig1', author: 'Bea', text: 'Anyone read anything good lately?' };
  await assertSucceeds(stampedAdd('dana', 'public_room_messages', memberReply('dana', quote), 'publicRoom'));
  await assertFails(stampedAdd('dana', 'public_room_messages', memberReply('dana', quote), 'publicRoom'));
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('suspensions/erin').set({ source: 'admin', reason: 'test', createdAt: new Date() });
  });
  await assertFails(stampedAdd('erin', 'public_room_messages', memberReply('erin', quote), 'publicRoom'));
});

// ---------------------------------------------------------------- Member activity (DAU, retention, source)

const manilaDay = (offsetDays = 0) => {
  const d = new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
};
const todayKey = () => `d${manilaDay()}`;
const activityDoc = (uid: string) => testEnv.authenticatedContext(uid).firestore().doc(`member_activity/${uid}`);

test('MA-01: A member CAN create their own activity record for today, with or without a source', async () => {
  await assertSucceeds(activityDoc('alice').set({ firstDay: manilaDay(), days: { [todayKey()]: true } }));
  await assertSucceeds(activityDoc('bob').set({ firstDay: manilaDay(), days: { [todayKey()]: true }, source: 'tiktok' }));
});

test('MA-02: A record CANNOT claim another day, another member, an unknown source or extra data', async () => {
  const today = { firstDay: manilaDay(), days: { [todayKey()]: true } };
  await assertFails(activityDoc('alice').set({ firstDay: manilaDay(-3), days: { [`d${manilaDay(-3)}`]: true } }));
  await assertFails(activityDoc('alice').set({ firstDay: manilaDay(), days: { [`d${manilaDay(-1)}`]: true } }));
  await assertFails(activityDoc('alice').set({ firstDay: manilaDay(), days: { [todayKey()]: true, [`d${manilaDay(-1)}`]: true } }));
  await assertFails(activityDoc('alice').set({ ...today, source: 'myspace' }));
  await assertFails(activityDoc('alice').set({ ...today, displayName: 'Willow' }));
  await assertFails(testEnv.authenticatedContext('bob').firestore().doc('member_activity/alice').set(today));
  await assertFails(testEnv.authenticatedContext('nobody').firestore().doc('member_activity/nobody').set(today));
});

test('MA-03: Later days CAN add today only; firstDay, source and earlier days never change', async () => {
  await testEnv.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('member_activity/carol').set({
    firstDay: manilaDay(-5), days: { [`d${manilaDay(-5)}`]: true, [`d${manilaDay(-2)}`]: true }, source: 'reddit',
  }));
  const carol = activityDoc('carol');
  await assertFails(carol.update({ [`days.d${manilaDay(-1)}`]: true }));
  await assertFails(carol.update({ firstDay: manilaDay() }));
  await assertFails(carol.update({ source: 'facebook' }));
  await assertFails(carol.update({ [`days.d${manilaDay(-2)}`]: false }));
  await assertFails(carol.update({ [`days.${todayKey()}`]: false }));
  await assertSucceeds(carol.update({ [`days.${todayKey()}`]: true }));
  await assertFails(carol.delete());
});

test('MA-04: Only the member and admins CAN read an activity record; an admin CAN count them', async () => {
  await testEnv.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('member_activity/dana').set({ firstDay: manilaDay(), days: { [todayKey()]: true } }));
  await assertSucceeds(activityDoc('dana').get());
  await assertFails(testEnv.authenticatedContext("eve").firestore().doc("member_activity/dana").get());
  await assertFails(testEnv.authenticatedContext('eve').firestore().collection('member_activity').get());
  await seedAdmin();
  await assertSucceeds(adminDb().collection('member_activity').where(`days.${todayKey()}`, '==', true).get());
});

test('MA-05: A member who is not eligible yet (no completed profile) CANNOT record activity', async () => {
  await testEnv.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('users/newbie/public/profile').set({ displayName: 'n', pronouns: 'she/her', intention: 'open', region: 'x', topics: [], updatedAt: new Date() }));
  await assertFails(testEnv.authenticatedContext('newbie').firestore().doc('member_activity/newbie').set({ firstDay: manilaDay(), days: { [todayKey()]: true } }));
});

test('MA-06: There is no cap on days: a long-standing record keeps accepting today', async () => {
  const days: Record<string, boolean> = {};
  for (let k = 1; k <= 600; k++) days[`d${manilaDay(-k)}`] = true;
  await testEnv.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('member_activity/erin').set({ firstDay: manilaDay(-600), days }));
  await assertSucceeds(activityDoc('erin').update({ [`days.${todayKey()}`]: true }));
});

test('MA-07: Nobody can touch another member\'s record: no update, delete or overwrite, signed in or not', async () => {
  await testEnv.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('member_activity/fay').set({ firstDay: manilaDay(-2), days: { [`d${manilaDay(-2)}`]: true }, source: 'tiktok' }));
  const bob = testEnv.authenticatedContext('bob').firestore();
  await assertFails(bob.doc('member_activity/fay').update({ [`days.${todayKey()}`]: true }));
  await assertFails(bob.doc('member_activity/fay').update({ source: 'reddit' }));
  await assertFails(bob.doc('member_activity/fay').delete());
  await assertFails(bob.doc('member_activity/fay').set({ firstDay: manilaDay(), days: { [todayKey()]: true } }));
  const anon = testEnv.unauthenticatedContext().firestore();
  await assertFails(anon.doc('member_activity/fay').get());
  await assertFails(anon.doc('member_activity/fay').update({ [`days.${todayKey()}`]: true }));
  // Admins can read for analytics but cannot write or delete a member's record.
  await seedAdmin();
  await assertSucceeds(adminDb().doc('member_activity/fay').get());
  await assertFails(adminDb().doc('member_activity/fay').update({ source: 'direct' }));
  await assertFails(adminDb().doc('member_activity/fay').delete());
});

test('MA-08: Malformed records are refused: days that are not true, not a map, or the wrong shape', async () => {
  await assertFails(activityDoc('gail').set({ firstDay: manilaDay(), days: { [todayKey()]: false } }));
  await assertFails(activityDoc('gail').set({ firstDay: manilaDay(), days: { [todayKey()]: 'yes' } }));
  await assertFails(activityDoc('gail').set({ firstDay: manilaDay(), days: [todayKey()] }));
  await assertFails(activityDoc('gail').set({ firstDay: String(manilaDay()), days: { [todayKey()]: true } }));
  await assertFails(activityDoc('gail').set({ days: { [todayKey()]: true } }));
  await assertFails(activityDoc('gail').set({ firstDay: manilaDay(), days: {} }));
  await assertSucceeds(activityDoc('gail').set({ firstDay: manilaDay(), days: { [todayKey()]: true } }));
  // Once created, it cannot be replaced with a fresh first day.
  await assertFails(activityDoc('gail').set({ firstDay: manilaDay(), days: { [todayKey()]: true }, source: 'reddit' }));
});

// ---------------------------------------------------------------- Activity analytics: unique members, not member-days
// These run the dashboard's own query code (src/services/adminGrowthService.ts) against the emulator as an admin.

const modularAdminDb = () => (adminDb() as unknown as { _delegate: import('firebase/firestore').Firestore })._delegate;
const activitySeed = (uid: string, agoDays: number[], source?: string) =>
  testEnv.withSecurityRulesDisabled((ctx) => ctx.firestore().doc(`member_activity/${uid}`).set({
    firstDay: manilaDay(-Math.max(...agoDays)),
    days: Object.fromEntries(agoDays.map((k) => [`d${manilaDay(-k)}`, true])),
    ...(source ? { source } : {}),
  }));

test('MA-09: WAU and MAU count each member once, however many days they were active', async () => {
  await seedAdmin();
  await activitySeed('m1', [0, 1, 3, 10], 'tiktok'); // four active days: in the week and the month, once
  await activitySeed('m2', [5, 6]);                 // two days, both this week
  await activitySeed('m3', [8, 9, 15], 'tiktok');   // never this week, once this month
  await activitySeed('m4', [40]);                   // outside the month
  await activitySeed('m5', [0], 'reddit');          // new today
  const stats = await loadActivityStats(14, true, Date.now(), modularAdminDb());
  assert.equal(stats.dau, 2);          // m1, m5
  assert.equal(stats.dauYesterday, 1); // m1
  assert.equal(stats.wau, 3);          // m1, m2, m5   (6 member-days would be wrong)
  assert.equal(stats.mau, 4);          // m1, m2, m3, m5 (10 member-days would be wrong)
  assert.equal(stats.returningWeek, 1);  // m1: active this week, first counted before it (m2 first counted 6 days ago = inside the window)
  assert.equal(stats.returningMonth, 0); // everyone active this month was first counted this month
  assert.equal(stats.tracked, 5);
  assert.equal(stats.trackingSince, manilaDay(-40));
  assert.equal(stats.dauDays.length, 14);
  assert.equal(stats.dauDays[stats.dauDays.length - 1].count, 2);
  assert.equal(stats.dauDays[stats.dauDays.length - 2].count, 1);
  assert.equal(stats.dauDays[stats.dauDays.length - 4].count, 1); // 3 days ago: m1
  const bySource = Object.fromEntries(stats.sources.map((s) => [s.source, s.count]));
  assert.deepEqual([bySource.tiktok, bySource.reddit, bySource.unknown], [2, 1, 2]);
});

test('MA-10: Retention counts a cohort only once its windows are complete', async () => {
  await seedAdmin();
  for (let k = 0; k < 8; k++) {
    const ago = [20];
    if (k < 6) ago.push(19);   // 6 of 8 back on day 1
    if (k < 3) ago.push(13);   // 3 of 8 back on day 7
    await activitySeed(`c${k}`, ago);
  }
  const rows = await loadRetention(manilaDay(-20), true, Date.now(), modularAdminDb());
  const first = rows.find((r) => r.from === manilaDay(-20))!;
  assert.equal(first.size, 8);
  assert.equal(first.rates[1], 75);
  assert.equal(first.rates[7], 38);
  assert.equal(first.rates[14], null); // day 14 of the last cohort day is today: not finished
  assert.equal(first.rates[30], null);
});

// ---------------------------------------------------------------- Separate Suggestions and Reports pages: statuses

test('IN-01: An admin CAN move a suggestion through every suggestion status, and only those', async () => {
  await seedAdmin();
  await seedInbox();
  const s1 = adminDb().doc('suggestions/s1');
  for (const status of ['reviewed', 'in_progress', 'implemented', 'archived', 'open', 'done']) await assertSucceeds(s1.update({ status }));
  for (const status of ['reviewing', 'resolved', 'dismissed', 'banned', '', 5]) await assertFails(s1.update({ status }));
});

test('IN-02: An admin CAN move a report through every report status, and only those', async () => {
  await seedAdmin();
  await seedInbox();
  const r1 = adminDb().doc('reports/r1');
  for (const status of ['reviewing', 'resolved', 'dismissed', 'open', 'done']) await assertSucceeds(r1.update({ status }));
  for (const status of ['reviewed', 'in_progress', 'implemented', 'archived', 'banned']) await assertFails(r1.update({ status }));
});

test('IN-03: Members CANNOT set a status, read the inbox, or change a submission, and still CAN submit', async () => {
  await seedInbox();
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertFails(alice.doc('suggestions/s1').update({ status: 'reviewed' }));
  await assertFails(alice.doc('reports/r1').update({ status: 'resolved' }));
  await assertFails(alice.collection('reports').get());
  await assertFails(testEnv.authenticatedContext('bob').firestore().collection('suggestions').get());
  // A new submission carries no status (it counts as New / Open); a member cannot send one with a status.
  await assertFails(stampedAdd('carol', 'suggestions', { ...suggestion('carol'), status: 'implemented' }, 'suggestion'));
  await assertSucceeds(stampedAdd('carol', 'suggestions', suggestion('carol'), 'suggestion'));
});

test('IN-04: An admin CAN read the newest-first window the live listeners use', async () => {
  await seedAdmin();
  await seedInbox();
  const cha = adminDb();
  await assertSucceeds(cha.collection('suggestions').orderBy('createdAt', 'desc').limit(200).get());
  await assertSucceeds(cha.collection('reports').orderBy('timestamp', 'desc').limit(200).get());
  await assertFails(testEnv.authenticatedContext('alice').firestore().collection('reports').orderBy('timestamp', 'desc').limit(200).get());
});

test('MQ-01: The match audit notes, and the private age ranges, can never be read or written from the app, by members or admins', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('matchAudit/c1').set({ participants: ['alice', 'bob'], ageChecked: true });
    await ctx.firestore().doc('matchPrefs/alice').set({ ageMin: 25, ageMax: 35 });
  });
  await seedAdmin();
  for (const db of [testEnv.authenticatedContext('alice').firestore(), testEnv.authenticatedContext('bob').firestore(), adminDb()]) {
    await assertFails(db.doc('matchAudit/c1').get());
    await assertFails(db.doc('matchAudit/c2').set({ ageChecked: true }));
    await assertFails(db.doc('matchAudit/c1').delete());
    await assertFails(db.doc('matchPrefs/alice').get());
    await assertFails(db.doc('matchPrefs/alice').set({ ageMin: 18, ageMax: 99 }));
  }
});

// ------------------------------------------------------------------
// Pseudonym reservations: displayName can only change to the name the server reserved for the account
// ------------------------------------------------------------------
const profileBody = (displayName: string) => ({
  displayName, pronouns: 'she/her', intention: 'open', region: 'Anywhere', topics: [], profileComplete: true, updatedAt: new Date(),
});
const reserveFor = (uid: string, name: string) =>
  testEnv.withSecurityRulesDisabled((ctx) => ctx.firestore().doc(`pseudonymOwners/${uid}`).set({ key: name.toLowerCase(), name, updatedAt: new Date() }));

test('PS-01: a first profile needs the reserved name; an unreserved or someone else\'s name is refused', async () => {
  const ivy = testEnv.authenticatedContext('ivy').firestore();
  await assertFails(ivy.doc('users/ivy/public/profile').set(profileBody('VelvetMuse')));
  await reserveFor('ivy', 'VelvetMuse');
  await assertFails(ivy.doc('users/ivy/public/profile').set(profileBody('DreamyFox')));
  await assertFails(testEnv.authenticatedContext('eve').firestore().doc('users/eve/public/profile').set(profileBody('VelvetMuse')));
  await assertSucceeds(ivy.doc('users/ivy/public/profile').set(profileBody('VelvetMuse')));
});

test('PS-02: existing members with an unregistered name can still edit everything but the name', async () => {
  await seedEligibleMember('alice'); // profile says "alice", no reservation exists
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertSucceeds(alice.doc('users/alice/public/profile').set({ ...profileBody('alice'), aboutMe: 'hello', region: 'Cebu' }, { merge: true }));
  await assertSucceeds(alice.doc('users/alice/public/profile').update({ pronouns: 'they/them', updatedAt: new Date() }));
});

test('PS-03: changing the name needs a reservation for exactly that name', async () => {
  await seedEligibleMember('bob');
  const bob = testEnv.authenticatedContext('bob').firestore();
  await assertFails(bob.doc('users/bob/public/profile').update({ displayName: 'ChaoticCupid', updatedAt: new Date() }));
  await reserveFor('bob', 'ChaoticCupid');
  await assertFails(bob.doc('users/bob/public/profile').update({ displayName: 'chaoticcupid', updatedAt: new Date() }));
  await assertSucceeds(bob.doc('users/bob/public/profile').update({ displayName: 'ChaoticCupid', updatedAt: new Date() }));
});

test('PS-04: clients cannot read or write reservations to give themselves a name', async () => {
  await reserveFor('carol', 'SoftMuse');
  const dave = testEnv.authenticatedContext('dave').firestore();
  await assertFails(dave.doc('pseudonyms/softmuse').set({ uid: 'dave', name: 'SoftMuse' }));
  await assertFails(dave.doc('pseudonymOwners/dave').set({ key: 'x', name: 'Whatever' }));
  await assertFails(dave.doc('pseudonymOwners/carol').get());
  await assertFails(dave.doc('pseudonyms/softmuse').get());
  await assertFails(dave.doc('users/dave/public/profile').set(profileBody('SoftMuse')));
});

// ------------------------------------------------------------------
// Looking For discovery: a new member who never posted can browse everyone else's posts
// ------------------------------------------------------------------
const FEED_QUERIES = (fs: any) => [
  ['all', fs.collection('looking_for_posts').orderBy('timestamp', 'desc').limit(60)],
  ['one intention', fs.collection('looking_for_posts').where('intention', '==', 'friendship').orderBy('timestamp', 'desc').limit(60)],
] as const;

test('LF-D1: a newly registered eligible member with no post of their own sees an established member\'s post, with the exact queries the app runs', async () => {
  await seedEligibleMember('established');
  await seedEligibleMember('newcomer', new Date(Date.now() - 19 * 365.25 * 86400000));
  await assertSucceeds(lfCreate('established', lfPost('established')));
  const own = testEnv.authenticatedContext('established').firestore();
  for (const [name, q] of FEED_QUERIES(own)) {
    const snap: any = await assertSucceeds(q.get());
    assert.deepEqual(snap.docs.map((d: any) => d.id), [lfId('established')], `the author sees their own post (${name})`);
  }
  const newcomer = testEnv.authenticatedContext('newcomer').firestore();
  for (const [name, q] of FEED_QUERIES(newcomer)) {
    const snap: any = await assertSucceeds(q.get());
    assert.deepEqual(snap.docs.map((d: any) => d.id), [lfId('established')], `the newcomer sees it too (${name})`);
    assert.equal(snap.docs[0].data().authorId, 'established');
  }
  const opened = await assertSucceeds(newcomer.doc(`looking_for_posts/${lfId('established')}`).get());
  assert.equal(opened.data()?.title, 'Coffee and books?', 'and can open it and read its public fields');
  const json = JSON.stringify(opened.data());
  for (const secret of ['birthDate', 'blockedPartnerIds', 'exactLocation']) assert.equal(json.includes(secret), false, secret);
});

test('LF-D2: the newcomer cannot edit or delete the established member\'s post, and cannot post in their name', async () => {
  await seedEligibleMember('established');
  await seedEligibleMember('newcomer');
  await seedLfPost('established');
  const newcomer = testEnv.authenticatedContext('newcomer').firestore();
  const path = `looking_for_posts/${lfId('established')}`;
  await assertFails(newcomer.doc(path).update({ title: 'hijacked', updatedAt: now() }));
  await assertFails(newcomer.doc(path).delete());
  await assertFails(lfCreate('newcomer', lfPost('established'), lfId('established')));
  assert.equal(((await testEnv.authenticatedContext('established').firestore().doc(path).get()).data() as any).title, 't', 'the post is untouched');
});

test('LF-D3: reading still needs an eligible account: signed-out, minors, incomplete profiles and members with no birthday on file are refused, not shown an empty board', async () => {
  await seedEligibleMember('established');
  await seedLfPost('established');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('users/nobirthday/private/settings').set({ createdAt: new Date(), updatedAt: new Date() });
    await db.doc('users/nobirthday/public/profile').set({ displayName: 'nb', profileComplete: true, updatedAt: new Date() });
    await db.doc('users/minor2/private/settings').set({ birthDate: new Date(Date.now() - 16 * 365 * 86400000), createdAt: new Date(), updatedAt: new Date() });
    await db.doc('users/minor2/public/profile').set({ displayName: 'm', profileComplete: true, updatedAt: new Date() });
    await db.doc('users/incomplete/private/settings').set({ birthDate: new Date(Date.now() - 30 * 365 * 86400000), createdAt: new Date(), updatedAt: new Date() });
    await db.doc('users/incomplete/public/profile').set({ displayName: 'i', profileComplete: false, updatedAt: new Date() });
  });
  for (const who of ['nobirthday', 'minor2', 'incomplete']) {
    await assertFails(FEED_QUERIES(testEnv.authenticatedContext(who).firestore())[0][1].get());
  }
  await assertFails(FEED_QUERIES(testEnv.unauthenticatedContext().firestore())[0][1].get());
});

test('LF-D4: a suspended account keeps the existing restrictions: it cannot post or edit, while the board stays readable', async () => {
  await seedEligibleMember('established');
  await seedEligibleMember('suspended1');
  await seedLfPost('suspended1');
  await testEnv.withSecurityRulesDisabled(async (ctx) => { await ctx.firestore().doc('suspensions/suspended1').set({ reason: 'test', at: new Date() }); });
  const fs = testEnv.authenticatedContext('suspended1').firestore();
  await assertFails(fs.doc(`looking_for_posts/${lfId('suspended1')}`).update({ title: 'still here', updatedAt: now() }));
  await assertFails(lfCreate('suspended1', lfPost('suspended1', { intention: 'dating' })));
});

test('LF-D5: an empty board is a successful empty answer, not a permission error', async () => {
  await seedEligibleMember('newcomer');
  const snap: any = await assertSucceeds(FEED_QUERIES(testEnv.authenticatedContext('newcomer').firestore())[0][1].get());
  assert.equal(snap.empty, true);
});

// ------------------------------------------------------------------
// Looking For: a required age (from the private birthday) and a flair
// ------------------------------------------------------------------
const FLAIRS = ['Masc × Femme', 'Masc × Masc', 'Masc × Any', 'Femme × Masc', 'Femme × Femme', 'Femme × Any', 'Andro × Masc', 'Andro × Femme', 'Andro × Any', 'Trans Femme × Masc', 'Trans Femme × Femme', 'Trans Femme × Any', 'All WLW'];
const withoutKey = (data: Record<string, unknown>, key: string) => { const copy = { ...data }; delete copy[key]; return copy; };

test('LF-F1: a valid post with an age that matches the private birthday and a listed flair is created, for every flair', async () => {
  for (const [i, flair] of FLAIRS.entries()) {
    const uid = `flairer${i}`;
    await seedEligibleMember(uid);
    await assertSucceeds(lfCreate(uid, lfPost(uid, { flair })));
    const stored = (await testEnv.authenticatedContext('bob').firestore().doc(`looking_for_posts/${lfId(uid)}`).get()).data() as any;
    assert.equal(stored.flair, flair);
    assert.equal(stored.age, 30);
    assert.equal(stored.title, 'Coffee and books?', 'the stored title is only what was typed');
  }
});

test('LF-F2: a new post without an age, or without a flair, is refused', async () => {
  await assertFails(lfCreate('alice', withoutKey(lfPost('alice'), 'age')));
  await assertFails(lfCreate('alice', withoutKey(lfPost('alice'), 'flair')));
  await assertFails(lfCreate('alice', withoutKey(withoutKey(lfPost('alice'), 'flair'), 'age')));
});

test('LF-F3: an invented, misspelled or wrongly typed flair is refused', async () => {
  for (const flair of ['Everyone', 'Masc x Femme', 'masc × femme', 'Femme × Femme ', '', 'All wlw', 5, null, ['All WLW']]) {
    await assertFails(lfCreate('alice', lfPost('alice', { flair })));
  }
});

test('LF-F4: the age must be the account\'s own: a different age, an under-18 age and a non-integer are refused', async () => {
  await assertFails(lfCreate('alice', lfPost('alice', { age: 25 })), );
  await assertFails(lfCreate('alice', lfPost('alice', { age: 35 })));
  await assertFails(lfCreate('alice', lfPost('alice', { age: 17 })));
  await assertFails(lfCreate('alice', lfPost('alice', { age: 30.5 })));
  await assertFails(lfCreate('alice', lfPost('alice', { age: '30' })));
  await assertFails(lfCreate('alice', lfPost('alice', { age: 100 })));
  await assertSucceeds(lfCreate('alice', lfPost('alice', { age: 30 })));
});

test('LF-F5: an under-18 account and a member with no birthday on file cannot post at all, whatever age they claim', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('users/teen/private/settings').set({ birthDate: new Date(Date.now() - 16 * 365.25 * 86400000), createdAt: new Date(), updatedAt: new Date() });
    await db.doc('users/teen/public/profile').set({ displayName: 'teen', profileComplete: true, updatedAt: new Date() });
    await db.doc('users/nobday/private/settings').set({ createdAt: new Date(), updatedAt: new Date() });
    await db.doc('users/nobday/public/profile').set({ displayName: 'nobday', profileComplete: true, updatedAt: new Date() });
  });
  await assertFails(lfCreate('teen', lfPost('teen', { age: 16 })));
  await assertFails(lfCreate('teen', lfPost('teen', { age: 18 })), );
  await assertFails(lfCreate('nobday', lfPost('nobday', { age: 30 })));
});

test('LF-F6: nobody can change another member\'s age or flair, and an author cannot swap in a false age on edit', async () => {
  await seedLfPost('alice', 'friendship', { age: 30, flair: 'Masc × Femme' });
  const path = `looking_for_posts/${lfId('alice')}`;
  const bob = testEnv.authenticatedContext('bob').firestore();
  await assertFails(bob.doc(path).update({ age: 99, updatedAt: now() }));
  await assertFails(bob.doc(path).update({ flair: 'All WLW', updatedAt: now() }));
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertFails(alice.doc(path).update({ age: 22, updatedAt: now() }));
  await assertFails(alice.doc(path).update({ flair: 'Not a flair', updatedAt: now() }));
  await assertSucceeds(alice.doc(path).update({ flair: 'All WLW', updatedAt: now() }));
  assert.equal(((await alice.doc(path).get()).data() as any).flair, 'All WLW');
});

test('LF-F7: posts made before flairs existed stay readable, can be paused and resumed, and need an age and flair to be edited', async () => {
  await seedEligibleMember('veteran');
  await seedLfPost('veteran', 'friendship');
  const path = `looking_for_posts/${lfId('veteran')}`;
  const old = (await testEnv.authenticatedContext('bob').firestore().doc(path).get()).data() as any;
  assert.equal(old.flair, undefined);
  assert.equal(old.age, undefined);
  const veteran = testEnv.authenticatedContext('veteran').firestore();
  await assertSucceeds(veteran.doc(path).update({ requestsPaused: true, updatedAt: now() }));
  await assertSucceeds(veteran.doc(path).update({ requestsPaused: false, updatedAt: now() }));
  await assertFails(veteran.doc(path).update({ title: 'edited without a flair', updatedAt: now() }));
  await assertSucceeds(veteran.doc(path).update({ title: 'edited with a flair', age: 30, flair: 'Femme × Any', updatedAt: now() }));
  const feed = await assertSucceeds(testEnv.authenticatedContext('bob').firestore().collection('looking_for_posts').orderBy('timestamp', 'desc').limit(60).get()) as any;
  assert.equal(feed.docs.length, 1);
});

test('LF-F8: adult eligibility and suspension still apply to posting with an age and flair', async () => {
  await seedEligibleMember('susp');
  await testEnv.withSecurityRulesDisabled(async (ctx) => { await ctx.firestore().doc('suspensions/susp').set({ reason: 'test', at: new Date() }); });
  await assertFails(lfCreate('susp', lfPost('susp')));
  await assertFails(lfCreate('alice', lfPost('bob')));
  await assertFails(testEnv.unauthenticatedContext().firestore().doc(`looking_for_posts/${lfId('alice')}`).set(lfPost('alice')));
});

// ------------------------------------------------------------------
// Looking For: NSFW Connection
// ------------------------------------------------------------------
test('LF-N1: an eligible adult can post an NSFW Connection, and it is always mature', async () => {
  await assertSucceeds(lfCreate('alice', lfPost('alice', { intention: 'nsfw', isNsfw: true, contentWarning: 'Mature themes' })));
  await assertSucceeds(lfCreate('bob', lfPost('bob', { intention: 'nsfw', isNsfw: true })));
  await assertFails(lfCreate('carol', lfPost('carol', { intention: 'nsfw', isNsfw: false })), );
  await assertFails(lfCreate('dana', lfPost('dana', { intention: 'nsfw', isNsfw: false, contentWarning: null })));
  await assertFails(lfCreate('eve', lfPost('eve', { intention: 'nsfw', isNsfw: 'true' })));
  const stored = (await testEnv.authenticatedContext('bob').firestore().doc(`looking_for_posts/${lfId('alice', 'nsfw')}`).get()).data() as any;
  assert.equal(stored.intention, 'nsfw');
  assert.equal(stored.isNsfw, true);
});

test('LF-N2: the id stays derived from the member and intention, and an NSFW Connection cannot be made under another member\'s id or another intention', async () => {
  await assertFails(lfCreate('alice', lfPost('alice', { intention: 'nsfw', isNsfw: true }), lfId('alice', 'dating')));
  await assertFails(lfCreate('alice', lfPost('alice', { intention: 'nsfw', isNsfw: true }), lfId('bob', 'nsfw')));
  await assertFails(lfCreate('alice', lfPost('alice', { intention: 'adult', isNsfw: true }), lfId('alice', 'adult')));
  await assertSucceeds(lfCreate('alice', lfPost('alice', { intention: 'dating' })));
  await assertSucceeds(lfCreate('bob', lfPost('bob', { intention: 'nsfw', isNsfw: true })));
});

test('LF-N3: ineligible accounts can neither post nor read NSFW Connection posts', async () => {
  await seedLfPost('alice', 'nsfw', { isNsfw: true, age: 30, flair: 'Masc × Femme' });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('users/teen2/private/settings').set({ birthDate: new Date(Date.now() - 16 * 365.25 * 86400000), createdAt: new Date(), updatedAt: new Date() });
    await db.doc('users/teen2/public/profile').set({ displayName: 'teen2', profileComplete: true, updatedAt: new Date() });
    await db.doc('users/nobday2/private/settings').set({ createdAt: new Date(), updatedAt: new Date() });
    await db.doc('users/nobday2/public/profile').set({ displayName: 'nobday2', profileComplete: true, updatedAt: new Date() });
    await db.doc('users/draft2/private/settings').set({ birthDate: new Date(Date.now() - 30 * 365.25 * 86400000), createdAt: new Date(), updatedAt: new Date() });
    await db.doc('users/draft2/public/profile').set({ displayName: 'draft2', profileComplete: false, updatedAt: new Date() });
    await db.doc('suspensions/susp2').set({ reason: 'test', at: new Date() });
  });
  await seedEligibleMember('susp2');
  const board = (fs: any) => fs.collection('looking_for_posts').where('intention', '==', 'nsfw').orderBy('timestamp', 'desc').limit(60).get();
  for (const who of ['teen2', 'nobday2', 'draft2']) {
    const fs = testEnv.authenticatedContext(who).firestore();
    await assertFails(board(fs));
    await assertFails(fs.doc(`looking_for_posts/${lfId('alice', 'nsfw')}`).get());
    await assertFails(lfCreate(who, lfPost(who, { intention: 'nsfw', isNsfw: true, age: 18 })));
  }
  await assertFails(board(testEnv.unauthenticatedContext().firestore()));
  await assertFails(lfCreate('susp2', lfPost('susp2', { intention: 'nsfw', isNsfw: true })));
  const eligible: any = await assertSucceeds(board(testEnv.authenticatedContext('bob').firestore()));
  assert.deepEqual(eligible.docs.map((d: any) => d.id), [lfId('alice', 'nsfw')]);
});

test('LF-N4: only the author edits or deletes it, and an edit cannot turn the mature mark off', async () => {
  await seedLfPost('alice', 'nsfw', { isNsfw: true, age: 30, flair: 'Masc × Femme' });
  const path = `looking_for_posts/${lfId('alice', 'nsfw')}`;
  const alice = testEnv.authenticatedContext('alice').firestore();
  const bob = testEnv.authenticatedContext('bob').firestore();
  await assertFails(bob.doc(path).update({ title: 'Hijack', updatedAt: now() }));
  await assertFails(bob.doc(path).delete());
  await assertFails(alice.doc(path).update({ isNsfw: false, contentWarning: null, updatedAt: now() }));
  await assertFails(alice.doc(path).update({ intention: 'dating', updatedAt: now() }));
  await assertSucceeds(alice.doc(path).update({ title: 'Edited', updatedAt: now() }));
  await assertSucceeds(alice.doc(path).update({ requestsPaused: true, updatedAt: now() }));
  await assertSucceeds(alice.doc(path).delete());
});

test('LF-N5: posts from the existing intentions are untouched: an NSFW mark is still optional on them', async () => {
  for (const [i, intention] of ['dating', 'friendship', 'talk', 'gaming', 'open'].entries()) {
    const uid = ['alice', 'bob', 'carol', 'dana', 'eve'][i];
    await assertSucceeds(lfCreate(uid, lfPost(uid, { intention, isNsfw: false })));
  }
  await assertSucceeds(lfCreate('fay', lfPost('fay', { intention: 'dating', isNsfw: true, contentWarning: null })));
});

// ------------------------------------------------------------------
// Looking For: About me / About you minimums (100 trimmed characters)
// ------------------------------------------------------------------
const chars = (n: number) => 'a'.repeat(n);

test('LF-M1: a new post needs at least 100 characters in each of About me and About you', async () => {
  assert.ok(LF_ME.length >= 100 && LF_YOU.length >= 100);
  await assertSucceeds(lfCreate('alice', lfPost('alice', { intro: chars(100), lookingFor: chars(100) })));
  await assertFails(lfCreate('bob', lfPost('bob', { intro: chars(99) })));
  await assertFails(lfCreate('carol', lfPost('carol', { lookingFor: chars(99) })));
  await assertFails(lfCreate('dana', lfPost('dana', { intro: 'short', lookingFor: 'short' })));
  await assertFails(lfCreate('eve', lfPost('eve', { intro: '', lookingFor: chars(100) })));
});

test('LF-M2: padding does not count: the stored text must already be trimmed, so the length is the real length', async () => {
  await assertFails(lfCreate('alice', lfPost('alice', { intro: '  ' + chars(98) })));
  await assertFails(lfCreate('bob', lfPost('bob', { lookingFor: chars(98) + '  ' })));
  await assertFails(lfCreate('carol', lfPost('carol', { intro: ' ' + chars(100) + ' ' })));
  await assertFails(lfCreate('dana', lfPost('dana', { intro: ' '.repeat(100) })));
  await assertSucceeds(lfCreate('eve', lfPost('eve', { intro: 'a' + ' '.repeat(98) + 'b' })));
  await assertSucceeds(lfCreate('fay', lfPost('fay', { intro: chars(50) + '\n' + chars(50) })), );
});

test('LF-M3: the maximums stay: 400 characters is allowed, 401 is not', async () => {
  await assertSucceeds(lfCreate('alice', lfPost('alice', { intro: chars(400), lookingFor: chars(400) })));
  await assertFails(lfCreate('bob', lfPost('bob', { intro: chars(401) })));
  await assertFails(lfCreate('carol', lfPost('carol', { lookingFor: chars(401) })));
});

test('LF-M4: older posts with short sections stay readable and keep working, and an edit of a section must meet the minimum', async () => {
  await seedLfPost('alice', 'friendship', { intro: 'short intro', lookingFor: 'short ask', age: 30, flair: 'Masc × Femme' });
  const path = `looking_for_posts/${lfId('alice')}`;
  const alice = testEnv.authenticatedContext('alice').firestore();
  const read = (await testEnv.authenticatedContext('bob').firestore().doc(path).get()).data() as any;
  assert.equal(read.intro, 'short intro');
  await assertSucceeds(alice.doc(path).update({ requestsPaused: true, updatedAt: now() }));
  await assertSucceeds(alice.doc(path).update({ title: 'A new title', updatedAt: now() }));
  await assertFails(alice.doc(path).update({ intro: 'still short', updatedAt: now() }));
  await assertFails(alice.doc(path).update({ lookingFor: chars(99), updatedAt: now() }));
  await assertSucceeds(alice.doc(path).update({ intro: LF_ME, lookingFor: LF_YOU, updatedAt: now() }));
});

// ------------------------------------------------------------------
// Opening one community post from a profile link
// ------------------------------------------------------------------
test('PL-01: a signed-in member can read one original post by id, and a signed-out visitor cannot', async () => {
  await seedCommunityPost('orig1', 'alice', { likes: 3, replyCount: 2 });
  const doc = await assertSucceeds(testEnv.authenticatedContext('bob').firestore().doc('community_posts/orig1').get()) as any;
  assert.equal(doc.exists, true);
  assert.equal(doc.data().authorId, 'alice');
  assert.equal(doc.data().likes, 3);
  assert.equal(doc.data().replyCount, 2);
  await assertFails(testEnv.unauthenticatedContext().firestore().doc('community_posts/orig1').get());
});

test('PL-02: a deleted post reads as "does not exist", not as an error, and cannot be brought back by a reader', async () => {
  await seedCommunityPost('gone1', 'alice');
  await assertSucceeds(testEnv.authenticatedContext('alice').firestore().doc('community_posts/gone1').delete());
  const bob = testEnv.authenticatedContext('bob').firestore();
  const doc = await assertSucceeds(bob.doc('community_posts/gone1').get()) as any;
  assert.equal(doc.exists, false);
  await assertFails(bob.doc('community_posts/gone1').set(communityPost('alice')));
});

test('PL-03: engaging with the opened post changes the original and creates no copy and no duplicate record', async () => {
  await seedCommunityPost('orig2', 'alice');
  await seedStamp('bob', 'communityReply', 10);
  await assertSucceeds(replyAs('bob', 'orig2'));
  const posts = await assertSucceeds(testEnv.authenticatedContext('carol').firestore().collection('community_posts').get()) as any;
  assert.deepEqual(posts.docs.map((d: any) => d.id), ['orig2'], 'still exactly one post');
  const original = (await testEnv.authenticatedContext('carol').firestore().doc('community_posts/orig2').get()).data() as any;
  assert.equal(original.replyCount, 1);
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const replies = await ctx.firestore().collection('community_posts/orig2/replies').get();
    assert.equal(replies.size, 1, 'one reply record');
  });
});

// ------------------------------------------------------------------
// Stardust: reactions and counters are written only by /api/stardust (Admin SDK); rules keep every client out
// ------------------------------------------------------------------
const SD_KINDS = [
  { label: 'community', seed: (author: string) => seedCommunityPost('p1', author), post: (author: string) => 'community_posts/p1' },
  { label: 'lookingFor', seed: (author: string) => seedLfPost(author, 'friendship'), post: (author: string) => `looking_for_posts/${lfId(author)}` },
];

for (const kind of SD_KINDS) {
  test(`SD-01 (${kind.label}): no client can create, change or delete a Stardust reaction, even their own`, async () => {
    await kind.seed('alice');
    const path = kind.post('alice');
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc(`${path}/stardust/bob`).set({ uid: 'bob', postType: kind.label, createdAt: now() }));
    await assertFails(bob.doc(`${path}/stardust/alice`).set({ uid: 'alice', postType: kind.label, createdAt: now() }));
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`${path}/stardust/bob`).set({ uid: 'bob', postType: kind.label, createdAt: new Date() });
    });
    await assertFails(bob.doc(`${path}/stardust/bob`).update({ postType: 'other' }));
    await assertFails(bob.doc(`${path}/stardust/bob`).delete());
  });

  test(`SD-02 (${kind.label}): a reaction is private to the member who gave it`, async () => {
    await kind.seed('alice');
    const path = kind.post('alice');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`${path}/stardust/bob`).set({ uid: 'bob', postType: kind.label, createdAt: new Date() });
    });
    await assertSucceeds(testEnv.authenticatedContext('bob').firestore().doc(`${path}/stardust/bob`).get());
    await assertFails(testEnv.authenticatedContext('alice').firestore().doc(`${path}/stardust/bob`).get());
    await assertFails(testEnv.authenticatedContext('eve').firestore().collection(`${path}/stardust`).get());
    await assertFails(testEnv.unauthenticatedContext().firestore().doc(`${path}/stardust/bob`).get());
  });

  test(`SD-03 (${kind.label}): nobody can write stardustCount, by itself or alongside another change`, async () => {
    await kind.seed('alice');
    const path = kind.post('alice');
    const fv = firebase.firestore.FieldValue;
    for (const uid of ['alice', 'bob']) {
      const fs = testEnv.authenticatedContext(uid).firestore();
      await assertFails(fs.doc(path).update({ stardustCount: 500 }));
      await assertFails(fs.doc(path).update({ stardustCount: fv.increment(1) }));
    }
    if (kind.label === 'community') {
      const bob = testEnv.authenticatedContext('bob').firestore();
      const batch = bob.batch();
      batch.update(bob.doc(path), { replyCount: fv.increment(1), stardustCount: 9 });
      batch.set(bob.doc('rate_limits/bob'), { communityReply: now() }, { merge: true });
      await assertFails(batch.commit());
    }
  });
}

test('SD-04: a new post cannot be created with a Stardust count, in either section', async () => {
  await assertFails(stampedAdd('alice', 'community_posts', communityPost('alice', { stardustCount: 50 }), 'communityPost'));
  await assertFails(lfCreate('alice', lfPost('alice', { stardustCount: 50 })));
  await assertSucceeds(lfCreate('alice', lfPost('alice')));
});

test('SD-05: a Looking For author can still edit a post that carries Stardust, but cannot change the count', async () => {
  await seedLfPost('alice', 'friendship', { age: 30, flair: 'Masc × Femme', stardustCount: 7 });
  const path = `looking_for_posts/${lfId('alice')}`;
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertSucceeds(alice.doc(path).update({ title: 'A new title', updatedAt: now() }));
  await assertSucceeds(alice.doc(path).update({ requestsPaused: true, updatedAt: now() }));
  await assertFails(alice.doc(path).update({ title: 'Again', stardustCount: 99, updatedAt: now() }));
  await assertFails(alice.doc(path).update({ stardustCount: 8, updatedAt: now() }));
  const after = (await testEnv.authenticatedContext('bob').firestore().doc(path).get()).data() as any;
  assert.equal(after.stardustCount, 7);
});

test('SD-05b: a Looking For author cannot remove the count or stamp migration/reaction fields on their own post', async () => {
  await seedLfPost('alice', 'friendship', { age: 30, flair: 'Masc × Femme', stardustCount: 7 });
  const path = `looking_for_posts/${lfId('alice')}`;
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertFails(alice.doc(path).update({ stardustCount: firebase.firestore.FieldValue.delete(), updatedAt: now() }));
  await assertFails(alice.doc(path).update({ stardustMigratedAt: now(), updatedAt: now() }));
  await assertFails(alice.doc(path).update({ stardustCount: firebase.firestore.FieldValue.increment(1), updatedAt: now() }));
  const bob = testEnv.authenticatedContext('bob').firestore();
  await assertFails(bob.doc(path).update({ stardustCount: 8 }));
  await assertFails(bob.doc(path).delete());
  const after = (await bob.doc(path).get()).data() as any;
  assert.equal(after.stardustCount, 7);
  assert.equal(after.stardustMigratedAt, undefined);
});

test('SD-05c: nobody can stamp a Community post as migrated or change it beyond the reply counter', async () => {
  await seedCommunityPost('p1', 'alice');
  for (const uid of ['alice', 'bob']) {
    const fs = testEnv.authenticatedContext(uid).firestore();
    await assertFails(fs.doc('community_posts/p1').update({ stardustMigratedAt: now() }));
    await assertFails(fs.doc('community_posts/p1').update({ stardustCount: firebase.firestore.FieldValue.delete() }));
  }
});

test('SD-05d: the reconcile cursor is closed to every client', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('stardust_meta/reconcile').set({ phase: 0, after: null, cycle: 1 });
  });
  for (const uid of ['alice', 'bob']) {
    const fs = testEnv.authenticatedContext(uid).firestore();
    await assertFails(fs.doc('stardust_meta/reconcile').get());
    await assertFails(fs.doc('stardust_meta/reconcile').set({ phase: 2, after: 'x', cycle: 99 }));
    await assertFails(fs.doc('stardust_meta/reconcile').delete());
  }
  await assertFails(testEnv.unauthenticatedContext().firestore().doc('stardust_meta/reconcile').get());
});

test('SD-06: profile totals can be read by signed-in members only and written by nobody', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('stardust_totals/alice').set({ total: 12, updatedAt: new Date() });
  });
  await assertSucceeds(testEnv.authenticatedContext('bob').firestore().doc('stardust_totals/alice').get());
  await assertFails(testEnv.unauthenticatedContext().firestore().doc('stardust_totals/alice').get());
  for (const uid of ['alice', 'bob']) {
    const fs = testEnv.authenticatedContext(uid).firestore();
    await assertFails(fs.doc('stardust_totals/alice').set({ total: 9999 }));
    await assertFails(fs.doc('stardust_totals/alice').update({ total: 9999 }));
    await assertFails(fs.doc('stardust_totals/alice').delete());
    await assertFails(fs.doc(`stardust_totals/${uid}`).set({ total: 1 }));
  }
});

test('SD-07: an admin can clear reactions only once the post is gone', async () => {
  await seedCommunityPost('p1', 'alice');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('community_posts/p1/stardust/bob').set({ uid: 'bob', postType: 'community', createdAt: new Date() });
  });
  await seedAdmin();
  await assertFails(adminDb().doc('community_posts/p1/stardust/bob').delete());
  await testEnv.withSecurityRulesDisabled(async (ctx) => { await ctx.firestore().doc('community_posts/p1').delete(); });
  await assertFails(testEnv.authenticatedContext('eve').firestore().doc('community_posts/p1/stardust/bob').delete());
  await assertSucceeds(adminDb().doc('community_posts/p1/stardust/bob').delete());
});

test('SD-08: legacy likes stay readable history: nobody can add or remove one', async () => {
  await seedCommunityPost('p1', 'alice', { likes: 1 });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('community_posts/p1/likes/bob').set({ createdAt: new Date() });
  });
  await assertSucceeds(testEnv.authenticatedContext('bob').firestore().doc('community_posts/p1/likes/bob').get());
  await assertFails(testEnv.authenticatedContext('carol').firestore().doc('community_posts/p1/likes/carol').set({ createdAt: now() }));
  await assertFails(testEnv.authenticatedContext('bob').firestore().doc('community_posts/p1/likes/bob').delete());
});

// ------------------------------------------------------------------
// Signals timed photos: records and messages are server-only
// ------------------------------------------------------------------
test('PH-01: no client can read, write or list timed-photo records, and message documents stay closed too', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('signalsMedia/m1').set({ pairId: 'p1', messageId: 'x1', senderId: 'alice', recipientId: 'bob', key: 'm/secret', state: 'unopened' });
    await ctx.firestore().doc('signalsPairs/p1/messages/x1').set({ senderId: 'alice', kind: 'photo', mediaId: 'm1', durationSec: 3 });
  });
  for (const who of ['alice', 'bob', 'carol']) {
    const fs = testEnv.authenticatedContext(who).firestore();
    await assertFails(fs.doc('signalsMedia/m1').get());
    await assertFails(fs.collection('signalsMedia').get());
    await assertFails(fs.doc('signalsMedia/m1').update({ state: 'viewing' }));
    await assertFails(fs.doc('signalsMedia/m1').set({ key: 'm/other' }));
    await assertFails(fs.doc('signalsMedia/m1').delete());
    await assertFails(fs.doc('signalsPairs/p1/messages/x1').get());
    await assertFails(fs.doc('signalsPairs/p1/messages/x1').update({ durationSec: 99 }));
  }
  await assertFails(testEnv.unauthenticatedContext().firestore().doc('signalsMedia/m1').get());
});

test('GIF-01: no client can create, change, read or delete a GIF message; only the Signals API can', async () => {
  const gif = { id: 'abc123XYZ', url: 'https://media.giphy.com/media/abc123XYZ/giphy.gif', previewUrl: 'https://media.giphy.com/media/abc123XYZ/200w.gif', width: 400, height: 300 };
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('signalsPairs/p1').set({ participants: ['alice', 'bob'], status: 'active' });
    await ctx.firestore().doc('signalsPairs/p1/messages/g1').set({ senderId: 'alice', kind: 'gif', text: 'GIF', gif });
  });
  for (const who of ['alice', 'bob', 'carol']) {
    const fs = testEnv.authenticatedContext(who).firestore();
    await assertFails(fs.doc('signalsPairs/p1/messages/g2').set({ senderId: who, kind: 'gif', text: 'GIF', gif: { ...gif, url: 'https://evil.example/x.gif' } }));
    await assertFails(fs.doc('signalsPairs/p1/messages/g2').set({ senderId: who, kind: 'gif', text: 'GIF', gif }));
    await assertFails(fs.doc('signalsPairs/p1/messages/g1').update({ gif: { ...gif, url: 'https://evil.example/x.gif' } }));
    await assertFails(fs.doc('signalsPairs/p1/messages/g1').delete());
    await assertFails(fs.doc('signalsPairs/p1/messages/g1').get());
  }
  await assertFails(testEnv.unauthenticatedContext().firestore().doc('signalsPairs/p1/messages/g1').get());
});

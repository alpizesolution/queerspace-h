import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import fs from 'node:fs';
import test, { before, after, beforeEach } from 'node:test';
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

test('T-11: User CAN create valid like document for themselves', async () => {
  const alice = testEnv.authenticatedContext('alice');
  await assertSucceeds(
    alice.firestore().doc('community_posts/post1/likes/alice').set({
      createdAt: new Date(),
    })
  );
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
// Suggestions
// ------------------------------------------------------------------
const suggestion = (authorId: string, overrides: Record<string, unknown> = {}) => ({
  authorId,
  category: 'idea',
  text: 'Add voice notes to chat',
  createdAt: new Date(),
  ...overrides,
});

test('S-01: Signed-in user CAN send a valid suggestion as themselves', async () => {
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertSucceeds(alice.collection('suggestions').add(suggestion('alice')));
});

test('S-02: Suggestions CANNOT be spoofed, malformed or sent signed-out', async () => {
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertFails(alice.collection('suggestions').add(suggestion('bob')));
  await assertFails(alice.collection('suggestions').add(suggestion('alice', { category: 'spam' })));
  await assertFails(alice.collection('suggestions').add(suggestion('alice', { text: 'x'.repeat(1001) })));
  await assertFails(alice.collection('suggestions').add(suggestion('alice', { email: 'a@b.c' })));
  const anon = testEnv.unauthenticatedContext().firestore();
  await assertFails(anon.collection('suggestions').add(suggestion('alice')));
});

test('S-03: Nobody CAN read, edit or delete suggestions from the app', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('suggestions/s1').set(suggestion('alice'));
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
    text: 'I never told anyone I like her',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 48 * HOUR),
    hugs: 0,
    same: 0,
    flags: 0,
    ...overrides,
  });
  batch.set(fs.doc(`unsaid_owners/${id}`), { authorId: uid });
  return batch.commit();
}

async function seedUnsaid(id: string, author: string, counts: Record<string, number> = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`unsaid/${id}`).set({
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

function reactAs(uid: string, id: string, type: 'hugs' | 'same', bump = 1) {
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
  const alice = testEnv.authenticatedContext('alice').firestore();
  await assertFails(
    alice.doc('unsaid/p5').set({
      text: 'no owner', createdAt: firebase.firestore.FieldValue.serverTimestamp(),
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

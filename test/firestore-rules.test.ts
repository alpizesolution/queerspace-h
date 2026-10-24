import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import fs from 'node:fs';
import test, { before, after, beforeEach } from 'node:test';

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

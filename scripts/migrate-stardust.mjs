// One-time, idempotent Admin SDK migration from Community likes to Stardust. NOT run automatically: a person runs it.
//
//   node scripts/migrate-stardust.mjs --dry-run     reads everything, writes nothing, prints the report
//   node scripts/migrate-stardust.mjs               migrates
//   node scripts/migrate-stardust.mjs --verify      read-only audit of counts and totals against the reaction documents
//   node scripts/migrate-stardust.mjs --rollback [--dry-run]   removes what this migration created (see docs/stardust.md)
//
// What it does, per Community post, in ONE transaction (so it is safe next to live traffic):
//   1. reads the real community_posts/{id}/likes/{uid} documents (the old counter is never trusted),
//   2. creates community_posts/{id}/stardust/{uid} for each liker that has none yet (the document id is the member, so a
//      member can only ever be there once), skipping the author's own like (own posts cannot take Stardust),
//   3. sets stardustCount to the number of real reaction documents and moves the author's stardust_totals/{authorId}.total
//      by the difference between that and the count the post had, so the total stays equal to the sum of the counts,
//   4. stamps the post with stardustMigratedAt. A stamped post is never touched again, so running twice cannot duplicate
//      anything, and a member who later removes their Stardust is not given it back by a re-run.
// The old likes documents and the old `likes` counters are left exactly as they were. Looking For posts are not touched:
// they start at 0 and no history is invented. Credentials: FIREBASE_SERVICE_ACCOUNT_JSON (never printed) or the emulator.
import { pathToFileURL } from 'node:url';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const PAGE = 200;
/** A transaction holds at most 500 writes; one is the post and one the total. */
export const MAX_NEW_REACTIONS = 480;

const count = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
const validUid = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('/');
const millis = (value) => (typeof value?.toMillis === 'function' ? value.toMillis() : null);

/**
 * What migrating one post would do, from what was read. Pure, so it is easy to test.
 * `likes` and `existing` are lists of { id, createdAt }.
 */
export function planPost({ post, likes, existing }) {
  const authorId = post?.authorId;
  if (!validUid(authorId)) return { skip: 'no_author' };
  const stored = count(post.stardustCount);
  const have = new Set(existing.map((e) => e.id).filter((id) => id !== authorId));
  const invalid = [];
  let selfLikes = 0;
  const toCreate = [];
  const seen = new Set();
  for (const like of likes) {
    if (!validUid(like.id)) { invalid.push(like.id); continue; }
    if (like.id === authorId) { selfLikes++; continue; }
    if (seen.has(like.id)) continue; // a document id is unique already; this just keeps the rule explicit
    seen.add(like.id);
    if (!have.has(like.id)) toCreate.push(like);
  }
  const actual = have.size + toCreate.length;
  return {
    authorId, stored, actual, delta: actual - stored, toCreate,
    selfLikes, invalid, alreadyPresent: seen.size - toCreate.length,
    likesCounter: count(post.likes), likeDocs: likes.length,
  };
}

const newReport = (mode) => ({
  mode, postsProcessed: 0, postsMigrated: 0, postsAlreadyMigrated: 0, postsSkipped: 0,
  reactionsMigrated: 0, reactionsAlreadyPresent: 0, selfLikesSkipped: 0, invalidLikesSkipped: 0,
  authorsUpdated: 0, pointsAdded: 0, counterDiscrepancies: [], skipped: [], errors: [],
});

async function* postPages(db) {
  let last = null;
  for (;;) {
    let q = db.collection('community_posts').orderBy('__name__').limit(PAGE);
    if (last) q = q.startAfter(last);
    const page = await q.get();
    if (page.empty) return;
    yield page.docs;
    last = page.docs[page.docs.length - 1];
    if (page.size < PAGE) return;
  }
}

const likesOf = (snap) => snap.docs.map((d) => ({ id: d.id, createdAt: d.data()?.createdAt ?? null }));
const existingOf = (snap) => snap.docs.map((d) => ({ id: d.id }));

export async function migrateStardust(db, { dryRun = false } = {}) {
  const report = newReport(dryRun ? 'dry-run' : 'migrate');
  const authors = new Set();
  for await (const docs of postPages(db)) {
    for (const doc of docs) {
      report.postsProcessed++;
      const postId = doc.id;
      if (doc.data().stardustMigratedAt) { report.postsAlreadyMigrated++; continue; }
      try {
        const outcome = await db.runTransaction(async (tx) => {
          const [postSnap, likesSnap, stardustSnap] = await Promise.all([
            tx.get(doc.ref), tx.get(doc.ref.collection('likes')), tx.get(doc.ref.collection('stardust')),
          ]);
          if (!postSnap.exists) return { skip: 'gone' };
          if (postSnap.data().stardustMigratedAt) return { skip: 'already' };
          const plan = planPost({ post: postSnap.data(), likes: likesSnap.docs.map((d) => ({ id: d.id, createdAt: d.data()?.createdAt ?? null })), existing: existingOf(stardustSnap) });
          if (plan.skip) return plan;
          if (plan.toCreate.length > MAX_NEW_REACTIONS) return { skip: 'too_many_likes', likeDocs: plan.likeDocs };
          if (dryRun) return plan;
          const totalRef = db.doc(`stardust_totals/${plan.authorId}`);
          const totalSnap = await tx.get(totalRef);
          const postTimestamp = millis(postSnap.data().timestamp);
          for (const like of plan.toCreate) {
            tx.create(doc.ref.collection('stardust').doc(like.id), {
              uid: like.id, postType: 'community', authorId: plan.authorId,
              createdAt: like.createdAt ?? FieldValue.serverTimestamp(),
              ...(postTimestamp !== null ? { postTimestamp } : {}),
              migratedFrom: 'likes',
            });
          }
          tx.update(doc.ref, { stardustCount: plan.actual, stardustMigratedAt: FieldValue.serverTimestamp() });
          if (plan.delta !== 0) {
            tx.set(totalRef, { total: Math.max(0, count(totalSnap.data()?.total) + plan.delta), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          }
          return plan;
        });
        if (outcome.skip === 'already') { report.postsAlreadyMigrated++; continue; }
        if (outcome.skip) {
          report.postsSkipped++;
          report.skipped.push({ postId, reason: outcome.skip, ...(outcome.likeDocs ? { likeDocs: outcome.likeDocs } : {}) });
          continue;
        }
        report.postsMigrated++;
        report.reactionsMigrated += outcome.toCreate.length;
        report.reactionsAlreadyPresent += outcome.alreadyPresent;
        report.selfLikesSkipped += outcome.selfLikes;
        report.invalidLikesSkipped += outcome.invalid.length;
        if (outcome.delta !== 0) { authors.add(outcome.authorId); report.pointsAdded += outcome.delta; }
        // The old counter is only reported, never used: the real like documents decide.
        if (outcome.likesCounter !== outcome.likeDocs) report.counterDiscrepancies.push({ postId, oldLikesCounter: outcome.likesCounter, realLikeDocuments: outcome.likeDocs });
      } catch (error) {
        report.errors.push({ postId, error: String(error?.message ?? error).slice(0, 200) });
      }
    }
  }
  report.authorsUpdated = authors.size;
  return report;
}

/**
 * Undoes this migration only: removes the reactions it created (migratedFrom === 'likes'), takes their points back from the
 * post and the author, and clears the stamp so the migration can run again. Stardust members gave themselves is kept.
 */
export async function rollbackStardust(db, { dryRun = false } = {}) {
  const report = { ...newReport(dryRun ? 'rollback-dry-run' : 'rollback'), reactionsRemoved: 0 };
  const authors = new Set();
  for await (const docs of postPages(db)) {
    for (const doc of docs) {
      report.postsProcessed++;
      if (!doc.data().stardustMigratedAt) { report.postsSkipped++; continue; }
      try {
        const removed = await db.runTransaction(async (tx) => {
          const [postSnap, migrated] = await Promise.all([tx.get(doc.ref), tx.get(doc.ref.collection('stardust').where('migratedFrom', '==', 'likes'))]);
          if (!postSnap.exists || !postSnap.data().stardustMigratedAt) return null;
          const authorId = postSnap.data().authorId;
          const n = migrated.size;
          if (dryRun) return { authorId, n };
          const totalRef = db.doc(`stardust_totals/${authorId}`);
          const totalSnap = await tx.get(totalRef);
          migrated.docs.forEach((d) => tx.delete(d.ref));
          tx.update(doc.ref, { stardustCount: Math.max(0, count(postSnap.data().stardustCount) - n), stardustMigratedAt: FieldValue.delete() });
          if (n > 0) tx.set(totalRef, { total: Math.max(0, count(totalSnap.data()?.total) - n), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          return { authorId, n };
        });
        if (!removed) { report.postsSkipped++; continue; }
        report.postsMigrated++;
        report.reactionsRemoved += removed.n;
        if (removed.n > 0) authors.add(removed.authorId);
      } catch (error) {
        report.errors.push({ postId: doc.id, error: String(error?.message ?? error).slice(0, 200) });
      }
    }
  }
  report.authorsUpdated = authors.size;
  return report;
}

/**
 * Read-only audit. Every post's stardustCount against the reaction documents that belong to that post version (a reaction left
 * over from an earlier version of a re-posted Looking For post is not counted), and every author's total against the sum of
 * the counts on the posts they have now. Reactions of deleted posts and stale ones are reported as leftovers, not as errors.
 */
export async function verifyStardust(db) {
  const perPost = new Map();
  const postDocs = new Map();
  const authorSums = new Map();
  const result = { postsChecked: 0, postCountMismatches: [], totalsChecked: 0, totalMismatches: [], orphanReactionDocs: 0, staleReactionDocs: 0 };
  for (const collection of ['community_posts', 'looking_for_posts']) {
    for (const doc of (await db.collection(collection).select('stardustCount', 'authorId', 'timestamp').get()).docs) {
      postDocs.set(doc.ref.path, { stamp: millis(doc.data().timestamp), count: count(doc.data().stardustCount), raw: doc.data().stardustCount, collection });
      const authorId = doc.data().authorId;
      if (validUid(authorId)) authorSums.set(authorId, (authorSums.get(authorId) ?? 0) + count(doc.data().stardustCount));
    }
  }
  for (const doc of (await db.collectionGroup('stardust').get()).docs) {
    const parent = doc.ref.parent.parent;
    const post = parent && postDocs.get(parent.path);
    if (!post) { result.orphanReactionDocs++; continue; }
    const stamp = doc.data()?.postTimestamp;
    if (stamp !== undefined && stamp !== post.stamp) { result.staleReactionDocs++; continue; }
    perPost.set(parent.path, (perPost.get(parent.path) ?? 0) + 1);
  }
  for (const [path, post] of postDocs) {
    result.postsChecked++;
    const actual = perPost.get(path) ?? 0;
    // A community post not yet migrated legitimately has no stardustCount and no reactions: the migration is what fills it.
    if (post.count !== actual && !(post.collection === 'community_posts' && post.raw === undefined && actual === 0)) {
      result.postCountMismatches.push({ post: path, stardustCount: post.count, reactionDocuments: actual });
    }
  }
  const totals = new Map((await db.collection('stardust_totals').get()).docs.map((d) => [d.id, count(d.data().total)]));
  for (const authorId of new Set([...totals.keys(), ...authorSums.keys()])) {
    result.totalsChecked++;
    const stored = totals.get(authorId) ?? 0;
    const actual = authorSums.get(authorId) ?? 0;
    if (stored !== actual) result.totalMismatches.push({ authorId, total: stored, sumOfLivePosts: actual });
  }
  return result;
}

function getDb() {
  if (getApps().length) return getFirestore();
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return getFirestore(initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-queerspace-test' }));
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Set FIREBASE_SERVICE_ACCOUNT_JSON (or use the emulator).');
  const credentials = JSON.parse(raw);
  return getFirestore(initializeApp({ credential: cert(credentials), projectId: credentials.project_id }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  const run = process.argv.includes('--verify')
    ? verifyStardust(getDb())
    : process.argv.includes('--rollback')
      ? rollbackStardust(getDb(), { dryRun })
      : migrateStardust(getDb(), { dryRun });
  run
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (result.errors?.length) process.exitCode = 1;
    })
    .catch((error) => {
      console.error('Migration failed:', error.message);
      process.exitCode = 1;
    });
}

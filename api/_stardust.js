// Stardust: the one appreciation system for Cosmos posts (Community and Looking For). Everything here runs on the server
// with the Admin SDK; clients can neither write reactions nor counters (firestore.rules), so points only ever move here.
//
// Data (see docs/stardust.md):
//   {community_posts|looking_for_posts}/{postId}/stardust/{uid}   one reaction per member per post (the doc id IS the member,
//                                                                 so a second reaction by the same member cannot exist)
//   {community_posts|looking_for_posts}/{postId}.stardustCount    that post's count, kept in step with the reaction docs
//   stardust_totals/{authorId}.total                              the author's single, unified total across both post types
// Giving and removing are "set the state" operations, so a repeated request is a no-op instead of a second point.
// Underscore-prefixed files in api/ are not deployed as separate functions.
import { FieldValue } from 'firebase-admin/firestore';
import { isAdultMember } from './_adult.js';
import { rateLimit } from './_lib.js';
import { createKeyedQueue, withContentionRetry } from './_requests.js';

export const POST_COLLECTIONS = { community: 'community_posts', lookingFor: 'looking_for_posts' };
/** Reactions a member can change per minute across all posts. Well above normal use, low enough to stop scripted spam. */
export const STARDUST_ACTIONS_PER_MINUTE = 30;
export const STARDUST_STATE_PER_MINUTE = 60;
/** How many posts one feed can ask about at once; matches the feed page sizes (60). */
export const STATE_MAX_POSTS = 60;

const fail = (statusCode, code) => Object.assign(new Error(code), { statusCode });
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const millis = value => (typeof value?.toMillis === 'function' ? value.toMillis() : null);
/**
 * A Looking For post id is derived (member + intention), so a post deleted and written again has the same id and the old
 * reaction documents are still under it. A reaction counts only for the post version it was given to, which is recorded as
 * the post's timestamp; one without that record (older data) is taken as current.
 */
const isCurrent = (reactionData, postData) => reactionData?.postTimestamp === undefined || reactionData.postTimestamp === millis(postData?.timestamp);
const count = value => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
const blockedEither = (a, b, aId, bId) =>
  (Array.isArray(a?.blockedPartnerIds) && a.blockedPartnerIds.includes(bId)) || (Array.isArray(b?.blockedPartnerIds) && b.blockedPartnerIds.includes(aId));

export const postRef = (db, postType, postId) => db.doc(`${POST_COLLECTIONS[postType]}/${postId}`);
export const reactionRef = (db, postType, postId, uid) => db.doc(`${POST_COLLECTIONS[postType]}/${postId}/stardust/${uid}`);
export const totalRef = (db, authorId) => db.doc(`stardust_totals/${authorId}`);

export function validTarget(postType, postId) {
  if (typeof postType !== 'string' || !Object.hasOwn(POST_COLLECTIONS, postType) || !safeId(postId)) throw fail(400, 'invalid_request');
}

/**
 * Requests that change the same author's numbers take turns on one server instance. Every give and remove writes the
 * author's single total document, so queueing per post would still let requests for two posts of one author collide
 * (measured: 40 simultaneous gives over 4 posts of one author took 34 s with half aborted; queued per author they do not collide).
 */
const authorQueue = createKeyedQueue();
/** Runs `task` in an author's lane, so work that touches the same author's total (a give, a remove, a reconcile) takes turns. */
export const inAuthorLane = (authorId, task) => authorQueue.run(`author:${authorId}`, task);
/** One member's requests take turns for the rate-limit step (it is a read-then-write on one document). */
const memberQueue = createKeyedQueue();

/** One transaction attempt: the caller (withContentionRetry) owns the retrying so the whole request has a time budget. */
const once = (db, update) => db.runTransaction(update, { maxAttempts: 1 });

/**
 * Sets this member's Stardust on a post to `give` (true = given, false = removed) and returns the new state.
 * Atomic: the reaction doc, the post's count and the author's total change together or not at all.
 */
export async function setStardust(db, uid, { postType, postId, give }) {
  validTarget(postType, postId);
  await memberQueue.run(uid, () => rateLimit(db, uid, 'stardust', STARDUST_ACTIONS_PER_MINUTE, 60_000));
  // One plain read to learn whose total this touches. The transaction below re-reads and re-checks everything.
  const peek = await postRef(db, postType, postId).get();
  const lane = peek.exists && safeId(peek.data().authorId) ? `author:${peek.data().authorId}` : `post:${postType}:${postId}`;
  return authorQueue.run(lane, () => withContentionRetry(() => once(db, async (tx) => {
    const post = postRef(db, postType, postId);
    const reaction = reactionRef(db, postType, postId, uid);
    const [postSnap, reactionSnap] = await tx.getAll(post, reaction);
    // A deleted post (or one without a valid author) cannot take or give back Stardust.
    const authorId = postSnap.exists ? postSnap.data().authorId : null;
    if (!postSnap.exists || !safeId(authorId)) throw fail(404, 'post_unavailable');
    if (authorId === uid) throw fail(403, 'own_post');

    const total = totalRef(db, authorId);
    const have = reactionSnap.exists && isCurrent(reactionSnap.data(), postSnap.data());
    const current = count(postSnap.data().stardustCount);

    if (give) {
      if (have) return { given: true, count: current, changed: false };
      const [actorSettings, actorProfile, actorSuspension, authorSettings, authorSuspension] = await tx.getAll(
        db.doc(`users/${uid}/private/settings`), db.doc(`users/${uid}/public/profile`), db.doc(`suspensions/${uid}`),
        db.doc(`users/${authorId}/private/settings`), db.doc(`suspensions/${authorId}`),
      );
      // Same bar as firestore.rules isEligibleMember: an adult with a saved profile.
      if (!isAdultMember(actorSettings.data()) || actorProfile.data()?.profileComplete !== true) throw fail(403, 'not_allowed');
      if (actorSuspension.exists) throw fail(403, 'account_unavailable');
      // To the member, a blocked or suspended author's post is simply not there (and the answer never says who blocked whom).
      if (authorSuspension.exists || blockedEither(actorSettings.data(), authorSettings.data(), uid, authorId)) throw fail(404, 'post_unavailable');
      const postTimestamp = millis(postSnap.data().timestamp);
      // set, not create: it also replaces a reaction left over from an earlier version of this post.
      tx.set(reaction, { uid, postType, authorId, createdAt: FieldValue.serverTimestamp(), ...(postTimestamp !== null ? { postTimestamp } : {}) });
      tx.update(post, { stardustCount: current + 1 });
      // A blind increment: giving never reads the total, so many gives for one author do not fight over a read lock on it.
      // (A total that is missing or damaged is put right by the daily reconcile.)
      tx.set(total, { total: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { given: true, count: current + 1, changed: true };
    }

    if (!have) {
      if (reactionSnap.exists) tx.delete(reaction); // a leftover from an earlier version of the post: no point to take back
      return { given: false, count: current, changed: false };
    }
    const totalSnap = await tx.get(total);
    // Removing is always allowed (it only takes a point back), and neither number can go below zero.
    tx.delete(reaction);
    tx.update(post, { stardustCount: Math.max(0, current - 1) });
    tx.set(total, { total: Math.max(0, count(totalSnap.data()?.total) - 1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { given: false, count: Math.max(0, current - 1), changed: true };
  })));
}

/** Which of these posts this member has given Stardust to: one batched read, instead of one request per post. */
export async function givenAmong(db, uid, { postType, postIds }) {
  if (typeof postType !== 'string' || !Object.hasOwn(POST_COLLECTIONS, postType) || !Array.isArray(postIds) || postIds.length > STATE_MAX_POSTS || !postIds.every(safeId)) {
    throw fail(400, 'invalid_request');
  }
  await memberQueue.run(uid, () => rateLimit(db, uid, 'stardust-state', STARDUST_STATE_PER_MINUTE, 60_000));
  const ids = [...new Set(postIds)];
  if (!ids.length) return { given: [] };
  const snaps = await db.getAll(...ids.map(id => reactionRef(db, postType, id, uid)));
  const found = ids.filter((_, i) => snaps[i].exists);
  if (!found.length) return { given: [] };
  // Only members who have given Stardust cost a second read, to drop reactions left over from an earlier version of a post.
  const posts = await db.getAll(...found.map(id => postRef(db, postType, id)));
  const current = new Set();
  found.forEach((id, i) => {
    const reaction = snaps[ids.indexOf(id)];
    if (posts[i].exists && isCurrent(reaction.data(), posts[i].data())) current.add(id);
  });
  return { given: found.filter(id => current.has(id)) };
}

# Stardust

Stardust is the one appreciation system for COSMOS: Community posts and Looking For posts share the same service, rules and
counts. It replaces Community likes. There is no Heart, Like, Upvote or Downvote anywhere.

## Data

| Path | Fields | Written by |
|---|---|---|
| `community_posts/{postId}/stardust/{uid}` | `uid`, `postType`, `authorId`, `createdAt`, `postTimestamp`, `migratedFrom?` | `/api/stardust`, migration |
| `looking_for_posts/{postId}/stardust/{uid}` | same | `/api/stardust` |
| `community_posts/{postId}.stardustCount`, `looking_for_posts/{postId}.stardustCount` | number (a missing field reads as 0) | `/api/stardust`, migration |
| `community_posts/{postId}.stardustMigratedAt` | timestamp, set once per migrated post | migration |
| `stardust_totals/{authorId}` | `total`, `updatedAt`, `reconciledAt?` | `/api/stardust`, migration, reconcile |

The reaction document id is the member's uid, so one member can hold at most one reaction per post. `stardust_totals` is the
member's single profile total across both post types, so a profile never scans posts. Legacy `likes` documents and
`likes` counters are kept untouched as history.

## API (`POST /api/stardust`, Firebase ID token required)

- `{ action: "give" | "remove", postType: "community" | "lookingFor", postId }` returns `{ given, count, changed }`.
  These set a state, so repeating a request changes nothing a second time (`changed: false`). The UI toggles by sending the opposite state.
- `{ action: "state", postType, postIds: [up to 60] }` returns `{ given: [ids] }`: the viewer's own reactions, in one request.

Errors: 400 `invalid_request`, 401 `unauthenticated`, 403 `own_post` / `not_allowed` (not an adult with a saved profile) /
`account_unavailable` (suspended), 404 `post_unavailable` (deleted, unknown, blocked either way, or suspended author), 429 `rate_limited`.

Give and remove run in one Firestore transaction that reads the post, the reaction, the eligibility, suspension and block
records and the author's total, then writes the reaction, `stardustCount` and the total together. Rate limit: 30 changes per
member per minute. A member who blocks the author, or is suspended, can still take their Stardust back.

## Policy: Stardust follows active posts

An author's total is the sum of the Stardust on the posts they have now. A deleted post stops counting, and a recreated post
starts from zero.

- **Post generation.** A reaction records the `timestamp` of the post version it was given to (`postTimestamp`). That
  timestamp is assigned by the server on creation (`timestamp == request.time` in the rules) and the rules never let it
  change, so it identifies one post version even when a Looking For post id (member + intention) is reused. A reaction whose
  `postTimestamp` differs from the post's is stale: it is not counted, not shown as given, and does not block a new give (the
  new reaction replaces it). Removing with a stale reaction only clears the leftover record.
- **Deletion.** Posts are deleted by the client directly, with no trusted server step, so the total is corrected by the
  daily reconcile (below) and can overstate by up to about a day after a deletion. Meanwhile a deleted post cannot receive,
  give back or transfer Stardust (404).
- **Reconcile** (`api/_stardust-reconcile.js`, run daily by the existing `/api/media-cleanup` cron; by hand with
  `node scripts/reconcile-stardust.mjs [--dry-run]`). It is a resumable scan:
  - It walks three lists in a fixed order (Community posts, Looking For posts, then the totals themselves, which finds
    authors whose posts are all gone), in pages of 200, from a **cursor** saved in `stardust_meta/reconcile` (server-only; the
    rules deny every client). It goes on until its time budget is used or the end is reached; at the end the cursor wraps to the
    beginning (`cycle` counts the rounds). Collections too big for one run are therefore covered over several runs.
  - It only uses the scan to choose WHICH authors to check. Each author is settled in ONE transaction that sums ALL of their
    current posts on the server (both collections) and reads their total, and writes only if the total differs. The scan's partial
    view of the posts is never used as a number, so an interrupted or partly finished run cannot write a wrong total. It never
    trusts the stored total.
  - The cursor moves only over a prefix of fully checked authors, after they are settled. It stops at the first post whose author
    was deferred (contention), failed, or not reached for lack of time, so that author is retried first next run. An author that
    blocks the cursor three runs in a row is skipped for that cycle (listed as `skippedStuck`) and settled in the next one.
  - Checking an author twice is harmless, so a run that dies after its work but before saving the cursor is simply repeated.
    Give and remove touch the same total document, so they take turns with it and are never overwritten. Two runs at once, or a run
    during live traffic, change nothing that is correct.
  - Logs a one-line JSON report (`[Stardust reconcile] ...`: pages, authors checked, repaired, deferred, failed, `cursor`,
    `cycleComplete`) and never changes the cron's own response. It stops at its time budget and skips itself if the photo
    cleanup used the time. `--dry-run` scans from the beginning, writes nothing (not even the cursor) and leaves the cursor alone.
  - A cursor that does not make sense is ignored (the scan starts from the beginning).
- Reactions of deleted posts stay in Firestore as leftovers (harmless; an admin delete of a Community post clears them).
- Before the migration runs, Community posts show their old like count as their Stardust count.

## Concurrency and cost

- Give and remove are idempotent state changes inside a transaction that re-reads everything, so a retry (including after a
  lost commit answer) never counts twice, and a failed attempt writes nothing. Giving adds to the author's total with a blind
  `increment(1)` (it never reads the total, which cut cross-instance aborts in a 30-giver stress test from 16 to 7 of 42
  operations); removing reads the total so it can never go below zero. A missing or damaged total is repaired by the reconcile.
- Requests for one author take turns on one server instance. Across instances, contention is handled by retries inside a 6 s
  budget; a request that still loses gets a retryable error and changes nothing. A hot post or author is limited to roughly
  one write per second sustained (Firestore's per-document rate), so bursts above that retry or fail and are not lost.
- Reconcile reads per run: one per post or total document scanned, plus per author checked two sum queries (about one read per
  1,000 posts each, minimum one) and the total document, so about three reads per author. Writes: one per author whose total
  is wrong, plus one cursor write per page of progress (none when a run makes no progress). One full cycle costs roughly
  (posts + totals + 3 x authors) reads; 10,000 posts, 3,000 authors and 3,000 totals is about 22,000 reads per cycle.
- Reconcile throughput is the number of authors a run can settle in its time budget (about 5 s; on the emulator roughly
  20 to 50 authors per second with 8 in parallel), not the number of posts. A cycle therefore takes `ceil(authors / authors per
  run)` daily runs, and an author's total can stay wrong for up to that many days after a deletion. Check the `cycle` and
  `cursor` fields in the log: if a cycle takes more than a few days, give the reconcile more time per run or a second schedule.
- The migration handles about 20 posts a second (one transaction per post); it is a one-off script.

## Known limits

- Up to one reconcile cycle (a day for a small community, more as it grows) of overstated totals after a post is deleted. A faster fix would need a trusted delete path.
- Several server instances writing one author's total at the same moment rely on retries (6 s budget); a request that loses
  gets a retryable error and nothing is changed. Load-test on a real project before a big launch.
- A member who gave and then removed Stardust before the migration gets their legacy like back as Stardust.
- Posts with more than 480 likes are skipped by the migration and listed in its report.

## Deployment order

1. No new environment variables: the endpoint uses `FIREBASE_SERVICE_ACCOUNT_JSON`, like the others.
2. `node scripts/migrate-stardust.mjs --dry-run`, read the report (discrepancies are expected: old counters are not trusted).
3. Deploy the Firestore rules FIRST (`firebase deploy --only firestore:rules`): this closes new likes. Then deploy the app
   (adds `api/stardust.js`: 8 of the 10 allowed serverless functions).
4. Run `node scripts/migrate-stardust.mjs` right after, then `node scripts/migrate-stardust.mjs --verify` (expect no mismatches).
5. Run `node scripts/reconcile-stardust.mjs --dry-run` once to see the first reconcile's effect, then let the daily
   `/api/media-cleanup` cron (`CRON_SECRET` already set) keep totals right. Check the `[Stardust reconcile]` log line.

Do not run the migration before the rules are live: a post is migrated once, so a like added afterwards would not be picked
up. The migration is safe next to live traffic (one transaction per post) and safe to repeat. Until it runs, Community posts
show their old like count, and a Stardust given before it runs is reconciled by it (never counted twice). A member who gave
and then removed Stardust before the migration gets their legacy like back as Stardust. No index is needed.
Cached copies of the old app that still try to like get a refused write and their heart reverts.

## Rollback

`node scripts/migrate-stardust.mjs --rollback --dry-run`, then without `--dry-run`: removes only reactions the migration
created, takes those points off the posts and totals, and clears the stamp. Stardust members gave themselves is kept. The
likes were never changed, so redeploying the previous app and rules brings back the old behaviour.

# Echoes: categories, replies and notifications

Echoes is QUEERSPACE's anonymous expression space. It has eight categories in three groups, and four of them take replies.

| Group | Category | Stored `kind` | Replies |
|---|---|---|---|
| 🌙 Release | Confession | `confession` | reactions only |
| 🌙 Release | Vent | `vent` | reactions only |
| 🌙 Release | Unsent Letters | `unsent` | reactions only |
| ✨ Connect | Need Advice | `advice` | **replies** |
| ✨ Connect | Random Thoughts | `thoughts` | reactions only |
| ☀️ Uplift | Little Wins | `wins` | **replies** |
| ☀️ Uplift | Gratitude | `gratitude` | **replies** |
| ☀️ Uplift | Daydreams | `daydreams` | **replies** |

`confession` and `vent` are the original two and never changed, so every existing post keeps working. An unrecognised kind is shown as a vent.
All eight take the same six reactions (hugs, same, felt, strong, proud, Crygago), with the same one-reaction-per-person rule.

The single source of truth in the app is `src/utils/echoKinds.ts`. `firestore.rules` lists the same ids (`unsaidKinds`, `unsaidReplyKinds`) and a test (EC-08) fails if they drift apart.

## Anonymity

Nothing public names anyone.

- `unsaid/{postId}`: text, kind, time and counters. No author.
- `unsaid_owners/{postId}`: who wrote the post. Readable **only by that member**. For a category with replies it also holds `kind` and `seenReplies` (see Notifications).
- `unsaid/{postId}/replies/{replyId}`: `{ text, createdAt }` only. No author.
- `unsaid_reply_owners/{replyId}`: `{ authorId, postId }`. Readable **only by the member who wrote that reply**. Not even the author of the post can read it, so a reply can never be traced to a person.

Replies are labelled "Anonymous" for everyone except their writer, who sees "You".

## Where replies are enforced

Hiding the Reply button is not the protection. `firestore.rules` is:

- A reply document can only be created when the parent post's `kind` is one of `advice`, `wins`, `gratitude`, `daydreams`.
- The post's `replyCount` can only move with a reply: +1 in the same batch as the reply, its owner record and the member's slow-mode stamp; -1 in the same batch that deletes that reply and its owner record. `lastReply` names the reply, so the counter cannot move on its own.
- A `replyCount` field can only exist on posts of those four kinds, and starts at 0. Older posts have none, which reads as 0.
- Reply writers must be adult members with a profile and not suspended (`isEligibleMember`, `!isSuspended()`), 5 seconds apart (`rate_limits.unsaidReply`), 1 to 300 characters.
- Only the reply's writer, or a moderator, can delete it. Nobody can edit one.

The app also refuses early (`replyToUnsaid` returns `not-allowed` for the other four kinds), but the rules are what stop a modified client.

## Notifications

Echoes has no server for this and needs none. An author's own private records say how many replies they have seen; the posts' public counters say how many exist; the difference is what is new.

1. `unsaid_owners/{postId}.seenReplies` is set to 0 when a reply-category post is created.
2. `subscribeToReplyNotices` (src/services/unsaidService.ts) watches the member's owner records and their posts' `replyCount`, and reports the unseen count per post.
3. `useEchoReplyNotices` (src/hooks/) turns that into: a count badge on the Echoes tab, a "N new" tag on the post, and a toast ("You have N new replies on your echoes" once on opening, "Someone replied to your echo" while the app is open).
4. Opening the thread calls `markRepliesSeen`, which writes `seenReplies` (the rules cap it at the real count).

These are in-app notifications, like Signals. There is no push, so an author sees new replies the next time they open the app. The notice never says who replied.

## Moderation

- Reporting a reply files a report in the same inbox as posts (`reports`, reason `Unsaid reply: …`), shown in the admin as "Echo reply". The reporter no longer sees it.
- Moderators can delete any reply or post from the thread, with the same controls as members.
- Flagged posts show their category in the admin's flagged-Echoes list.

## Known limits

- Deleting a post leaves its replies and their private owner records behind, unreachable from the app (a post's subcollections are not cascaded, as with reactions and flags today).
- An author with more than 90 reply-category posts is only notified about the first 90 (3 queries of 30).
- Replies stop at the first 100 per thread.

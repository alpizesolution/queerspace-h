# Tests (Signals): invite someone to an outside online test

The message composer in a Signals conversation has a **Tests** button (a clipboard icon) beside the other action buttons. It opens a compact picker with three external tests; choosing one invites the other person in that conversation. There is no Tests tab in the inbox.

## The catalog (one place)
`src/utils/testCatalog.ts` holds each test's id, name, description, icon and **link**. Change a link there and nowhere else (a test fails if a component repeats one). The server keeps only ids, names and descriptions in `api/_tests.js` (a test checks they match); it never holds the links.

| Test | Link |
| --- | --- |
| BDSM Test | https://bdsmtest.org/ |
| Rice Purity Test | https://ricepuritytest.com/ |
| Attachment Style Quiz | https://www.attachmentproject.com/attachment-style-quiz/ |

## How an invitation works
It is an ordinary Signals message, so unread counts, previews, real-time updates, history paging, blocking, suspension, reporting and retries all work as for every other message. `send-message` with `kind: 'test'` and `testId` only (any text, link, name or other field is refused). The server stores `{ kind: 'test', test: { id } }` and always reads the name and description from its catalog, so an invitation cannot carry words or a link of its own. The inbox preview is "📝 Test invitation: <name>".

Repeated clicks cannot double-send: the app keeps one message id per (conversation, test), sends are blocked while one is out, and the server creates a message id only once.

## The card
Shows the test's icon and name, its description, "Invited by <pseudonym>" and **Take Test**, plus **Maybe later** for the invited member (remembered on that device only). It has its own deep teal and amber look, different from Comfort Cards and NSFW Cards.

## Opening the test
**Take Test** is a normal link (`<a href target="_blank" rel="noopener noreferrer">`) to the exact catalog address. It is never embedded in a frame or WebView, never shown inside QUEERSPACE and never routed through an internal page, and the conversation stays where it was. In an installed Android PWA the browser or the operating system decides where an outside link opens (usually the default browser or a Custom Tab); a web app cannot force a particular browser, and this does not try to.

## Privacy
QUEERSPACE only sends the invitation. It does not collect, read or store answers, scores or results, does not access the outside sites, and does not share anything with the inviter. The card and the section say so, and that the tests are not a diagnosis or a measure of compatibility. Identities stay anonymous pseudonyms.

## Limits
- Invitations go only into the conversation you are in (the same rule as every message). There is no way to invite a stranger.
- The invited member sees the card whatever their NSFW setting; the BDSM Test is an adult topic, so the cards are shown to adult members only (the same age rules as Signals), and the invitation text names the test plainly.
- "Maybe later" is per device, and the app cannot know whether the link was opened.
- The outside sites are not controlled by QUEERSPACE and can change or disappear.

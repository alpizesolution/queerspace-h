# NSFW Cards (Signals)

A second card deck beside the Comfort Cards, for adults who have chosen to see mature content. It reuses the Comfort Cards machinery end to end (picker, outbox, `kind: 'card'` messages, Answer as an ordinary reply) and adds a separate deck.

## Decks and content
Four categories, twelve cards each (48), written to be suggestive and consent-minded, never explicit:
- 💋 **Flirty**: attraction, flirting and chemistry
- 🔥 **Spicy**: mature and suggestive questions
- 🌙 **Intimate**: intimacy, desires and closeness
- 🖤 **Boundaries**: consent, limits and personal preferences

Ids look like `nsfw-flirty-01` (they can never collide with the Comfort ids such as `soft-01`). The list lives in `src/utils/nsfwCards.ts` and, for the server's validation, `api/_nsfwCards.js`; a test checks the two are identical. The Comfort Cards files and the Firestore rules are unchanged.

## Who can see what (the existing NSFW setting)
There is no new setting. The cards follow the member's existing "Show NSFW content" choice, which lives on the device:

| Setting | Picker | Card you receive | Card you sent |
| --- | --- | --- | --- |
| Always hide (default) | The NSFW tab is a locked panel with no card in it, and a "Change setting" button | Covered, "Hidden by your content setting", no words, no Answer | Covered the same way |
| Ask before revealing | Full deck | Covered until Reveal, which asks for a confirmation first | Shown |
| Show after confirmation | Full deck | Covered until the Reveal tap (the tap is the confirmation) | Shown |

Because the setting is on the device, the server cannot read it. So **the question is never in anything the server stores or returns**: the message `text`, the inbox preview ("🖤 Mature Card"), the reply quote and the accessible name are all the neutral line "Mature card". The app shows the words, from its own list, only when the member's setting allows it. Under "Always hide" no question text exists in the page at all (tested).

## How it is sent
`send-message` with `kind: 'card'` and `cardId: 'nsfw-…'`, nothing else (any extra field, such as text or a question, is refused). The server stores `{ kind: 'card', card: { id } }` and `text: 'Mature card'`, and returns `card: { id, category, deck: 'nsfw' }`. Everything else is the existing path: adult-member checks, blocks and suspensions (either direction), ended chats, the same unread counters and read marking, idempotent retries by message id, and Report/Block as before.

An older app that receives such a message shows "Mature card" as plain text (it does not know the id), so nothing leaks to it either.

## Limits
- **Phones cannot change the setting.** The NSFW control was deliberately removed from the phone Appearance modal and from Profile settings, and it is the only place to turn mature cards on. On a phone (screens under 640 px) the setting therefore stays at its saved value, "Always hide" by default, and NSFW Cards stay locked. Larger screens still have the control in Settings and Appearance. The locked deck and the covered card both offer "Change setting", which opens that modal.
- The setting is per device. A member can have it on in one browser and off in another.
- The card words ship in the app, as the Comfort Cards do. A member who reads the app's code can see them; they are gated by the member's setting in the interface, not by the server.
- The server cannot check the sender's own setting (it is on their device), so an NSFW card can be sent by a client that ignores it. Only adult members in an active, unblocked conversation can send one.
- The Seek live chat is unchanged and does not offer NSFW Cards.

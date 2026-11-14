# Pictures in Support Chat

Members and the team can attach a picture in the support conversation. Unlike Signals timed photos there is **no timer**: a support picture is never hidden, expired or deleted, and it stays in the conversation (stored in the private Cloudflare R2 bucket, kept indefinitely).

## How it works
- **Sending:** `POST /api/signals { action: 'support-image-send', image (base64), messageId, threadId? }` (`api/_supportImages.js`; no new Vercel function). A member sends into their own thread; an admin names the member's `threadId` and the message is from the team. The app shrinks the picture to at most 2000 px, and the server accepts at most **3 MB** of real JPEG, PNG or WebP (checked from the file's bytes, not its name), removes camera metadata, and stores it at `support/{threadId}/{messageId}`.
- **The message:** the server writes `support_threads/{threadId}/messages/{messageId}` with `from`, `text: '📷 Photo'`, `image: { type, width, height }`, a server timestamp, and updates the thread summary (last message "📷 Photo", unread flags) exactly as a text message does. A picture message has no timer, expiry or media record.
- **Viewing:** `GET /api/signals?view=support-image&threadId&messageId` returns the picture only to that thread's own member or an admin (Google sign-in plus an `admins/{uid}` record). Anyone else gets the same "not found". There is no public link; the app shows it from a blob URL.
- **Repeats:** the app keeps one message id per chosen picture, blocks a second tap while sending, and the server creates each message id once, so a retry never makes a second picture. Sending is limited to 20 pictures an hour per account.
- **Access rules unchanged:** a suspended member can still use support, as for text. The browser still cannot write an `image` field (a rules test proves it); only the server can. **`firestore.rules` is not changed.**

## Where it shows
Support Chat (member): an attach button next to the message box, a preview with Send and Remove, a sending state, and the picture in the chat. Admin Support tab: the same attach control, and pictures shown in every thread. No duration selector appears in either. Signals timed photos are untouched.

## Limits
- Pictures are kept forever. There is no delete button and no cleanup job; removing one means deleting the R2 object and the message by hand.
- The picture upload shows a sending spinner, not a percentage.
- The admin side needs the existing admin Google sign-in; a plain member cannot see other threads' pictures.
- R2 must be configured in production (the same settings Signals photos use). Without it sending answers 503 and shows "Picture sending isn't available right now".

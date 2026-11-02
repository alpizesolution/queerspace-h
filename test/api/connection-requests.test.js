import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  checkSenderLimits,
  DECLINE_COOLDOWN_MS,
  effectiveStatus,
  postAvailability,
  REQUEST_COOLDOWN_MS,
  REQUEST_DAILY_LIMIT,
  REQUEST_DAY_MS,
  REQUEST_MAX_MESSAGE,
  REQUEST_PENDING_SENT_LIMIT,
} from '../../api/_requests.js';

const read = (file) => fs.readFileSync(file, 'utf8');
const server = read('api/_requests.js');
const signals = read('api/signals.js');
const NOW = 1_800_000_000_000;
const ts = (ms) => ({ toMillis: () => ms });

test('the limits are the ones documented: 30 seconds, 20 a day, 30 waiting, a week after a decline, 500 characters', () => {
  assert.equal(REQUEST_COOLDOWN_MS, 30_000);
  assert.equal(REQUEST_DAILY_LIMIT, 20);
  assert.equal(REQUEST_DAY_MS, 86_400_000);
  assert.equal(REQUEST_PENDING_SENT_LIMIT, 30);
  assert.equal(DECLINE_COOLDOWN_MS, 7 * 86_400_000);
  assert.equal(REQUEST_MAX_MESSAGE, 500);
});

test('a sender with no history may send, and the count starts', () => {
  const r = checkSenderLimits({ nowMs: NOW });
  assert.equal(r.ok, true);
  assert.deepEqual(r.next, { windowStartMs: NOW, windowCount: 1 });
});

test('the 30-second pace stops a second request too soon, and allows it after', () => {
  assert.deepEqual(checkSenderLimits({ nowMs: NOW, lastRequestAtMs: NOW - 29_000 }), { ok: false, status: 429, error: 'rate_limited' });
  assert.equal(checkSenderLimits({ nowMs: NOW, lastRequestAtMs: NOW - 30_000 }).ok, true);
});

test('twenty new requests a day: the twentieth passes, the twenty-first does not, and a day later it starts again', () => {
  const base = { nowMs: NOW, lastRequestAtMs: NOW - 60_000, windowStartMs: NOW - 3_600_000 };
  assert.equal(checkSenderLimits({ ...base, windowCount: 19 }).ok, true);
  assert.equal(checkSenderLimits({ ...base, windowCount: 19 }).next.windowCount, 20);
  assert.deepEqual(checkSenderLimits({ ...base, windowCount: 20 }), { ok: false, status: 429, error: 'daily_limit' });
  const nextDay = checkSenderLimits({ nowMs: NOW, lastRequestAtMs: NOW - 60_000, windowStartMs: NOW - REQUEST_DAY_MS, windowCount: 20 });
  assert.equal(nextDay.ok, true);
  assert.deepEqual(nextDay.next, { windowStartMs: NOW, windowCount: 1 });
});

test('too many requests waiting at once stops a sender, whatever their daily count', () => {
  assert.deepEqual(checkSenderLimits({ nowMs: NOW, pendingSent: 30 }), { ok: false, status: 429, error: 'too_many_pending' });
  assert.equal(checkSenderLimits({ nowMs: NOW, pendingSent: 29 }).ok, true);
});

test('a waiting request past its expiry counts as expired; everything else keeps its status', () => {
  assert.equal(effectiveStatus({ status: 'pending', expiresAt: ts(NOW - 1) }, NOW), 'expired');
  assert.equal(effectiveStatus({ status: 'pending', expiresAt: ts(NOW + 1) }, NOW), 'pending');
  assert.equal(effectiveStatus({ status: 'accepted', expiresAt: ts(NOW - 1) }, NOW), 'accepted');
  assert.equal(effectiveStatus({ status: 'declined', expiresAt: ts(NOW - 1) }, NOW), 'declined');
});

test('a post takes requests only while it exists and is not paused', () => {
  assert.equal(postAvailability(null), 'removed');
  assert.equal(postAvailability({ requestsPaused: true }), 'paused');
  assert.equal(postAvailability({ requestsPaused: false }), 'active');
  assert.equal(postAvailability({}), 'active');
});

test('anti-spam only ever looks at the sender: nothing limits how many requests an author receives', () => {
  const create = server.slice(server.indexOf('async function create'), server.indexOf('/** Loads a request and checks who is asking'));
  assert.match(create, /where\('senderId', '==', uid\)/);
  assert.doesNotMatch(create, /where\('recipientId'/, 'the create transaction never counts what the recipient already has');
  assert.doesNotMatch(server, /MAX_INCOMING|INCOMING_LIMIT|incomingLimit|REQUEST_INCOMING|maxIncoming/);
});

test('every status change runs in a transaction, is checked on the server, and leaves an audit entry', () => {
  for (const name of ['create', 'accept', 'decline', 'withdraw']) {
    const start = server.indexOf(`async function ${name}(`);
    assert.ok(start > 0, name);
    const body = server.slice(start, server.indexOf('\n  async function', start + 10) > 0 ? server.indexOf('\n  async function', start + 10) : undefined);
    assert.match(body, /db\.runTransaction/, `${name} is a transaction`);
    assert.match(body, /event\(tx, db/, `${name} is audited`);
  }
  assert.match(server, /function expire\(/);
});

test('accepting re-checks eligibility, blocks and suspension, reuses a conversation, and uses the existing accepted notification', () => {
  const accept = server.slice(server.indexOf('async function accept('), server.indexOf('async function decline('));
  assert.match(accept, /isAdultMember\(senderSettings\.data\(\)\)/);
  assert.match(accept, /isAdultMember\(recipientSettings\.data\(\)\)/);
  assert.match(accept, /senderSuspension\.exists \|\| recipientSuspension\.exists/);
  assert.match(accept, /blockedEither\(/);
  assert.match(accept, /signalsPairs'\)\.where\('participants', '==', \[data\.senderId, uid\]\.sort\(\)\)/, 'an existing conversation is found first');
  assert.match(accept, /acceptedNotification\(conversationId\)/);
  assert.match(accept, /if \(data\.status === 'accepted'\) return/, 'repeating an accept is safe');
});

test('declining opens no conversation and sends the sender no notification', () => {
  const decline = server.slice(server.indexOf('async function decline('), server.indexOf('async function withdraw('));
  assert.doesNotMatch(decline, /acceptedNotification|signalsPairs|notifications/);
  assert.match(decline, /state: 'cooling'/);
});

test('the endpoint routes only request-* actions to the new code, and the list view is its own', () => {
  assert.match(signals, /action\.startsWith\('request-'\)/);
  assert.match(signals, /view === 'requests'/);
  assert.match(signals, /createRequestHandlers\(\{ touchInbox, acceptedNotification \}\)/);
  assert.doesNotMatch(signals, /lookingForPostId/, 'the earlier Looking For shortcut into Signals is gone');
});

test('no private profile data is copied into a request, and the list is limited to public fields', () => {
  const create = server.slice(server.indexOf('tx.create(requestRef'), server.indexOf('tx.set(lockRef'));
  assert.doesNotMatch(create, /birthDate|birthday|blockedPartnerIds|displayName|avatar|aboutMe/);
  assert.match(server, /function profilePreview/);
  assert.doesNotMatch(server.slice(server.indexOf('function profilePreview'), server.indexOf('export function createRequestHandlers')), /birthDate|birthday|blocked|exactLocation/);
});

test('the new collections are server-only in the rules, with an admin-only audit trail', () => {
  const rules = read('firestore.rules').replace(/\s+/g, ' ');
  for (const name of ['connection_requests', 'connection_request_locks']) {
    const at = rules.indexOf(`match /${name}/`);
    assert.notEqual(at, -1, name);
    assert.ok(rules.slice(at, at + 120).includes('allow read, write: if false;'), name);
  }
  const events = rules.indexOf('match /connection_request_events/');
  assert.ok(rules.slice(events, events + 160).includes('allow read: if isAdmin();'));
  assert.ok(rules.slice(events, events + 160).includes('allow write: if false;'));
  const indexes = JSON.parse(read('firestore.indexes.json')).indexes.filter((i) => i.collectionGroup === 'connection_requests');
  assert.deepEqual(indexes.map((i) => i.fields.map((f) => `${f.fieldPath}:${f.order}`).join(',')).sort(), ['recipientId:ASCENDING,createdAt:DESCENDING', 'senderId:ASCENDING,createdAt:DESCENDING']);
});

test('no new serverless function and no new bottom-navigation destination', () => {
  assert.ok(fs.existsSync('api/_requests.js'), 'the new code lives in an underscore file, which is not deployed as a function');
  assert.match(read('src/components/BottomNavigation.tsx'), /export type NavTarget = 'home' \| 'setup' \| 'public' \| 'unsaid' \| 'community' \| 'signals';/);
});

// --------------------------------------------------------------------------------------------------- the screens
const panel = read('src/components/ConnectionRequestsPanel.tsx');
const view = read('src/components/SignalsView.tsx');
const app = read('src/App.tsx');
const sheet = read('src/components/ConnectionRequestSheet.tsx');
const board = read('src/components/LookingForView.tsx');

test('Signals gets Inbox and Requests, with Incoming and Sent inside Requests, and the inbox is untouched', () => {
  assert.match(view, /\[\['inbox', 'Inbox'\], \['requests', 'Requests'\]\]/);
  assert.match(view, /section === 'requests' \? \(\s*<ConnectionRequestsPanel/);
  for (const kept of ['Invitations', 'Active', 'Past', 'SignalsConversation', 'respondToInvitation', 'answerFromDialog']) assert.ok(view.includes(kept), kept);
  assert.match(panel, /\['incoming', 'Incoming'/);
  assert.match(panel, /\['sent', 'Sent'/);
  for (const label of ['No requests yet', 'You haven’t sent any requests']) assert.ok(panel.includes(label), label);
});

test('an incoming card offers Accept, Decline, View profile, Report and Block; a sent card offers Withdraw and Open conversation', () => {
  for (const text of ['Accept', 'Decline', 'View profile', 'Report', 'Block', 'Withdraw', 'Open conversation']) assert.ok(panel.includes(text), text);
  assert.match(panel, /Accepting lets them message you\. It isn’t consent to dating or anything else\./);
  assert.match(panel, /direction === 'incoming' && pending/);
  assert.match(panel, /direction === 'sent' && pending/);
  assert.match(panel, /request\.status === 'accepted' && request\.conversationId/);
  assert.match(panel, /grid grid-cols-2 gap-2/, 'Accept and Decline sit side by side');
  assert.match(panel, /btn btn-secondary btn-sm">Decline/);
  assert.match(panel, /btn btn-primary btn-sm/, 'Accept is the primary action');
});

test('viewing never answers a request, and nothing about who looked is tracked', () => {
  assert.doesNotMatch(panel + view, /viewed|seenBy|readAt|markSeen|lastViewed/i);
  const profile = panel.slice(panel.indexOf("target?.kind === 'profile'"));
  assert.doesNotMatch(profile, /answerConnectionRequest|answer\(/, 'opening a profile preview changes nothing');
  assert.equal((panel.match(/answerConnectionRequest\(/g) || []).length, 1, 'one place sends answers, and only from explicit buttons');
});

test('declining, withdrawing and blocking ask first; accepting a request does not need a dialog but says what it means', () => {
  assert.match(panel, /Decline this request\?/);
  assert.match(panel, /Withdraw your request\?/);
  assert.match(panel, /Block \$\{nameOf\(target\.request\)\}\?/);
  assert.match(panel, /onBlockMember\?\.\(request\.memberId\)/);
});

test('reports go to the existing Reports workflow, and the author can pause requests on their post', () => {
  const service = read('src/services/connectionRequestsService.ts');
  assert.match(service, /collection\(db, 'reports'\)/);
  assert.match(service, /targetType: 'user'/);
  assert.match(board, /Pause requests/);
  assert.match(board, /Resume requests/);
  assert.match(read('src/services/lookingForService.ts'), /requestsPaused: paused/);
  assert.match(read('src/components/LookingForBody.tsx'), /Requests paused/);
});

test('the composer explains consent, limits the message to 500, and sending is a guarded, retry-safe action', () => {
  assert.match(sheet, /Accepting only means they’re open to talking; it isn’t consent to dating or anything else\./);
  assert.match(sheet, /REQUEST_MESSAGE_MAX/);
  assert.match(read('src/utils/connectionRequests.ts'), /REQUEST_MESSAGE_MAX = 500/);
  assert.match(sheet, /if \(sending\) return;/);
  assert.match(sheet, /useRef\(crypto\.randomUUID\(\)\)/, 'one idempotency key per sheet');
  for (const text of ['Cancel', 'Send request', 'Request sent', 'View request', 'Withdraw request']) assert.ok(sheet.includes(text), text);
});

test('notifications are generic: a banner with no name or message, a badge count, and the existing accepted notification', () => {
  assert.match(app, /You have a new connection request\./);
  const banner = app.slice(app.indexOf('You have a new connection request.') - 400, app.indexOf('You have a new connection request.') + 400);
  assert.doesNotMatch(banner, /message|displayName|\.name/);
  assert.equal((app.match(/signalsInbox\.requestIds\.length/g) || []).length, 2, 'waiting requests count on the tab badge');
  assert.match(read('src/hooks/useSignalsInbox.ts'), /takeNewIds\(next\.requestIds, seenRequests\)/);
  assert.match(read('src/hooks/useSignalsInbox.ts'), /if \(!first\) requested\.forEach/);
});

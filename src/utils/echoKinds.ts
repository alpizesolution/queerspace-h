/**
 * The Echoes categories, in three groups, and which of them take replies. Pure data and rules, shared by the screen, the service
 * and the tests. The ids are what is stored in `unsaid/{id}.kind`: `vent` and `confession` are the original two and never
 * change; the other six are new. firestore.rules lists the same ids (unsaidKinds / unsaidReplyKinds) and a test keeps them in step.
 */

export type EchoGroupId = 'release' | 'connect' | 'uplift';

export const ECHO_GROUPS: { id: EchoGroupId; label: string; emoji: string; blurb: string }[] = [
  { id: 'release', label: 'Release', emoji: '🌙', blurb: 'Let it out' },
  { id: 'connect', label: 'Connect', emoji: '✨', blurb: 'Reach out' },
  { id: 'uplift', label: 'Uplift', emoji: '☀️', blurb: 'Share the good' },
];

export interface EchoKindInfo {
  id: string;
  label: string;
  /** For filters and empty states: "Confessions". */
  plural: string;
  group: EchoGroupId;
  emoji: string;
  /** What the composer's text box says. */
  placeholder: string;
  /** One line under the picker once this category is chosen. */
  hint: string;
  /** Whether other members can reply. Everything else is reactions only. */
  replies: boolean;
  /** What the reply box says (only for categories that take replies). */
  replyPlaceholder?: string;
  /** The reply button's label ("Reply", "Cheer them on"). */
  replyAction?: string;
}

export const UNSAID_KINDS = [
  // Release
  { id: 'confession', label: 'Confession', plural: 'Confessions', group: 'release', emoji: '🌙', placeholder: 'The thing you never said out loud…', hint: 'Anonymous feelings and secrets.', replies: false },
  { id: 'vent', label: 'Vent', plural: 'Vents', group: 'release', emoji: '☁️', placeholder: "What's weighing on you?", hint: 'A place to release what is heavy.', replies: false },
  { id: 'unsent', label: 'Unsent Letter', plural: 'Unsent Letters', group: 'release', emoji: '💌', placeholder: 'Dear…, the words you can’t send', hint: 'What you wish you could say, but can’t send.', replies: false },
  // Connect
  { id: 'advice', label: 'Need Advice', plural: 'Advice', group: 'connect', emoji: '🧭', placeholder: 'What are you stuck on? Ask the community…', hint: 'Ask anonymously. Members can reply with advice.', replies: true, replyPlaceholder: 'Share advice or your experience…', replyAction: 'Reply' },
  { id: 'thoughts', label: 'Random Thought', plural: 'Random Thoughts', group: 'connect', emoji: '💭', placeholder: 'A thought that has been on your mind…', hint: 'Casual thoughts and passing ideas.', replies: false },
  // Uplift
  { id: 'wins', label: 'Little Win', plural: 'Little Wins', group: 'uplift', emoji: '🌟', placeholder: 'A small win worth celebrating…', hint: 'Progress, big or small. Others can cheer you on.', replies: true, replyPlaceholder: 'Cheer them on…', replyAction: 'Cheer' },
  { id: 'gratitude', label: 'Gratitude', plural: 'Gratitude', group: 'uplift', emoji: '💛', placeholder: 'Who or what are you thankful for?', hint: 'Appreciation, shared. Others can send warmth.', replies: true, replyPlaceholder: 'Send some warmth…', replyAction: 'Send love' },
  { id: 'daydreams', label: 'Daydream', plural: 'Daydreams', group: 'uplift', emoji: '🌠', placeholder: 'What are you hoping for or looking forward to?', hint: 'Hopes and wishes. Others can wish you well.', replies: true, replyPlaceholder: 'Send a good wish…', replyAction: 'Wish well' },
] as const satisfies readonly EchoKindInfo[];

export type UnsaidKind = (typeof UNSAID_KINDS)[number]['id'];

/** Every kind id, for the rules test and validation. */
export const UNSAID_KIND_IDS: readonly UnsaidKind[] = UNSAID_KINDS.map((k) => k.id);

/** The categories that take replies: Need Advice and the three Uplift ones. */
export const UNSAID_REPLY_KINDS: readonly UnsaidKind[] = UNSAID_KINDS.filter((k) => k.replies).map((k) => k.id);

const BY_ID = new Map<string, EchoKindInfo>(UNSAID_KINDS.map((k) => [k.id, k]));

/** Older posts only ever had vent or confession; anything unrecognised reads as a vent, so no post is ever unreadable. */
export function toUnsaidKind(value: unknown): UnsaidKind {
  return typeof value === 'string' && BY_ID.has(value) ? (value as UnsaidKind) : 'vent';
}

export const kindInfo = (kind: unknown): EchoKindInfo => BY_ID.get(toUnsaidKind(kind))!;

/** Whether members can reply to a post of this kind. The screen and the rules both follow this list. */
export const kindAllowsReplies = (kind: unknown): boolean => UNSAID_REPLY_KINDS.includes(toUnsaidKind(kind));

export const kindsInGroup = (group: EchoGroupId): EchoKindInfo[] => UNSAID_KINDS.filter((k) => k.group === group);

export const groupOfKind = (kind: unknown): EchoGroupId => kindInfo(kind).group;

/** What a feed filter selects: everything, one whole group, or one category. */
export type EchoFilter = 'all' | { group: EchoGroupId } | { kind: UnsaidKind };

export function matchesEchoFilter(kind: unknown, filter: EchoFilter): boolean {
  if (filter === 'all') return true;
  if ('group' in filter) return groupOfKind(kind) === filter.group;
  return toUnsaidKind(kind) === filter.kind;
}

// ---------------------------------------------------------------------------------------------------------------- replies

/** A reply is short on purpose: warm and quick, never an essay. Must match the rules (replies/{id}.text.size() <= 300). */
export const UNSAID_REPLY_MAX_LENGTH = 300;
/** Seconds between a member's replies; must match slowMode('unsaidReply', ...) in firestore.rules. */
export const UNSAID_REPLY_SLOW_MODE_SECONDS = 5;

/** How many replies a post has gained since its author last looked (never negative; a deleted reply cannot make it so). */
export const unseenReplies = (replyCount: number, seenReplies: number): number => Math.max(0, Math.floor(replyCount) - Math.floor(seenReplies));

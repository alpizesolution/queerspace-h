/**
 * Helpers for keeping Community and Looking For apart without getting in the way of normal conversation.
 * Nothing here blocks a post: it only decides whether to show a friendly suggestion, and carries written text across
 * when a member switches between the two composers.
 */

export type PostKind = 'community' | 'lookingFor';

export const POST_KINDS: { id: PostKind; label: string; description: string }[] = [
  { id: 'community', label: 'Community Post', description: 'Share something, start a discussion, or tell the community about an event.' },
  { id: 'lookingFor', label: 'Looking For Post', description: 'Find friends, dates, activity partners, or someone to connect with.' },
];

export const LOOKING_FOR_SUGGESTION = 'Looking to meet someone? This post might fit better in Looking For.';

/**
 * Only the clearest signs of a "find me someone" post: "r4r", asking for a girlfriend, partner or date, or an open
 * invitation to message. Wanting company at an event, or talking about dating in general, does not match.
 */
const CLEAR_SIGNS: RegExp[] = [
  /\br4r\b/i,
  /\blooking\s+for\s+(?:a\s+|an\s+|my\s+)?(?:girlfriend|partner|date|sapphic\s+date|wlw\s+date|someone\s+to\s+date)\b/i,
  /\b(?:dm|message|pm)\s+me\s+if\s+you(?:’|')?(?:re|\s+are)\s+(?:interested|single|looking)\b/i,
];

export const suggestsLookingFor = (...texts: string[]): boolean => {
  const joined = texts.join('\n');
  return CLEAR_SIGNS.some((re) => re.test(joined));
};

/** A Community post's words as the start of a Looking For draft: the title stays the title, the body becomes "About me". */
export const communityToLookingFor = (title: string, content: string): { title: string; intro: string } => ({
  title: title.trim(),
  intro: content.trim(),
});

/** A Looking For draft's words as a Community post, so nothing typed is lost on the way back. */
export const lookingForToCommunity = (draft: { title: string; intro: string; lookingFor: string }): { title: string; content: string } => ({
  title: draft.title.trim(),
  content: [draft.intro.trim(), draft.lookingFor.trim()].filter(Boolean).join('\n\n'),
});

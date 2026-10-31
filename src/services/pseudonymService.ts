import { auth, ensureAnonymousAuth, isFirebaseConfigured } from '../lib/firebase.ts';
import { generatePseudonymCandidates } from '../utils/pseudonyms.ts';

export type ReserveOutcome =
  | { status: 'reserved'; name: string; replaced: boolean }
  | { status: 'taken' }
  /** The server could not be reached or errored. The caller must NOT save the name: it is unconfirmed. */
  | { status: 'unavailable' };

type Post = (body: Record<string, unknown>) => Promise<{ status: number; json: () => Promise<unknown> }>;

/** Calls the trusted pseudonym API with the member's ID token. */
const post: Post = async (body) => {
  const user = auth?.currentUser ?? (await ensureAnonymousAuth());
  if (!user) throw new Error('not-signed-in');
  return fetch('/api/pseudonym', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
};

/**
 * Asks the server to give this account `name`. `generated` marks a name the app made up (not typed by the person): if it
 * is taken, fresh candidates are tried and, as a last resort, a number is added, so a collision never blocks anyone.
 * A typed name that is taken comes back as { status: 'taken' } for the person to change.
 */
export async function reservePseudonym(name: string, options: { generated?: boolean } = {}, send: Post = post): Promise<ReserveOutcome> {
  const generated = options.generated === true;
  try {
    const response = await send({
      action: 'reserve',
      names: generated ? [name, ...generatePseudonymCandidates(8)] : [name],
      allowSuffix: generated,
    });
    if (response.status === 409) return { status: 'taken' };
    if (response.status !== 200) return { status: 'unavailable' };
    const body = (await response.json()) as { name?: unknown; replaced?: unknown };
    if (typeof body.name !== 'string') return { status: 'unavailable' };
    return { status: 'reserved', name: body.name, replaced: body.replaced === true };
  } catch {
    return { status: 'unavailable' };
  }
}

/**
 * A name nobody holds, for the dice button. Falls back to a local random name when offline (the server still has the
 * last word when the profile is saved).
 */
export async function suggestPseudonym(send: Post = post): Promise<string> {
  const names = generatePseudonymCandidates(12);
  if (!isFirebaseConfigured && send === post) return names[0];
  try {
    const response = await send({ action: 'suggest', names });
    if (response.status === 200) {
      const body = (await response.json()) as { name?: unknown };
      if (typeof body.name === 'string') return body.name;
    }
  } catch {
    // offline: fall through
  }
  return names[0];
}

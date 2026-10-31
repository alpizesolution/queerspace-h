import { ReserveOutcome } from './pseudonymService.ts';

export type NameCheck = { ok: true; name: string; replaced: boolean } | { ok: false; reason: 'taken' | 'unavailable'; message: string };

export const TAKEN_MESSAGE = 'That name is already taken. Try another, or tap the dice.';
export const UNAVAILABLE_MESSAGE = "Couldn't check that your name is free. Check your connection and try again.";

/**
 * Remembers which name the server is known to hold for this member and lets a name through to the cloud only if the
 * server confirmed it. There is no fail-open path: if the reservation service cannot be reached, nothing is saved.
 * A name that is already held (confirmed this session, or on the cloud profile of a completed profile) is not re-asked.
 */
export function createNameGate(reserve: (name: string, options: { generated: boolean }) => Promise<ReserveOutcome>) {
  let held: string | null = null;
  return {
    /** The cloud profile already has this name on a completed profile: existing, unchanged, usable as it is. */
    markHeld(name: string | null) {
      held = name;
    },
    held: () => held,
    async ensure(name: string, generated: boolean): Promise<NameCheck> {
      if (held === name) return { ok: true, name, replaced: false };
      const outcome = await reserve(name, { generated });
      if (outcome.status === 'taken') return { ok: false, reason: 'taken', message: TAKEN_MESSAGE };
      if (outcome.status !== 'reserved') return { ok: false, reason: 'unavailable', message: UNAVAILABLE_MESSAGE };
      held = outcome.name;
      return { ok: true, name: outcome.name, replaced: outcome.name !== name };
    },
  };
}

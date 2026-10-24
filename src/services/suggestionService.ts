import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db, ensureAnonymousAuth, isFirebaseConfigured } from '../lib/firebase.ts';

export const SUGGESTION_CATEGORIES = [
  { id: 'idea', label: 'Idea' },
  { id: 'bug', label: 'Bug' },
  { id: 'safety', label: 'Safety' },
  { id: 'other', label: 'Other' },
] as const;

export type SuggestionCategory = (typeof SUGGESTION_CATEGORIES)[number]['id'];

export const SUGGESTION_MIN_LENGTH = 3;
export const SUGGESTION_MAX_LENGTH = 1000;

/** Trims and caps suggestion text; returns null when it is too short to send. */
export function normalizeSuggestion(text: string): string | null {
  const trimmed = text.trim().slice(0, SUGGESTION_MAX_LENGTH);
  return trimmed.length >= SUGGESTION_MIN_LENGTH ? trimmed : null;
}

/**
 * Saves an anonymous suggestion to the write-only `suggestions` collection.
 * Only the project owner can read them, from the Firebase Console.
 */
export async function submitSuggestion(category: SuggestionCategory, text: string): Promise<boolean> {
  const body = normalizeSuggestion(text);
  if (!body || !isFirebaseConfigured || !db) return false;

  try {
    const user = auth?.currentUser ?? (await ensureAnonymousAuth());
    if (!user) return false;
    await addDoc(collection(db, 'suggestions'), {
      authorId: user.uid,
      category,
      text: body,
      createdAt: serverTimestamp(),
    });
    return true;
  } catch (err) {
    console.warn('[Suggestions] Could not send suggestion:', err);
    return false;
  }
}

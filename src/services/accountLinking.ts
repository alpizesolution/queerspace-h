import {
  EmailAuthProvider,
  GoogleAuthProvider,
  linkWithCredential,
  linkWithPopup,
  signInWithEmailAndPassword,
  signInWithPopup,
  type Auth,
  type User,
} from 'firebase/auth';

/**
 * Keeping a member's conversations reachable.
 *
 * Signals conversations belong to the member's Firebase uid. Members start anonymous, so the uid lives only in this browser's
 * session: clearing site data, switching browser or device, or a reset PWA gives a NEW uid with an empty inbox, and the old
 * conversations (still stored, still tied to the old uid) cannot be reached from it. An anonymous account can NOT be recovered
 * once its session is gone.
 *
 * The safe fix is to LINK a permanent sign-in (email and password, or Google) to the anonymous account while it is still signed in.
 * Linking keeps the very same uid, so every conversation, message and inbox record stays exactly where it is. Later, signing in
 * with that email or Google account on any device returns the same uid.
 *
 * Nothing here ever merges two accounts or overwrites one. If the email or Google account already belongs to another account the
 * link is refused and nothing changes; signing in to that other account is a separate, explicit step that replaces this device's
 * session (and tells the member what that means first).
 */

export type LinkFailure = 'collision' | 'weak-password' | 'invalid-email' | 'invalid-credential' | 'cancelled' | 'not-anonymous' | 'not-signed-in' | 'unavailable' | 'failed';
export type LinkOutcome = { ok: true; uid: string; providers: string[] } | { ok: false; reason: LinkFailure };

const COLLISION_CODES = ['auth/email-already-in-use', 'auth/credential-already-in-use', 'auth/account-exists-with-different-credential'];

/** Maps a Firebase auth error to a reason the screen can explain. Never throws. */
export function linkFailureFor(error: unknown): LinkFailure {
  const code = String((error as { code?: unknown } | null)?.code ?? '');
  if (COLLISION_CODES.includes(code)) return 'collision';
  if (code === 'auth/weak-password') return 'weak-password';
  if (code === 'auth/invalid-email') return 'invalid-email';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found' || code === 'auth/invalid-login-credentials') return 'invalid-credential';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' || code === 'auth/user-cancelled') return 'cancelled';
  if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation' || code === 'auth/network-request-failed' || code === 'auth/popup-blocked') return 'unavailable';
  return 'failed';
}

/** Words for each failure. They never reveal whether an email has an account beyond "already used", and never promise recovery. */
export function linkProblemText(reason: LinkFailure): string {
  switch (reason) {
    case 'collision': return 'That email or Google account is already used by another QUEERSPACE account, so nothing was changed. If it is yours, use “Sign in to a saved account” below. Your current conversations stay with this account.';
    case 'weak-password': return 'Choose a longer password (at least 6 characters).';
    case 'invalid-email': return 'That email address doesn’t look right.';
    case 'invalid-credential': return 'That email and password didn’t match a saved account.';
    case 'cancelled': return 'Sign-in was cancelled. Nothing was changed.';
    case 'not-anonymous': return 'This account is already saved.';
    case 'not-signed-in': return 'Your session is still preparing. Please try again in a moment.';
    case 'unavailable': return 'That sign-in option isn’t available right now. Check your connection, or try another option.';
    default: return 'Something went wrong. Nothing was changed. Please try again.';
  }
}

export interface AccountStatus {
  signedIn: boolean;
  /** True until a permanent sign-in is linked: the conversations then live only in this browser session. */
  anonymous: boolean;
  /** "password", "google.com", ... the sign-ins linked to this account. */
  providers: string[];
  email: string | null;
}

export function accountStatus(user: Pick<User, 'isAnonymous' | 'providerData' | 'email'> | null | undefined): AccountStatus {
  if (!user) return { signedIn: false, anonymous: false, providers: [], email: null };
  const providers = user.providerData.map((p) => p.providerId).filter(Boolean);
  return { signedIn: true, anonymous: user.isAnonymous && providers.length === 0, providers, email: user.email ?? null };
}

const done = (user: User): LinkOutcome => ({ ok: true, uid: user.uid, providers: user.providerData.map((p) => p.providerId) });

/** Links an email and password to the signed-in anonymous account. The uid does not change. */
export async function linkEmailPassword(auth: Auth | null, email: string, password: string): Promise<LinkOutcome> {
  const user = auth?.currentUser;
  if (!user) return { ok: false, reason: 'not-signed-in' };
  if (!user.isAnonymous) return { ok: false, reason: 'not-anonymous' };
  try {
    const result = await linkWithCredential(user, EmailAuthProvider.credential(email.trim(), password));
    return done(result.user);
  } catch (error) {
    return { ok: false, reason: linkFailureFor(error) };
  }
}

/** Links a Google account to the signed-in anonymous account. The uid does not change. */
export async function linkGoogle(auth: Auth | null): Promise<LinkOutcome> {
  const user = auth?.currentUser;
  if (!user) return { ok: false, reason: 'not-signed-in' };
  if (!user.isAnonymous) return { ok: false, reason: 'not-anonymous' };
  try {
    const result = await linkWithPopup(user, new GoogleAuthProvider());
    return done(result.user);
  } catch (error) {
    // credential-already-in-use carries the other account's credential; it is deliberately NOT used to sign in or merge.
    return { ok: false, reason: linkFailureFor(error) };
  }
}

/**
 * Explicit recovery: signs in to an account that was saved earlier. This REPLACES this device's session with that account's uid,
 * so the screen must say so first and ask for confirmation. It never merges anything: the anonymous account being left keeps its
 * conversations but cannot be reached again unless it was linked to a sign-in.
 */
export async function signInToSavedAccount(auth: Auth | null, method: { kind: 'password'; email: string; password: string } | { kind: 'google' }): Promise<LinkOutcome> {
  if (!auth) return { ok: false, reason: 'unavailable' };
  try {
    const result = method.kind === 'google'
      ? await signInWithPopup(auth, new GoogleAuthProvider())
      : await signInWithEmailAndPassword(auth, method.email.trim(), method.password);
    return done(result.user);
  } catch (error) {
    return { ok: false, reason: linkFailureFor(error) };
  }
}

/**
 * Asks the browser to keep this site's data (which includes the sign-in) instead of evicting it under storage pressure or after a
 * period of inactivity. Best effort: a browser may say no, and it does not replace linking a permanent sign-in.
 */
export async function requestDurableStorage(storage: Pick<StorageManager, 'persist' | 'persisted'> | undefined = typeof navigator !== 'undefined' ? navigator.storage : undefined): Promise<boolean> {
  try {
    if (!storage?.persist) return false;
    if (storage.persisted && (await storage.persisted())) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}

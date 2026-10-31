// Pseudonym reservations: one name, one account, decided by a Firestore transaction on the server.
//
//   pseudonyms/{key}        { uid, name, createdAt }   the claim on a name; the document id IS the comparison key
//   pseudonymOwners/{uid}   { key, name, updatedAt }   which name an account holds, so a rename can release the old one
//
// The key is the name lowercased with everything but letters and digits removed, so VelvetMuse, velvetmuse,
// "Velvet Muse" and Velvet_Muse are all the same name. Creating the claim document inside the transaction is what makes
// two simultaneous registrations safe: Firestore retries the loser, who then finds the document and moves on.
import { FieldValue } from 'firebase-admin/firestore';
import { HttpError } from './_lib.js';

export const NAME_MIN = 2;
export const NAME_MAX = 25;
const SUFFIX_ATTEMPTS = 12;

/** Case-insensitive comparison key. Never empty: a name with no letters or digits keys on its code points. */
export function pseudonymKey(name) {
  const letters = String(name).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (letters) return letters;
  return `cp${[...String(name)].map((c) => c.codePointAt(0).toString(16)).join('-')}`;
}

/** The trimmed name, or null when it cannot be a display name. */
export function cleanName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().normalize('NFC');
  if (name.length < NAME_MIN || [...name].length > NAME_MAX) return null;
  if (/[\p{C}]/u.test(name)) return null; // control characters, line breaks, invisible format characters
  return name;
}

/**
 * Tries to give `name` to `uid` inside one transaction.
 * Returns the name held afterwards (the spelling asked for), or null when another account has it. Asking again for a name the account already
 * holds changes nothing, so it is safe to repeat.
 */
export async function tryReserve(db, uid, name) {
  const key = pseudonymKey(name);
  const claimRef = db.doc(`pseudonyms/${key}`);
  const ownerRef = db.doc(`pseudonymOwners/${uid}`);
  return db.runTransaction(async (tx) => {
    const [claim, owner] = await tx.getAll(claimRef, ownerRef);
    if (claim.exists && claim.data().uid !== uid) return null;
    const oldKey = owner.exists ? owner.data().key : null;
    const oldClaim = oldKey && oldKey !== key ? await tx.get(db.doc(`pseudonyms/${oldKey}`)) : null;

    // Their own claim: only the capitalisation may differ, and the latest spelling wins.
    if (!claim.exists) tx.set(claimRef, { uid, name, createdAt: FieldValue.serverTimestamp() });
    else if (claim.data().name !== name) tx.update(claimRef, { name });
    if (!owner.exists || owner.data().key !== key || owner.data().name !== name) {
      tx.set(ownerRef, { key, name, updatedAt: FieldValue.serverTimestamp() });
    }
    // Release the name this account held before, so someone else can have it. Only if the claim is really theirs.
    if (oldClaim?.exists && oldClaim.data().uid === uid) tx.delete(oldClaim.ref);
    return name;
  });
}

/** Whether `uid` could take `name` right now (free, or already theirs). Reads only. */
export async function isAvailable(db, uid, name) {
  const claim = await db.doc(`pseudonyms/${pseudonymKey(name)}`).get();
  return !claim.exists || claim.data().uid === uid;
}

/** A taken name with a short number added, kept inside the length limit. */
export function withSuffix(name, random = Math.random) {
  const digits = String(10 + Math.floor(random() * 990));
  return `${name.slice(0, NAME_MAX - digits.length)}${digits}`;
}

/**
 * Reserves the first free name from `names` for `uid`.
 * With `allowSuffix` (a name the app generated, not one a person typed) it falls back to the first name with a number
 * added, so registration never fails because of a collision. Without it, a taken name is a 409 the person can act on.
 * Returns { name, replaced } where `replaced` is true when the name that was asked for first is not the one given.
 */
export async function reserveFirstFree(db, uid, names, { allowSuffix = false, random = Math.random } = {}) {
  const candidates = [...new Set(names.map(cleanName).filter(Boolean))];
  if (!candidates.length) throw new HttpError(400, 'invalid_name');
  for (const candidate of candidates) {
    const held = await tryReserve(db, uid, candidate);
    if (held) return { name: held, replaced: held !== candidates[0] };
  }
  if (!allowSuffix) throw new HttpError(409, 'name_taken');
  for (let i = 0; i < SUFFIX_ATTEMPTS; i++) {
    const held = await tryReserve(db, uid, withSuffix(candidates[0], random));
    if (held) return { name: held, replaced: true };
  }
  throw new HttpError(503, 'name_unavailable');
}

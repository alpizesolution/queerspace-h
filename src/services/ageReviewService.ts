import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db, ensureAnonymousAuth, isFirebaseConfigured } from '../lib/firebase.ts';
import { AGE_REVIEW_REASON } from '../utils/ageReview.ts';

/** Adds a minimal age-eligibility review item to the existing admin Reports inbox.
 * The birthday itself is deliberately not included in this request.
 */
export async function submitAgeEligibilityReview(): Promise<boolean> {
  if (!isFirebaseConfigured || !db) return false;
  try {
    const user = auth?.currentUser ?? await ensureAnonymousAuth();
    if (!user) return false;
    await addDoc(collection(db, 'reports'), {
      reporterId: user.uid,
      targetId: user.uid,
      targetType: 'user',
      reason: AGE_REVIEW_REASON,
      timestamp: serverTimestamp(),
    });
    return true;
  } catch (error) {
    console.warn('[AgeReview] Could not submit review request:', error);
    return false;
  }
}

/**
 * Admin: lets this member try the birthday step once more (age_review_clearances/{uid}, see firestore.rules). It brings the
 * form back and nothing else: access still needs a saved adult birthday, which the rules check. Returns false on failure.
 */
export async function grantAgeReviewClearance(memberId: string, reportId?: string): Promise<boolean> {
  const admin = auth?.currentUser;
  if (!db || !admin) return false;
  try {
    await setDoc(doc(db, 'age_review_clearances', memberId), {
      clearedBy: admin.uid,
      clearedAt: serverTimestamp(),
      ...(reportId ? { reportId } : {}),
    });
    return true;
  } catch (error) {
    console.warn('[AgeReview] Could not allow another try:', error);
    return false;
  }
}

/**
 * Member: calls onCleared once when an admin has allowed another try. The clearance is deleted first, so it is used up by
 * that one retry (and a failed delete does not unlock anything). Returns a function that stops listening.
 */
export function watchAgeReviewClearance(onCleared: () => void): () => void {
  let stop: (() => void) | null = null;
  let cancelled = false;
  void (async () => {
    if (!isFirebaseConfigured || !db) return;
    const user = auth?.currentUser ?? await ensureAnonymousAuth();
    if (!user || cancelled) return;
    const ref = doc(db, 'age_review_clearances', user.uid);
    let used = false;
    stop = onSnapshot(ref, (snap) => {
      if (!snap.exists() || used) return;
      used = true;
      deleteDoc(ref).then(onCleared, (error) => {
        used = false;
        console.warn('[AgeReview] Could not use the clearance:', error);
      });
    }, (error) => console.warn('[AgeReview] Could not watch for a review answer:', error));
  })();
  return () => { cancelled = true; stop?.(); };
}

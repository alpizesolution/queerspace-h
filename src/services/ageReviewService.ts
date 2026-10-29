import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
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

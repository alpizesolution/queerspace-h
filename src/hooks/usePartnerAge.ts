import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../lib/firebase.ts';

/**
 * The chat partner's age, only while they have "Show my age" on. The flag is watched live, so turning it off
 * removes the age at once (even in an open chat) and turning it on fetches it from the trusted API, which
 * checks the conversation and calculates the age from the private birthday. Age is never in a readable document.
 */
export function usePartnerAge(partnerId: string, conversationId?: string): number | null {
  const [age, setAge] = useState<number | null>(null);

  useEffect(() => {
    setAge(null);
    if (!db || !conversationId) return;
    let cancelled = false;
    const unsubscribe = onSnapshot(
      doc(db, 'users', partnerId, 'public', 'profile'),
      (snap) => {
        if (snap.data()?.showAgeOnProfile !== true) {
          setAge(null);
          return;
        }
        (async () => {
          try {
            const token = await auth?.currentUser?.getIdToken();
            if (!token) return;
            const response = await fetch(`/api/age?view=partner-age&convId=${encodeURIComponent(conversationId)}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const data = response.ok ? await response.json() : { age: null };
            if (!cancelled) setAge(typeof data.age === 'number' ? data.age : null);
          } catch {
            if (!cancelled) setAge(null);
          }
        })();
      },
      () => setAge(null)
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [partnerId, conversationId]);

  return age;
}

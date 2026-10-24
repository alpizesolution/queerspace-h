import {
  collection,
  doc,
  getDoc,
  getDocs,
  where,
  setDoc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db, auth, isFirebaseConfigured } from '../lib/firebase.ts';
import { ChatMessage } from '../types.ts';
import { sanitizeMessageText } from '../utils/matching-logic.ts';

export interface ConversationSession {
  convId: string;
  isCloud: boolean;
  reused: boolean;
  participants: string[];
}

/**
 * Derives a deterministic conversation ID for two UIDs to prevent duplicate conversations.
 */
export function getDeterministicConvId(uidA: string, uidB: string): string {
  const sorted = [uidA, uidB].sort();
  return `${sorted[0]}_${sorted[1]}`;
}

/**
 * Opens or creates a 1-on-1 Firestore conversation between current user and partner.
 * Uses a primary deterministic active ID (`active_${minUid}_${maxUid}`) to converge concurrent
 * initial creation attempts into a single document, with query and auto-ID fallback for re-matches.
 */
export async function startOrCreateConversation(partnerUid: string): Promise<ConversationSession> {
  const currentUser = auth?.currentUser;
  const canCloud = isFirebaseConfigured && Boolean(db) && Boolean(currentUser);

  if (!canCloud || !currentUser || !db) {
    return {
      convId: `local-demo-${Date.now()}`,
      isCloud: false,
      reused: false,
      participants: [partnerUid],
    };
  }

  const myUid = currentUser.uid;
  const sortedParticipants = [myUid, partnerUid].sort();
  const primaryConvId = `active_${getDeterministicConvId(myUid, partnerUid)}`;

  try {
    // 1. Try primary deterministic document reference to prevent concurrent creation duplication
    const primaryRef = doc(db, 'conversations', primaryConvId);
    const primarySnap = await getDoc(primaryRef);

    if (primarySnap.exists()) {
      const data = primarySnap.data();
      if (data.status === 'active') {
        return {
          convId: primaryConvId,
          isCloud: true,
          reused: true,
          participants: data.participants || sortedParticipants,
        };
      }
      // If primary doc was ended/blocked in a previous session, proceed to check active secondary doc
    } else {
      // Primary document does not exist yet; attempt to create it.
      // If two participants call this concurrently, both setDoc calls target the exact same primary path.
      try {
        await setDoc(primaryRef, {
          participants: sortedParticipants,
          status: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        return {
          convId: primaryConvId,
          isCloud: true,
          reused: false,
          participants: sortedParticipants,
        };
      } catch (err) {
        // If setDoc failed due to a race or existing document state change, fall through to query lookup
        console.warn('[ChatService] Primary setDoc notice, falling back to query lookup:', err);
      }
    }

    // 2. Secondary Lookup: Search for existing active conversation (e.g. for re-matches after ended sessions)
    const conversationsRef = collection(db, 'conversations');
    const q = query(
      conversationsRef,
      where('participants', 'array-contains', myUid),
      where('status', '==', 'active')
    );
    const querySnap = await getDocs(q);

    const activeDoc = querySnap.docs.find((docSnap) => {
      const p = docSnap.data().participants || [];
      return Array.isArray(p) && p.includes(partnerUid);
    });

    if (activeDoc) {
      return {
        convId: activeDoc.id,
        isCloud: true,
        reused: true,
        participants: activeDoc.data().participants || sortedParticipants,
      };
    }

    // 3. Fallback: Create new active conversation with auto-generated ID for re-matches
    const newConvRef = doc(collection(db, 'conversations'));
    await setDoc(newConvRef, {
      participants: sortedParticipants,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return {
      convId: newConvRef.id,
      isCloud: true,
      reused: false,
      participants: sortedParticipants,
    };
  } catch (err: unknown) {
    console.warn('[ChatService] Error starting cloud conversation, using local mode:', err);
    return {
      convId: `local-demo-${Date.now()}`,
      isCloud: false,
      reused: false,
      participants: [myUid, partnerUid],
    };
  }
}

/**
 * Sends a real-time message to a Firestore conversation.
 */
export async function sendCloudMessage(convId: string, text: string): Promise<{ success: boolean; error?: string }> {
  const currentUser = auth?.currentUser;
  if (!isFirebaseConfigured || !db || !currentUser) {
    return { success: false, error: 'Firebase is not configured or user is offline.' };
  }

  const cleanResult = sanitizeMessageText(text);
  if (cleanResult.isBlocked) {
    return { success: false, error: cleanResult.warning || 'Message contains blocked content.' };
  }

  const trimmed = cleanResult.cleanText.trim();
  if (!trimmed || trimmed.length > 1000) {
    return { success: false, error: 'Message must be between 1 and 1000 characters.' };
  }

  try {
    const messagesRef = collection(db, 'conversations', convId, 'messages');
    await addDoc(messagesRef, {
      senderId: currentUser.uid, // Always derived from auth, never caller spoofed
      text: trimmed,
      timestamp: serverTimestamp(),
    });

    // Update conversation updatedAt timestamp
    const convRef = doc(db, 'conversations', convId);
    await updateDoc(convRef, {
      updatedAt: serverTimestamp(),
    });

    return { success: true };
  } catch (err: unknown) {
    console.error('[ChatService] Error sending message:', err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Subscribes to real-time messages in a Firestore conversation.
 */
export function subscribeToCloudMessages(
  convId: string,
  onMessages: (msgs: ChatMessage[]) => void,
  onError?: (err: Error) => void
): () => void {
  const currentUser = auth?.currentUser;
  if (!isFirebaseConfigured || !db || !currentUser) {
    return () => {};
  }

  try {
    const messagesRef = collection(db, 'conversations', convId, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));

    return onSnapshot(
      q,
      (snapshot) => {
        const msgs: ChatMessage[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          const isMe = data.senderId === currentUser.uid;
          let ts = Date.now();
          if (data.timestamp instanceof Timestamp) {
            ts = data.timestamp.toMillis();
          } else if (typeof data.timestamp?.toMillis === 'function') {
            ts = data.timestamp.toMillis();
          }

          return {
            id: docSnap.id,
            sender: isMe ? 'user' : 'partner',
            text: data.text || '',
            timestamp: ts,
            status: 'delivered',
          };
        });
        onMessages(msgs);
      },
      (err) => {
        console.warn('[ChatService] Realtime message subscription notice:', err);
        if (onError) onError(err);
      }
    );
  } catch (err: unknown) {
    console.warn('[ChatService] Failed to set up message listener:', err);
    return () => {};
  }
}

/**
 * Listens to a conversation's status so each side knows when the other leaves or blocks.
 */
export function subscribeToConversationStatus(
  convId: string,
  onStatus: (status: 'active' | 'ended' | 'blocked') => void
): () => void {
  if (!isFirebaseConfigured || !db || !auth?.currentUser) return () => {};
  return onSnapshot(
    doc(db, 'conversations', convId),
    (snap) => {
      const status = snap.data()?.status;
      if (status === 'active' || status === 'ended' || status === 'blocked') onStatus(status);
    },
    (err) => console.warn('[ChatService] Conversation status listener notice:', err)
  );
}

/**
 * Ends a 1-on-1 cloud conversation safely.
 */
export async function endCloudConversation(convId: string, status: 'ended' | 'blocked' = 'ended'): Promise<boolean> {
  if (!isFirebaseConfigured || !db || !auth?.currentUser) return false;
  try {
    const convRef = doc(db, 'conversations', convId);
    await updateDoc(convRef, {
      status,
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch (err) {
    console.warn('[ChatService] Error ending conversation:', err);
    return false;
  }
}

/**
 * Submits an abuse/safety report to Firestore.
 */
export async function submitCloudReport(
  targetUid: string,
  targetType: 'user' | 'message' | 'post',
  reason: string
): Promise<boolean> {
  const currentUser = auth?.currentUser;
  if (!isFirebaseConfigured || !db || !currentUser) return false;

  try {
    const reportsRef = collection(db, 'reports');
    await addDoc(reportsRef, {
      reporterId: currentUser.uid,
      targetId: targetUid,
      targetType,
      reason: reason.slice(0, 300),
      timestamp: serverTimestamp(),
    });
    return true;
  } catch (err) {
    console.warn('[ChatService] Error submitting report:', err);
    return false;
  }
}

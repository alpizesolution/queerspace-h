import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../lib/firebase.ts';
import { REQUEST_MESSAGE_MAX, requestErrorMessage, type ConnectionRequest, type RequestLists, type RequestStatus } from '../utils/connectionRequests.ts';

/**
 * Connection requests go through the Signals API (api/signals.js): it alone writes them, checks every status change,
 * and returns a member only their own. This file is the thin client for it.
 */

async function call<T>(body?: Record<string, unknown>, query = ''): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    const user = auth?.currentUser;
    if (!user) return { ok: false, message: requestErrorMessage('unauthenticated') };
    const token = await user.getIdToken();
    const response = await fetch(`/api/signals${query}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, message: requestErrorMessage((data as { error?: string }).error) };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, message: 'No connection. Please try again.' };
  }
}

const requestList = (value: unknown): ConnectionRequest[] => (Array.isArray(value) ? (value as ConnectionRequest[]) : []);

export async function fetchConnectionRequests(): Promise<{ ok: true; lists: RequestLists } | { ok: false; message: string }> {
  const result = await call<{ incoming?: unknown; sent?: unknown }>(undefined, '?view=requests');
  if (!result.ok) return result;
  return { ok: true, lists: { incoming: requestList(result.data.incoming), sent: requestList(result.data.sent) } };
}

/** Asks the author of a Looking For post to connect. A retry with the same key is answered with the same request. */
export async function createConnectionRequest(
  post: { id: string; authorId: string },
  message: string,
  idempotencyKey: string = crypto.randomUUID()
): Promise<{ ok: true; requestId: string } | { ok: false; message: string }> {
  const result = await call<{ requestId: string }>({
    action: 'request-create',
    recipientId: post.authorId,
    lookingForPostId: post.id,
    idempotencyKey,
    message: message.trim().slice(0, REQUEST_MESSAGE_MAX),
  });
  return result.ok ? { ok: true, requestId: result.data.requestId } : result;
}

export async function answerConnectionRequest(
  action: 'accept' | 'decline' | 'withdraw',
  requestId: string
): Promise<{ ok: true; status: RequestStatus; conversationId?: string } | { ok: false; message: string }> {
  const result = await call<{ status: RequestStatus; conversationId?: string }>({ action: `request-${action}`, requestId });
  return result.ok ? { ok: true, status: result.data.status, conversationId: result.data.conversationId } : result;
}

/** Reports the member behind a request to the safety team, through the same Reports tab as every other report. */
export async function reportRequestMember(memberId: string, reason: string): Promise<boolean> {
  if (!db) return false;
  try {
    const uid = auth?.currentUser?.uid;
    if (!uid) return false;
    await addDoc(collection(db, 'reports'), {
      reporterId: uid,
      targetId: memberId,
      targetType: 'user',
      reason: `Connection request: ${reason}`.slice(0, 300),
      timestamp: serverTimestamp(),
    });
    return true;
  } catch (err) {
    console.warn('[Requests] Could not report:', err);
    return false;
  }
}

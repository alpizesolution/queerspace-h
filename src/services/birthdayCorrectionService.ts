import { auth } from '../lib/firebase.ts';

/** Client for the reviewed birthday-correction workflow (api/age.js). Birthdays never change from the client directly. */
export type CorrectionStatus = 'pending' | 'info-requested' | 'approved' | 'rejected' | 'restricted' | null;

/** What an admin may know about a member's age review. Only the admin endpoints return it. */
export type ReviewStateName = 'correction-pending' | 'under18-attempt' | 'adult-on-file' | 'legacy';

export interface ReviewState {
  uid: string;
  state: ReviewStateName;
  approvedBirthDate: string | null;
  currentAge: number | null;
  eligible: boolean;
  attempt: { birthDate: string | null; age: number | null; count: number; at: string | null } | null;
  correction: {
    status: string;
    kind: 'correction' | 'initial';
    requestedBirthDate: string | null;
    requestedAge: number | null;
    requestedEligible: boolean | null;
    reason: string;
    decisionReason: string;
    flags: string[];
    createdAt: string | null;
    decidedAt: string | null;
  } | null;
  record: {
    originalBirthDate: string | null;
    previousBirthDates: { birthDate: string; replacedAt: string | null }[];
    correctionCount: number;
    correctionsRemaining: number;
    rejectedCount: number;
    manualReview: boolean;
  };
}

export interface PendingCorrection {
  id: string;
  status?: string;
  reason: string;
  requestedBirthDate: string | null;
  requestedAge: number | null;
  createdAt: string | null;
  review?: ReviewState;
}

async function ageRequest<T>(path: string, body?: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: T }> {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) return { ok: false, status: 401, data: {} as T };
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { ok: response.ok, status: response.status, data: (await response.json().catch(() => ({}))) as T };
}

export type RequestResult = 'pending' | 'restricted' | 'already-pending' | 'limit-reached' | 'reason-required' | 'invalid' | 'too-many' | 'error';

export async function requestBirthdayCorrection(requestedBirthDate: string, reason: string): Promise<RequestResult> {
  const { ok, status, data } = await ageRequest<{ status?: string; error?: string }>('/api/age', {
    action: 'request-correction',
    requestedBirthDate,
    reason,
  });
  if (ok) return data.status === 'restricted' ? 'restricted' : 'pending';
  if (status === 409) return 'already-pending';
  if (status === 403 && data.error === 'correction_limit') return 'limit-reached';
  if (status === 400) return data.error === 'reason_required' ? 'reason-required' : 'invalid';
  if (status === 429) return 'too-many';
  return 'error';
}

export async function getMyCorrectionStatus(): Promise<CorrectionStatus> {
  const { ok, data } = await ageRequest<{ status?: CorrectionStatus }>('/api/age?view=my-correction');
  return ok ? data.status ?? null : null;
}

export async function listPendingCorrections(): Promise<PendingCorrection[]> {
  const { ok, data } = await ageRequest<{ requests?: PendingCorrection[] }>('/api/age?view=corrections');
  return ok ? data.requests ?? [] : [];
}

export interface CleanupResult {
  dryRun: boolean;
  profiles: { scanned: number; changed: number };
  queue: { scanned: number; changed: number };
}

/** Admin only: removes legacy age fields. A dry run only counts what it would change. */
export async function runAgePrivacyCleanup(dryRun: boolean): Promise<CleanupResult | null> {
  const { ok, data } = await ageRequest<CleanupResult>('/api/age', { action: 'migrate-age-privacy', dryRun });
  return ok ? data : null;
}

/** Approve needs no reason; rejecting or asking for more information needs one (the member sees it, without dates). */
export async function decideCorrection(requestId: string, decision: 'approve' | 'reject' | 'request-info', reason?: string): Promise<boolean> {
  const { ok } = await ageRequest('/api/age', { action: 'decide-correction', requestId, decision, ...(reason ? { reason } : {}) });
  return ok;
}

/** Admin: the review state of the members named in age-review reports. */
export async function getReviewStates(memberIds: string[]): Promise<Record<string, ReviewState>> {
  if (!memberIds.length) return {};
  const { ok, data } = await ageRequest<{ members?: Record<string, ReviewState> }>(`/api/age?view=review-state&ids=${encodeURIComponent(memberIds.slice(0, 25).join(','))}`);
  return ok ? data.members ?? {} : {};
}

/**
 * The age gate calls this after an under-18 birthday: the date goes to a server-only record for the admin's review. It never
 * becomes the member's birthday. Best effort: the review report itself does not depend on it.
 */
export async function submitUnderageAttempt(birthDate: string): Promise<boolean> {
  try {
    const { ok } = await ageRequest('/api/age', { action: 'submit-underage-attempt', birthDate });
    return ok;
  } catch {
    return false;
  }
}

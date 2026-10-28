import { auth } from '../lib/firebase.ts';

/** Client for the reviewed birthday-correction workflow (api/age.js). Birthdays never change from the client directly. */
export type CorrectionStatus = 'pending' | 'approved' | 'rejected' | 'restricted' | null;

export interface PendingCorrection {
  id: string;
  reason: string;
  requestedBirthDate: string | null;
  requestedAge: number | null;
  createdAt: string | null;
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

export type RequestResult = 'pending' | 'restricted' | 'already-pending' | 'no-birthday' | 'invalid' | 'too-many' | 'error';

export async function requestBirthdayCorrection(requestedBirthDate: string, reason: string): Promise<RequestResult> {
  const { ok, status, data } = await ageRequest<{ status?: string; error?: string }>('/api/age', {
    action: 'request-correction',
    requestedBirthDate,
    reason,
  });
  if (ok) return data.status === 'restricted' ? 'restricted' : 'pending';
  if (status === 409) return data.error === 'no_birthday' ? 'no-birthday' : 'already-pending';
  if (status === 400) return 'invalid';
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

export async function decideCorrection(requestId: string, decision: 'approve' | 'reject'): Promise<boolean> {
  const { ok } = await ageRequest('/api/age', { action: 'decide-correction', requestId, decision });
  return ok;
}

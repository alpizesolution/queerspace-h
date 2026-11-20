import React from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { ProfileEditorSheet } from './ProfileEditorSheet.tsx';
import type { UserPreferences } from '../types.ts';
import type { ProfileFields } from '../utils/preferences.ts';

export type ProfileLoadState = 'loading' | 'ready' | 'failed';

interface Props {
  prefs: UserPreferences;
  /** Whether this device's account has been checked against the cloud yet. */
  load: ProfileLoadState;
  /** Resolves to a message when the profile could not be saved; nothing is let through until it succeeds. */
  onSave: (profile: ProfileFields) => Promise<string | void>;
}

/**
 * The required first screen for a member who is old enough but has no saved profile. It is rendered INSTEAD of the app (the app
 * never mounts behind it), so no route, refresh or link can reach a page without it. An account is checked against the cloud first:
 * if that check fails, the member is asked to retry rather than being shown a blank form that could overwrite a profile that exists.
 */
export const ProfileSetupGate: React.FC<Props> = ({ prefs, load, onSave }) => {
  if (load === 'ready') return <ProfileEditorSheet mode="setup" currentPrefs={prefs} onClose={() => {}} onSave={onSave} />;
  return (
    <div role="status" aria-live="polite" data-testid="profile-setup-wait" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/90 px-6 text-center text-fg">
      {load === 'loading' ? (
        <p className="inline-flex items-center gap-2 text-[length:calc(14px_*_var(--fs,1))] text-muted"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> Getting your space ready…</p>
      ) : (
        <div className="max-w-xs">
          <p className="text-[length:calc(15px_*_var(--fs,1))] font-semibold">We couldn’t reach your account.</p>
          <p className="mt-1 text-[length:calc(13px_*_var(--fs,1))] text-muted">Check your connection and try again. Nothing has been changed.</p>
          <button type="button" onClick={() => window.location.reload()} className="btn btn-primary mt-4"><RefreshCw className="h-4 w-4" aria-hidden="true" /> Try again</button>
        </div>
      )}
    </div>
  );
};

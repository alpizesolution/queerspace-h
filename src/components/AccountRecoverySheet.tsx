import React, { useState } from 'react';
import { Check, KeyRound, ShieldCheck } from 'lucide-react';
import { Sheet } from './Sheet.tsx';
import { auth } from '../lib/firebase.ts';
import {
  accountStatus,
  linkEmailPassword,
  linkGoogle,
  linkProblemText,
  signInToSavedAccount,
  type LinkOutcome,
} from '../services/accountLinking.ts';

interface Props {
  onClose: () => void;
  /** Called after a successful sign-in to a different, saved account (the uid changed), so the app can start clean. Defaults to a reload. */
  onSwitched?: () => void;
}

/**
 * Keep your conversations: save this account with an email or Google so they can be reached again after clearing browser data, or
 * on another device. Linking keeps the same account (nothing moves). Signing in to a saved account is separate and says what it does.
 */
export const AccountRecoverySheet: React.FC<Props> = ({ onClose, onSwitched }) => {
  const status = accountStatus(auth?.currentUser);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [recoverOpen, setRecoverOpen] = useState(false);
  const [recoverEmail, setRecoverEmail] = useState('');
  const [recoverPassword, setRecoverPassword] = useState('');
  const [confirmSwitch, setConfirmSwitch] = useState<'password' | 'google' | null>(null);

  const finish = (outcome: LinkOutcome) => {
    setBusy(false);
    if (outcome.ok) { setSaved(true); setMessage(null); } else setMessage(linkProblemText(outcome.reason));
  };

  const saveWithEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    finish(await linkEmailPassword(auth, email, password));
  };
  const saveWithGoogle = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    finish(await linkGoogle(auth));
  };
  const signIn = async (method: Parameters<typeof signInToSavedAccount>[1]) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const outcome = await signInToSavedAccount(auth, method);
    setBusy(false);
    if (!outcome.ok) { setMessage(linkProblemText(outcome.reason)); setConfirmSwitch(null); return; }
    if (onSwitched) onSwitched(); else window.location.reload();
  };

  return (
    <Sheet title="Keep your conversations" size="md" icon={<ShieldCheck className="h-5 w-5" />} onClose={onClose}>
      <div className="space-y-4 text-sm text-fg" data-testid="account-recovery">
        {status.anonymous ? (
          <p className="text-muted">
            Your conversations are tied to this browser’s sign-in. If you clear site data, switch browser or phone, or reset the app, you will start with an empty inbox,
            and conversations from before <strong className="text-fg">can’t be recovered</strong>. Save your account now to keep them. Your pseudonym stays anonymous.
          </p>
        ) : (
          <p className="flex items-start gap-2 text-muted"><Check className="mt-0.5 h-4 w-4 shrink-0 text-lavender" aria-hidden="true" /> This account is saved{status.email ? ` with ${status.email}` : ''}. You can sign in with it on another device to reach your conversations.</p>
        )}

        {saved && <p role="status" className="rounded-xl border border-line bg-raised px-3 py-2 text-fg">Saved. Your conversations stay exactly where they are, and you can now sign in with this on any device.</p>}
        {message && <p role="alert" className="rounded-xl border border-berry/30 bg-plum/20 px-3 py-2 text-xs text-fg">{message}</p>}

        {status.anonymous && !saved && (
          <>
            <form onSubmit={(event) => void saveWithEmail(event)} className="space-y-2">
              <p className="label !mb-0">Save with email</p>
              <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" aria-label="Email" required className="input" />
              <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (6 or more characters)" aria-label="Password" minLength={6} required className="input" />
              <button type="submit" disabled={busy} className="btn btn-primary w-full">Save my account</button>
            </form>
            <button type="button" onClick={() => void saveWithGoogle()} disabled={busy} className="btn btn-secondary w-full">Save with Google</button>
          </>
        )}

        <div className="border-t border-line pt-3">
          <button type="button" onClick={() => setRecoverOpen((open) => !open)} aria-expanded={recoverOpen} className="flex items-center gap-2 text-[length:calc(13px_*_var(--fs,1))] font-semibold text-berry underline underline-offset-4"><KeyRound className="h-4 w-4" aria-hidden="true" /> Sign in to a saved account</button>
          {recoverOpen && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-muted">
                Use this if you saved an account before. Signing in <strong className="text-fg">switches this device to that account</strong>. The conversations of the account you are using now stay with it, and
                {status.anonymous ? ' cannot be reached again (it is not saved)' : ' remain reachable by signing in to it again'}. Nothing is merged.
              </p>
              <input type="email" autoComplete="email" value={recoverEmail} onChange={(e) => setRecoverEmail(e.target.value)} placeholder="Email" aria-label="Saved account email" className="input" />
              <input type="password" autoComplete="current-password" value={recoverPassword} onChange={(e) => setRecoverPassword(e.target.value)} placeholder="Password" aria-label="Saved account password" className="input" />
              {!confirmSwitch ? (
                <div className="flex gap-2">
                  <button type="button" disabled={busy || !recoverEmail || !recoverPassword} onClick={() => setConfirmSwitch('password')} className="btn btn-secondary flex-1">Sign in</button>
                  <button type="button" disabled={busy} onClick={() => setConfirmSwitch('google')} className="btn btn-secondary flex-1">Use Google</button>
                </div>
              ) : (
                <div role="alertdialog" aria-label="Confirm switching account" className="rounded-xl border border-berry/30 bg-plum/20 p-3 text-xs text-fg">
                  <p>Switch this device to the saved account? You will see that account’s conversations instead.</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" disabled={busy} onClick={() => void signIn(confirmSwitch === 'google' ? { kind: 'google' } : { kind: 'password', email: recoverEmail, password: recoverPassword })} className="btn btn-primary btn-sm">Yes, switch</button>
                    <button type="button" disabled={busy} onClick={() => setConfirmSwitch(null)} className="btn btn-secondary btn-sm">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
};

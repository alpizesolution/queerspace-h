import React, { useState } from 'react';
import { MoonStar, ShieldCheck, LockKeyhole, ArrowRight } from 'lucide-react';
import { isValidBirthDate } from '../utils/ageEligibility.ts';
interface AgeEligibilityGateProps { initialBirthDate?: string; restricted?: boolean; onSubmit: (birthDate: string) => void; onContactSupport: () => void; }
export const AgeEligibilityGate: React.FC<AgeEligibilityGateProps> = ({ initialBirthDate = '', restricted = false, onSubmit, onContactSupport }) => {
  const [birthDate, setBirthDate] = useState(initialBirthDate);
  const [error, setError] = useState('');
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!isValidBirthDate(birthDate)) { setError('Enter a valid birthday.'); return; }
    setError(''); onSubmit(birthDate);
  };
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/95 backdrop-blur-xl px-4 py-6">
    <section className="w-full max-w-md rounded-3xl border border-line bg-surface shadow-2xl p-6 sm:p-8">
      <div className="w-12 h-12 rounded-2xl bg-raised border border-line flex items-center justify-center mb-5">{restricted ? <LockKeyhole className="w-6 h-6 text-berry" /> : <MoonStar className="w-6 h-6 text-berry" />}</div>
      {restricted ? <>
        <p className="text-xs uppercase tracking-[0.18em] font-semibold text-subtle mb-2">QUEERSPACE</p>
        <h1 className="font-display text-2xl sm:text-3xl text-fg mb-3">Not quite yet</h1>
        <p className="text-sm leading-6 text-muted mb-5">QUEERSPACE is currently available to adults 18 and older. Member features are locked for this account. If you entered the wrong birthday, contact our team for help.</p>
        <button type="button" onClick={onContactSupport} className="btn btn-primary w-full h-12">Contact the team <ArrowRight className="w-4 h-4" /></button>
      </> : <>
        <p className="text-xs uppercase tracking-[0.18em] font-semibold text-subtle mb-2">A small first step</p>
        <h1 className="font-display text-2xl sm:text-3xl text-fg mb-2">Let’s get to know you</h1>
        <p className="text-sm leading-6 text-muted mb-6">Start by entering your birthday.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div><label htmlFor="qs-birth-date" className="label">Birthday</label><input id="qs-birth-date" type="date" value={birthDate} max={new Date().toISOString().slice(0, 10)} onChange={(event) => { setBirthDate(event.target.value); setError(''); }} autoComplete="bday" required className="input" aria-invalid={Boolean(error)} />{error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}</div>
          <div className="rounded-2xl bg-raised/70 border border-line p-3 flex gap-3"><ShieldCheck className="w-5 h-5 text-lavender shrink-0 mt-0.5" /><div><p className="text-sm font-medium text-fg">Your birthday stays private</p><p className="text-xs text-muted mt-1">It won’t appear on your public profile.</p></div></div>
          <button type="submit" className="btn btn-primary w-full h-12">Continue <ArrowRight className="w-4 h-4" /></button>
        </form>
        <p className="mt-4 text-[11px] leading-5 text-subtle flex gap-2"><LockKeyhole className="w-3.5 h-3.5 shrink-0 mt-0.5" />Your age is calculated from your birthday. This self-reported check is not identity verification.</p>
      </>}
    </section>
  </div>;
};

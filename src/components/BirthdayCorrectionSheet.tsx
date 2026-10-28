import React, { useEffect, useState } from 'react';
import { Sheet } from './Sheet.tsx';
import { isValidBirthDate } from '../utils/ageEligibility.ts';
import { CorrectionStatus, getMyCorrectionStatus, requestBirthdayCorrection } from '../services/birthdayCorrectionService.ts';

const MESSAGES: Record<string, string> = {
  pending: 'Request sent. The team will review it, and your birthday stays as it is until then.',
  restricted:
    'This birthday would put you under 18, so it was not accepted and your account is paused for review. Contact support if this is a mistake.',
  'already-pending': 'You already have a request waiting for review.',
  'no-birthday': 'Add your birthday first from the age check.',
  invalid: 'Enter a valid date.',
  'too-many': 'Too many requests today. Try again tomorrow.',
  error: 'Could not send the request. Try again.',
};

/** Birthdays cannot be edited directly; this sends a correction request for the team to review. */
export const BirthdayCorrectionSheet: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [status, setStatus] = useState<CorrectionStatus>(null);

  useEffect(() => {
    getMyCorrectionStatus().then(setStatus);
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isValidBirthDate(date) || sending) {
      setResult('invalid');
      return;
    }
    setSending(true);
    setResult(await requestBirthdayCorrection(date, reason.trim()));
    setSending(false);
  };

  return (
    <Sheet
      title="Correct my birthday"
      size="sm"
      onClose={onClose}
      footer={
        <button type="submit" form="qs-birthday-correction" disabled={!date || sending || result === 'pending'} className="btn btn-primary w-full">
          {sending ? 'Sending…' : 'Send request'}
        </button>
      }
    >
      <form id="qs-birthday-correction" onSubmit={submit} className="space-y-3 text-fg">
        <p className="text-sm text-muted">Your birthday can’t be edited directly. Tell us the correct date and the team will review it.</p>
        {status === 'pending' && result === null && (
          <p role="status" className="text-sm text-lavender">A request is already waiting for review.</p>
        )}
        <div>
          <label htmlFor="qs-correct-birthday" className="label">Correct birthday</label>
          <input
            id="qs-correct-birthday"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setResult(null);
            }}
            className="input"
          />
        </div>
        <div>
          <label htmlFor="qs-correct-reason" className="label">
            What went wrong? <span className="font-normal text-subtle">· optional</span>
          </label>
          <input id="qs-correct-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} className="input" />
        </div>
        {result && (
          <p role="status" className={`text-sm ${result === 'pending' ? 'text-lavender' : 'text-danger'}`}>
            {MESSAGES[result]}
          </p>
        )}
      </form>
    </Sheet>
  );
};

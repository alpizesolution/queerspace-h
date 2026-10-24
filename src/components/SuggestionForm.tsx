import React, { useState } from 'react';
import { Check } from 'lucide-react';
import {
  normalizeSuggestion,
  submitSuggestion,
  SUGGESTION_CATEGORIES,
  SUGGESTION_MAX_LENGTH,
  SuggestionCategory,
} from '../services/suggestionService.ts';

type Status = 'idle' | 'sending' | 'sent' | 'error';

/** Anonymous suggestion box: pick a category, write, send. */
export const SuggestionForm: React.FC = () => {
  const [category, setCategory] = useState<SuggestionCategory>('idea');
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  const canSend = normalizeSuggestion(text) !== null && status !== 'sending';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    setStatus('sending');
    const ok = await submitSuggestion(category, text);
    if (ok) {
      setText('');
      setStatus('sent');
    } else {
      setStatus('error');
    }
  };

  if (status === 'sent') {
    return (
      <div className="card p-5 flex flex-col items-center text-center gap-2 anim-pop" role="status">
        <span className="w-10 h-10 rounded-full bg-plum/40 text-berry flex items-center justify-center">
          <Check className="w-5 h-5" />
        </span>
        <p className="text-sm font-semibold text-fg">Thank you, we read every one.</p>
        <button onClick={() => setStatus('idle')} className="btn btn-ghost btn-sm">
          Send another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Suggestion type">
        {SUGGESTION_CATEGORIES.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={category === id}
            onClick={() => setCategory(id)}
            className="chip"
          >
            {label}
          </button>
        ))}
      </div>

      <textarea
        rows={4}
        maxLength={SUGGESTION_MAX_LENGTH}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (status === 'error') setStatus('idle');
        }}
        placeholder="What would make QUEERSPACE better for you?"
        aria-label="Your suggestion"
        className="input"
      />

      <div className="flex items-center justify-between gap-3">
        <p className={`text-[12px] ${status === 'error' ? 'text-danger' : 'text-subtle'}`} aria-live="polite">
          {status === 'error' ? "Couldn't send. Try again or email us." : 'Anonymous. Only our team sees it.'}
        </p>
        <button type="submit" disabled={!canSend} className="btn btn-primary btn-sm shrink-0">
          {status === 'sending' ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  );
};

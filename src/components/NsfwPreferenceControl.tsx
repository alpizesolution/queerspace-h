import React from 'react';
import { NSFW_PREFERENCE_OPTIONS, type NsfwPreference } from '../utils/nsfwPreference.ts';

/**
 * The "Show NSFW content" choice (the existing, on-device setting), shared by every place that offers it so there is one control,
 * not two copies. Always hide is the default; each post is only ever revealed one at a time, by choice.
 */
export const NsfwPreferenceControl: React.FC<{ value: NsfwPreference; onChange: (value: NsfwPreference) => void; className?: string }> = ({ value, onChange, className = '' }) => (
  <div className={className}>
    <p id="nsfw-pref-label" className="text-sm font-semibold text-fg">Show NSFW content</p>
    <p className="text-xs text-subtle mt-0.5 mb-2">For mature posts in Cosmos. Each post is only revealed when you choose.</p>
    <div role="radiogroup" aria-labelledby="nsfw-pref-label" className="space-y-1.5">
      {NSFW_PREFERENCE_OPTIONS.map(({ id, label, hint }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className={`flex w-full items-center gap-3 min-h-11 rounded-xl border px-3 text-left transition-colors cursor-pointer ${value === id ? 'border-berry bg-raised' : 'border-line hover:border-line-strong'}`}
        >
          <span className={`h-4 w-4 shrink-0 rounded-full border ${value === id ? 'border-berry bg-berry' : 'border-line-strong'}`} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-fg">{label}</span>
            <span className="block text-xs text-muted">{hint}</span>
          </span>
        </button>
      ))}
    </div>
  </div>
);

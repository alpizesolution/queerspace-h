import React from 'react';

/** Two-digit age field (digits only). */
export const AgeInput: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  placeholder?: string;
}> = ({ label, value, onChange, invalid, placeholder }) => (
  <input
    type="text"
    inputMode="numeric"
    pattern="[0-9]*"
    maxLength={2}
    value={value}
    onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
    placeholder={placeholder}
    aria-label={label}
    aria-invalid={invalid}
    className="input !w-20 text-center"
  />
);

/** A labelled on/off switch. */
export const ToggleRow: React.FC<{
  checked: boolean;
  onChange: (value: boolean) => void;
  title: string;
  hint?: string;
  icon?: React.ReactNode;
}> = ({ checked, onChange, title, hint, icon }) => (
  <label className="flex items-center gap-3 cursor-pointer">
    {icon}
    <span className="flex-1 min-w-0">
      <span className="block text-sm font-medium text-fg">{title}</span>
      {hint && <span className="block text-[length:calc(12px_*_var(--fs,1))] text-subtle mt-0.5 truncate">{hint}</span>}
    </span>
    <input
      type="checkbox"
      role="switch"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="peer sr-only"
    />
    <span
      aria-hidden="true"
      className="relative w-11 h-[26px] shrink-0 rounded-full bg-line-strong transition-colors peer-checked:bg-berry peer-focus-visible:ring-2 peer-focus-visible:ring-berry peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface after:absolute after:top-[3px] after:left-[3px] after:w-5 after:h-5 after:rounded-full after:bg-fg after:shadow after:transition-transform peer-checked:after:translate-x-[18px]"
    />
  </label>
);

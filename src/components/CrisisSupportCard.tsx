import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, Phone } from 'lucide-react';
import { CRISIS_OTHER, CRISIS_PRIMARY, CrisisContact } from '../utils/crisisContacts.ts';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older or restricted browsers: fall back to a hidden textarea.
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

interface CopyButtonProps {
  value: string;
  copied: boolean;
  onCopy: (value: string) => void;
}

const CopyButton: React.FC<CopyButtonProps> = ({ value, copied, onCopy }) => (
  <button
    type="button"
    onClick={() => onCopy(value)}
    aria-label={copied ? `Copied ${value}` : `Copy ${value}`}
    className="icon-btn !h-9 !w-9 shrink-0"
  >
    {copied ? <Check className="h-4 w-4 text-berry" /> : <Copy className="h-4 w-4" />}
  </button>
);

const NumberRow: React.FC<{ contact: CrisisContact; copied: string | null; onCopy: (v: string) => void }> = ({ contact, copied, onCopy }) => (
  <li className="flex min-w-0 items-center justify-between gap-2">
    <a href={`tel:${contact.tel}`} className="min-w-0 truncate py-2 text-[length:calc(14px_*_var(--fs,1))] tabular-nums text-fg underline-offset-4 hover:underline">
      {contact.display}
    </a>
    <CopyButton value={contact.display} copied={copied === contact.display} onCopy={onCopy} />
  </li>
);

/**
 * Compact crisis-support card: the main hotline up front, other numbers behind a collapsed disclosure,
 * tap to call or copy. The lines are run by NCMH, not by QUEERSPACE.
 */
export const CrisisSupportCard: React.FC<{ message?: string; className?: string }> = ({ message, className = '' }) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onCopy = async (value: string) => {
    if (!(await copyText(value))) return;
    setCopied(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), 1800);
  };

  return (
    <section aria-label="Crisis support" className={`rounded-2xl border border-line bg-surface px-3.5 py-3 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-28">
          <p className="text-[length:calc(13px_*_var(--fs,1))] font-semibold leading-tight text-fg">Need to talk now?</p>
          <p className="mt-0.5 text-[length:calc(12px_*_var(--fs,1))] leading-snug text-subtle">NCMH Crisis Hotline · 24/7</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <a
            href={`tel:${CRISIS_PRIMARY.tel}`}
            aria-label={`Call the NCMH Crisis Hotline, ${CRISIS_PRIMARY.display}`}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-berry px-4 text-[length:calc(20px_*_var(--fs,1))] font-semibold tabular-nums leading-none text-ink transition hover:brightness-110"
          >
            <Phone className="h-4 w-4" aria-hidden="true" />
            {CRISIS_PRIMARY.display}
          </a>
          <CopyButton value={CRISIS_PRIMARY.display} copied={copied === CRISIS_PRIMARY.display} onCopy={onCopy} />
        </div>
      </div>

      {message && <p className="mt-2 text-[length:calc(12px_*_var(--fs,1))] leading-snug text-muted">{message}</p>}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="crisis-other-numbers"
        className="mt-1.5 inline-flex h-9 items-center gap-1 text-[length:calc(12px_*_var(--fs,1))] font-medium text-muted transition-colors hover:text-fg"
      >
        Other contact numbers
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div id="crisis-other-numbers" className="anim-fade">
          <ul className="divide-y divide-line/60 border-t border-line/60">
            {CRISIS_OTHER.map((contact) => (
              <NumberRow key={contact.display} contact={contact} copied={copied} onCopy={onCopy} />
            ))}
          </ul>
          <p className="mt-1.5 text-[length:calc(11px_*_var(--fs,1))] leading-snug text-subtle">
            These lines are run by the National Center for Mental Health (NCMH), not by QUEERSPACE.
          </p>
        </div>
      )}
      <span className="sr-only" role="status" aria-live="polite">{copied ? `Copied ${copied}` : ''}</span>
    </section>
  );
};

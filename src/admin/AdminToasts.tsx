import React, { useEffect } from 'react';
import { Bell, Flag, Lightbulb, X } from 'lucide-react';
import { toastCopy } from '../utils/adminNotify.ts';

export interface AdminToast {
  key: string;
  kind: 'suggestion' | 'report';
  itemId: string;
  at: number;
}

const SHOW_MS = 9000;
export const MAX_TOASTS = 3;

const timeLabel = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

const ToastCard: React.FC<{ toast: AdminToast; onOpen: () => void; onDismiss: () => void }> = ({ toast, onOpen, onDismiss }) => {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, SHOW_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.key]);
  const { title, body } = toastCopy(toast.kind);
  const Icon = toast.kind === 'suggestion' ? Lightbulb : Flag;
  return (
    <div className="card flex items-start gap-3 p-3 pr-2 shadow-lg shadow-black/40 border-berry/40 anim-fade" data-toast={toast.kind}>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-3 text-left cursor-pointer">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-plum/40 text-berry">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-[length:calc(14px_*_var(--fs,1))] font-semibold text-fg">{title}</span>
          <span className="block text-[length:calc(13px_*_var(--fs,1))] text-muted">{body}</span>
          <span className="mt-0.5 block text-[length:calc(11px_*_var(--fs,1))] text-subtle tabular-nums">{timeLabel(toast.at)} · tap to open</span>
        </span>
      </button>
      <button type="button" onClick={onDismiss} className="icon-btn h-8 w-8 shrink-0" aria-label="Dismiss">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};

/** Non-blocking notices for new submissions, newest on top, a few at a time. */
export const AdminToasts: React.FC<{ toasts: AdminToast[]; onOpen: (t: AdminToast) => void; onDismiss: (key: string) => void }> = ({
  toasts,
  onOpen,
  onDismiss,
}) => {
  if (!toasts.length) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 top-[calc(var(--header-h)+0.75rem)] z-50 mx-auto flex max-w-sm flex-col gap-2 sm:left-auto sm:right-4 sm:mx-0 sm:w-80"
    >
      {toasts.slice(0, MAX_TOASTS).map((t) => (
        <ToastCard key={t.key} toast={t} onOpen={() => onOpen(t)} onDismiss={() => onDismiss(t.key)} />
      ))}
    </div>
  );
};

export const SoundToggle: React.FC<{ on: boolean; onToggle: () => void }> = ({ on, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-pressed={on}
    aria-label={on ? 'Turn notification sound off' : 'Turn notification sound on'}
    title={on ? 'Notification sound: on' : 'Notification sound: off'}
    className={`icon-btn ${on ? '!text-berry' : ''}`}
  >
    <Bell className="w-[18px] h-[18px]" fill={on ? 'currentColor' : 'none'} />
  </button>
);

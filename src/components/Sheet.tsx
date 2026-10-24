import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

interface SheetProps {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  icon?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Hide the close button for dialogs that must be answered explicitly. */
  hideClose?: boolean;
}

const SIZES = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-xl',
};

/**
 * Shared dialog surface: a bottom sheet on phones, a centered dialog on larger screens.
 * Handles Escape, backdrop click, scroll locking and initial focus.
 */
export const Sheet: React.FC<SheetProps> = ({
  title,
  onClose,
  children,
  footer,
  icon,
  size = 'md',
  hideClose = false,
}) => {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/70 backdrop-blur-sm anim-fade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`w-full ${SIZES[size]} max-h-[92dvh] flex flex-col bg-surface border border-line rounded-t-3xl sm:rounded-3xl shadow-2xl shadow-black/50 anim-sheet focus:outline-none`}
      >
        <div className="sm:hidden mx-auto mt-2.5 h-1 w-10 rounded-full bg-line-strong" aria-hidden="true" />
        <div className="flex items-center gap-3 px-5 sm:px-6 pt-4 pb-3">
          {icon}
          <h2 id={titleId} className="flex-1 min-w-0 text-[17px] font-semibold text-fg truncate">
            {title}
          </h2>
          {!hideClose && (
            <button onClick={onClose} className="icon-btn -mr-2" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 sm:px-6 pb-5 text-sm text-muted leading-relaxed">
          {children}
        </div>

        {footer && (
          <div className="px-5 sm:px-6 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-line">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

interface ConfirmDialogProps {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'primary',
  onConfirm,
  onCancel,
}) => (
  <Sheet
    title={title}
    onClose={onCancel}
    size="sm"
    hideClose
    footer={
      <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
        <button onClick={onCancel} className="btn btn-ghost w-full sm:w-auto">
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          className={`btn w-full sm:w-auto ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
        >
          {confirmLabel}
        </button>
      </div>
    }
  >
    <p>{message}</p>
  </Sheet>
);

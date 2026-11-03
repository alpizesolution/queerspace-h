import React, { useEffect, useMemo, useState } from 'react';
import { Sheet } from './Sheet.tsx';
import { DEFAULT_PHOTO_TIMER, PHOTO_TIMERS, type PhotoTimer } from '../utils/timedPhoto.ts';

interface Props {
  file: File;
  sending: boolean;
  error: string | null;
  onSend: (timer: PhotoTimer) => void;
  onClose: () => void;
}

/**
 * The step between choosing a photo and sending it: a preview and the viewing time. Only 3, 5 or 8 seconds exist, 3 is
 * chosen to begin with, and there is no way to send without one.
 */
export const TimedPhotoComposer: React.FC<Props> = ({ file, sending, error, onSend, onClose }) => {
  const [timer, setTimer] = useState<PhotoTimer>(DEFAULT_PHOTO_TIMER);
  // The sender's own file, shown only to them here, and released as soon as this closes.
  const preview = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(preview), [preview]);

  return (
    <Sheet
      title="Send a photo"
      size="md"
      onClose={() => { if (!sending) onClose(); }}
      footer={
        <button type="button" onClick={() => onSend(timer)} disabled={sending} className="btn btn-primary w-full">
          {sending ? 'Sending…' : 'Send'}
        </button>
      }
    >
      <div className="space-y-4">
        <div className="flex max-h-[45vh] items-center justify-center overflow-hidden rounded-2xl border border-line bg-ink">
          <img src={preview} alt="Photo you are about to send" className="max-h-[45vh] w-auto max-w-full object-contain" draggable={false} />
        </div>
        <div role="radiogroup" aria-label="How long they can see it" className="flex items-center justify-center gap-2">
          {PHOTO_TIMERS.map((seconds) => (
            <button
              key={seconds}
              type="button"
              role="radio"
              aria-checked={timer === seconds}
              disabled={sending}
              onClick={() => setTimer(seconds)}
              className={`chip !h-10 min-w-16 justify-center !px-4 ${timer === seconds ? '!bg-fg !text-ink !border-fg' : ''}`}
            >
              {seconds}s
            </button>
          ))}
        </div>
        {error && <p role="alert" className="text-center text-[length:calc(13px_*_var(--fs,1))] text-danger">{error}</p>}
      </div>
    </Sheet>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { openTimedPhoto } from '../services/timedPhotoService.ts';
import { isCaptureKey, secondsLeft, shouldConceal } from '../utils/timedPhoto.ts';

type Outcome = 'expired' | 'closed' | 'unavailable';

interface Props {
  pairId: string;
  messageId: string;
  /** Called once when the viewer is finished, for any reason. The photo is gone from this device by then. */
  onDone: (outcome: Outcome) => void;
}

/**
 * Full-screen viewer for one timed photo. Opening it asks the server, which starts the one viewing window and returns the
 * picture in that answer. The picture is drawn on a canvas from memory: it never has a URL, is never a link or a normal
 * image element, and is cleared the moment time is up. It is hidden while the page is out of view, loses focus or a
 * screenshot key is pressed. That cannot stop a camera pointed at the screen or a capture the browser does not report,
 * and it is not a promise that nothing can be captured.
 */
export const TimedPhotoViewer: React.FC<Props> = ({ pairId, messageId, onDone }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const [phase, setPhase] = useState<'opening' | 'showing' | 'failed'>('opening');
  const [left, setLeft] = useState(0);
  const [total, setTotal] = useState(1);
  const [concealed, setConcealed] = useState(false);
  const [failure, setFailure] = useState<Outcome>('unavailable');
  const finished = useRef(false);
  const bitmapRef = useRef<ImageBitmap | null>(null);

  const finish = (outcome: Outcome) => {
    if (finished.current) return;
    finished.current = true;
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    bitmapRef.current?.close();
    bitmapRef.current = null;
    doneRef.current(outcome);
  };

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    finished.current = false;
    (async () => {
      const result = await openTimedPhoto(pairId, messageId);
      if (cancelled) { if (result.ok) result.bitmap.close(); return; }
      if (!result.ok) {
        setFailure(result.reason === 'expired' ? 'expired' : 'unavailable');
        setPhase('failed');
        return;
      }
      bitmapRef.current = result.bitmap;
      const endAt = result.receivedAt + result.remainingMs;
      setTotal(Math.max(1, result.durationSec * 1000));
      setPhase('showing');
      const tick = () => {
        const remaining = endAt - performance.now();
        if (remaining <= 0) { finish('expired'); return; }
        setLeft(remaining);
      };
      tick();
      timer = window.setInterval(tick, 100);
    })();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
      finish('closed');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairId, messageId]);

  // Draw once the canvas exists, sized to the screen and the picture's shape.
  useEffect(() => {
    if (phase !== 'showing') return;
    const canvas = canvasRef.current;
    const bitmap = bitmapRef.current;
    if (!canvas || !bitmap) return;
    const draw = () => {
      const scale = Math.min(window.innerWidth / bitmap.width, window.innerHeight / bitmap.height, 1);
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(bitmap.width * scale * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale * ratio));
      canvas.style.width = `${Math.round(bitmap.width * scale)}px`;
      canvas.style.height = `${Math.round(bitmap.height * scale)}px`;
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    };
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [phase]);

  // Hide the picture whenever it could be captured, and put it back when it is safe. The countdown never pauses.
  useEffect(() => {
    const state = { hidden: document.hidden, focused: document.hasFocus(), captureKey: false };
    const apply = () => setConcealed(shouldConceal(state));
    const onVisibility = () => { state.hidden = document.hidden; apply(); };
    const onBlur = () => { state.focused = false; apply(); };
    const onFocus = () => { state.focused = true; apply(); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { finish('closed'); return; }
      if (isCaptureKey(event)) { state.captureKey = true; apply(); }
    };
    const onKeyUp = (event: KeyboardEvent) => { if (isCaptureKey(event)) { state.captureKey = true; apply(); window.setTimeout(() => { state.captureKey = false; apply(); }, 1500); } };
    apply();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const block = (event: React.SyntheticEvent) => event.preventDefault();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo"
      onContextMenu={block}
      onDragStart={block}
      className="fixed inset-0 z-[120] flex select-none items-center justify-center bg-black [-webkit-touch-callout:none] [-webkit-user-select:none] print:hidden"
    >
      {phase === 'showing' && (
        <>
          <canvas ref={canvasRef} aria-hidden="true" onContextMenu={block} className="max-h-full max-w-full" style={{ visibility: concealed ? 'hidden' : 'visible', pointerEvents: 'none' }} />
          {concealed && <p className="absolute text-sm text-white/60">Hidden while you’re away</p>}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-white/10" aria-hidden="true">
            <div className="h-full bg-berry" style={{ width: `${Math.max(0, Math.min(100, (left / total) * 100))}%` }} />
          </div>
          <p role="timer" aria-label={`${secondsLeft(left)} seconds left`} className="absolute left-1/2 top-[max(1rem,env(safe-area-inset-top))] -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-sm font-semibold tabular-nums text-white/90">
            {secondsLeft(left)}s
          </p>
        </>
      )}
      {phase === 'opening' && <p className="text-sm text-white/60" role="status">Opening…</p>}
      {phase === 'failed' && (
        <p role="alert" className="px-6 text-center text-sm text-white/80">{failure === 'expired' ? 'Photo expired' : 'Couldn’t open this photo. Try again in a moment.'}</p>
      )}
      <button
        type="button"
        onClick={() => finish(phase === 'failed' ? failure : 'closed')}
        aria-label="Close photo"
        className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white/90 hover:bg-black/70"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
};

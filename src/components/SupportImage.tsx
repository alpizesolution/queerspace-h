import React, { useEffect, useRef, useState } from 'react';
import { ImageOff, ImagePlus, LoaderCircle, X } from 'lucide-react';
import { fetchSupportImage, prepareSupportImage, SUPPORT_IMAGE_TYPES, sendSupportImage, supportImageProblemText } from '../services/supportImageService.ts';

/** A picture inside a support message. It loads through the permission-checked request and is never expired. */
export const SupportImage: React.FC<{ threadId: string; messageId: string; width?: number; height?: number }> = ({ threadId, messageId, width, height }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let live = true;
    setState('loading');
    void fetchSupportImage(threadId, messageId).then((found) => { if (!live) return; setUrl(found); setState(found ? 'ready' : 'error'); });
    return () => { live = false; };
  }, [threadId, messageId]);
  if (state === 'error') return <p data-testid="support-image-error" className="flex min-h-9 items-center gap-1.5 text-[length:calc(13px_*_var(--fs,1))] italic opacity-70"><ImageOff className="h-4 w-4" aria-hidden="true" /> Picture unavailable</p>;
  if (state === 'loading' || !url) return <div data-testid="support-image-loading" className="flex h-24 w-40 items-center justify-center rounded-xl bg-ink/40" style={width && height ? { aspectRatio: `${width} / ${height}`, maxWidth: '100%' } : undefined}><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /></div>;
  return <img data-testid="support-image" src={url} alt="Picture sent in this support chat" className="block max-h-72 max-w-full rounded-xl object-contain" />;
};

interface AttachProps {
  /** Admin only: the member's thread the picture goes to. Omitted for a member (their own thread). */
  threadId?: string;
  disabled?: boolean;
  /** Called with words when a picture can't be sent. */
  onProblem: (text: string | null) => void;
}

/**
 * The attach control for Support Chat: a picture button, a small preview with Remove and Send, and a sending state. There is NO timer
 * here (the timed-photo duration picker belongs to Signals only): the picture stays in the conversation.
 */
export const SupportImageAttach: React.FC<AttachProps> = ({ threadId, disabled = false, onProblem }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [prepared, setPrepared] = useState<{ blob: Blob; preview: string } | null>(null);
  const [sending, setSending] = useState(false);
  /** One id per chosen picture, kept across retries, so the server can never make two messages from one picture. */
  const messageId = useRef<string | null>(null);
  const busy = useRef(false);

  useEffect(() => () => { if (prepared) URL.revokeObjectURL(prepared.preview); }, [prepared]);

  const choose = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    onProblem(null);
    const blob = await prepareSupportImage(file);
    if (!blob) { onProblem(supportImageProblemText('type')); return; }
    messageId.current = crypto.randomUUID();
    setPrepared({ blob, preview: URL.createObjectURL(blob) });
  };

  const send = async () => {
    if (!prepared || busy.current) return;
    busy.current = true;
    setSending(true);
    onProblem(null);
    const outcome = await sendSupportImage(prepared.blob, messageId.current!, threadId);
    busy.current = false;
    setSending(false);
    if (outcome.ok) { setPrepared(null); messageId.current = null; } else onProblem(supportImageProblemText(outcome.reason));
  };

  return (
    <>
      <input ref={fileRef} type="file" accept={SUPPORT_IMAGE_TYPES.join(',')} className="sr-only" aria-label="Choose a picture to send" data-testid="support-file" onChange={(e) => void choose(e)} />
      <button type="button" disabled={disabled || sending} onClick={() => fileRef.current?.click()} onMouseDown={(e) => e.preventDefault()} aria-label="Attach a picture" title="Attach a picture" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-raised hover:text-fg disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60">
        <ImagePlus className="h-5 w-5" aria-hidden="true" />
      </button>
      {prepared && (
        <div data-testid="support-preview" className="order-first flex w-full items-center gap-3 rounded-2xl border border-line bg-raised/60 p-2">
          <img src={prepared.preview} alt="Picture ready to send" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
          <p className="min-w-0 flex-1 text-[length:calc(12.5px_*_var(--fs,1))] text-muted">{sending ? 'Sending your picture…' : 'Send this picture. It stays in the chat.'}</p>
          <button type="button" disabled={sending} onClick={() => { setPrepared(null); messageId.current = null; }} aria-label="Remove the picture" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:text-fg disabled:opacity-40"><X className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" disabled={sending} onClick={() => void send()} aria-label="Send the picture" className="btn btn-primary btn-sm shrink-0">
            {sending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Send'}
          </button>
        </div>
      )}
    </>
  );
};

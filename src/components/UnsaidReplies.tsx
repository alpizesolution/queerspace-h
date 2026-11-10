import React, { useEffect, useRef, useState } from 'react';
import { Flag, SendHorizontal, Trash2 } from 'lucide-react';
import { ConfirmDialog, Sheet } from './Sheet.tsx';
import {
  deleteUnsaidReply,
  formatPostedAgo,
  loadMyReplyIds,
  replyToUnsaid,
  reportUnsaidReply,
  subscribeToUnsaidReplies,
  UNSAID_REPORT_REASONS,
  validateUnsaidReplyText,
  type UnsaidPost,
  type UnsaidReply,
} from '../services/unsaidService.ts';
import { UNSAID_REPLY_MAX_LENGTH, groupOfKind, kindInfo } from '../utils/echoKinds.ts';

/** The same text twice in a row within this long is treated as an accidental double send. */
const DUPLICATE_WINDOW_MS = 60_000;

interface Props {
  post: UnsaidPost;
  /** Moderators can remove any reply. */
  isAdmin: boolean;
  /** Called when the replies have loaded, with how many there are: the author of the post uses it to mark them as seen. */
  onViewed?: (replyCount: number) => void;
  onToast?: (toast: { text: string; ok: boolean }) => void;
}

const FAILURES = {
  'too-fast': 'Give it a few seconds between replies, then try again.',
  'not-allowed': 'This echo takes reactions only.',
  invalid: 'Write a reply first.',
  failed: "Couldn't send that. Check your connection and try again.",
} as const;

/**
 * The thread under an Echo that takes replies (Need Advice, Little Wins, Gratitude, Daydreams). Replies are anonymous and read
 * oldest first. The writer of a reply sees "You" and a delete control; everyone else can report it; moderators can remove any.
 * Kept light on purpose: a short box and one button, not a forum.
 */
export const UnsaidReplies: React.FC<Props> = ({ post, isAdmin, onViewed, onToast }) => {
  const info = kindInfo(post.kind);
  const uplift = groupOfKind(post.kind) === 'uplift';
  const [replies, setReplies] = useState<UnsaidReply[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const lastSent = useRef<{ text: string; at: number } | null>(null);
  const viewed = useRef(onViewed);
  viewed.current = onViewed;

  useEffect(() => {
    let cancelled = false;
    loadMyReplyIds(post.id).then((ids) => { if (!cancelled) setMine(new Set(ids)); });
    const stop = subscribeToUnsaidReplies(
      post.id,
      (next) => {
        setReplies(next);
        setLoadError(false);
        viewed.current?.(next.length);
      },
      () => setLoadError(true)
    );
    return () => {
      cancelled = true;
      stop();
    };
  }, [post.id]);

  const send = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (sending) return;
    const checked = validateUnsaidReplyText(draft);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    const at = Date.now();
    if (lastSent.current && lastSent.current.text === checked.text && at - lastSent.current.at < DUPLICATE_WINDOW_MS) {
      setError('You just sent that one.');
      return;
    }
    setSending(true);
    setError(null);
    const result = await replyToUnsaid(post, checked.text);
    setSending(false);
    if (result.ok) {
      lastSent.current = { text: checked.text, at };
      setDraft('');
      setMine((current) => new Set(current).add(result.id));
    } else {
      setError(FAILURES[result.reason]);
    }
  };

  const confirmDelete = async () => {
    if (!deleting || busyDelete) return;
    const id = deleting;
    setBusyDelete(true);
    const ok = await deleteUnsaidReply(post.id, id);
    setBusyDelete(false);
    setDeleting(null);
    if (!ok) onToast?.({ text: "Couldn't delete that reply. Please try again.", ok: false });
  };

  const report = async (reason: string) => {
    if (!reporting) return;
    const id = reporting;
    setReporting(null);
    setHidden((current) => new Set(current).add(id));
    await reportUnsaidReply(post.id, id, reason);
  };

  const shown = (replies ?? []).filter((r) => !hidden.has(r.id));
  const tone = uplift ? 'echo-tone-uplift' : '';

  return (
    <section aria-label={`Replies to this ${info.label.toLowerCase()}`} className={`mt-2.5 border-t border-line/60 pt-2.5 ${tone}`}>
      {replies === null && !loadError ? (
        <div className="space-y-2" aria-hidden="true">
          <div className="h-10 rounded-xl bg-raised/60 animate-pulse" />
        </div>
      ) : loadError && replies === null ? (
        <p className="text-[length:calc(13px_*_var(--fs,1))] text-muted">Couldn’t load the replies. Please try again soon.</p>
      ) : shown.length === 0 ? (
        <p className="text-[length:calc(13px_*_var(--fs,1))] text-subtle">
          {uplift ? 'Be the first to send some warmth.' : 'No replies yet. Be the first to help.'}
        </p>
      ) : (
        <ul className="space-y-1.5" aria-label="Replies">
          {shown.map((reply) => {
            const own = mine.has(reply.id);
            return (
              <li key={reply.id} className={`rounded-xl bg-ink/40 px-3 py-2 ${uplift ? 'echo-reply-bar' : 'border-l-2 border-line'}`}>
                <div className="flex items-center gap-1.5 text-[length:calc(12px_*_var(--fs,1))] text-subtle">
                  <span className="font-medium text-muted">{own ? 'You' : 'Anonymous'}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatPostedAgo(reply.createdAt)}</span>
                  <span className="ml-auto">
                    {own || isAdmin ? (
                      <button
                        type="button"
                        onClick={() => setDeleting(reply.id)}
                        className="icon-btn -my-1.5 -mr-2 h-8 w-8"
                        aria-label={own ? 'Delete your reply' : 'Delete reply (moderator)'}
                        title={own ? 'Delete your reply' : 'Delete reply (moderator)'}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button type="button" onClick={() => setReporting(reply.id)} className="icon-btn -my-1.5 -mr-2 h-8 w-8" aria-label="Report reply" title="Report reply">
                        <Flag className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-[length:calc(14px_*_var(--fs,1))] leading-relaxed text-fg/90 [overflow-wrap:anywhere]">{reply.text}</p>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={send} className="mt-2.5">
        <label htmlFor={`reply-${post.id}`} className="sr-only">Write a reply</label>
        <div className="flex items-end gap-2">
          <textarea
            id={`reply-${post.id}`}
            rows={2}
            maxLength={UNSAID_REPLY_MAX_LENGTH}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send();
            }}
            placeholder={info.replyPlaceholder}
            className="input min-h-[2.75rem] flex-1 resize-none text-base sm:text-[length:calc(14px_*_var(--fs,1))]"
          />
          <button type="submit" disabled={!draft.trim() || sending} className="btn btn-primary btn-sm shrink-0 !px-3.5" aria-label={sending ? 'Sending' : info.replyAction}>
            <SendHorizontal className="h-4 w-4" aria-hidden="true" />
            <span>{sending ? 'Sending…' : info.replyAction}</span>
          </button>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[length:calc(12px_*_var(--fs,1))]" aria-live="polite">
          <span className={`flex-1 ${error ? 'text-danger' : 'text-subtle'}`}>{error ?? 'Anonymous. No links, handles or numbers.'}</span>
          {draft.length > UNSAID_REPLY_MAX_LENGTH - 60 && <span className="tabular-nums text-subtle">{draft.length}/{UNSAID_REPLY_MAX_LENGTH}</span>}
        </div>
      </form>

      {reporting && (
        <Sheet title="Report this reply" onClose={() => setReporting(null)} size="sm">
          <p className="mb-3">It’s hidden for you right away, and the team will take a look.</p>
          <div className="flex flex-col gap-2">
            {UNSAID_REPORT_REASONS.map((reason) => (
              <button key={reason} onClick={() => report(reason)} className="btn btn-secondary justify-start">
                {reason}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {deleting && (
        <ConfirmDialog
          title={mine.has(deleting) ? 'Delete your reply?' : 'Delete this reply?'}
          message={mine.has(deleting) ? 'It disappears for everyone right away.' : 'This reply will be removed for everyone, for breaking the guidelines.'}
          confirmLabel={busyDelete ? 'Deleting…' : 'Delete'}
          tone="danger"
          busy={busyDelete}
          onConfirm={confirmDelete}
          onCancel={() => {
            if (!busyDelete) setDeleting(null);
          }}
        />
      )}
    </section>
  );
};

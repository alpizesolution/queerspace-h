import React, { useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Sheet } from './Sheet.tsx';
import { AnimalAvatar } from './AnimalAvatar.tsx';
import { sanitizeMessageText } from '../utils/matching-logic.ts';
import { REQUEST_MESSAGE_MAX } from '../utils/connectionRequests.ts';
import { INTENTION_LABELS, type LookingForPost } from '../utils/lookingFor.ts';
import { answerConnectionRequest, createConnectionRequest } from '../services/connectionRequestsService.ts';

interface Props {
  post: LookingForPost;
  onClose: () => void;
  /** Takes the member to Signals → Requests to see the request. */
  onViewRequests?: () => void;
}

/**
 * The request composer: who it goes to, an optional hello, and a plain explanation of what accepting means. After
 * sending it shows "Request sent" with a way to view or withdraw it. Sending goes through the Signals API.
 */
export const ConnectionRequestSheet: React.FC<Props> = ({ post, onClose, onViewRequests }) => {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [withdrawn, setWithdrawn] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  // One key per sheet, so a retry after a dropped connection can never send the request twice.
  const key = useRef(crypto.randomUUID());

  const send = async () => {
    if (sending) return;
    // The hello is optional, and the content filter treats an empty text as blocked, so only a real message is checked.
    const cleaned = text.trim() ? sanitizeMessageText(text.trim()) : { cleanText: '', isBlocked: false };
    if (cleaned.isBlocked) {
      setError('This goes against our guidelines, so it can’t be sent.');
      return;
    }
    setSending(true);
    setError(null);
    const result = await createConnectionRequest(post, cleaned.cleanText, key.current);
    setSending(false);
    if (result.ok) setRequestId(result.requestId);
    else setError(result.message);
  };

  const withdraw = async () => {
    if (!requestId || withdrawing) return;
    setWithdrawing(true);
    setError(null);
    const result = await answerConnectionRequest('withdraw', requestId);
    setWithdrawing(false);
    if (result.ok) setWithdrawn(true);
    else setError(result.message);
  };

  if (requestId) {
    return (
      <Sheet
        title={withdrawn ? 'Request withdrawn' : 'Request sent'}
        size="sm"
        icon={<CheckCircle2 className="w-5 h-5 text-berry" />}
        onClose={onClose}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {!withdrawn && <button type="button" onClick={withdraw} disabled={withdrawing} className="btn btn-ghost w-full sm:w-auto">{withdrawing ? 'Withdrawing…' : 'Withdraw request'}</button>}
            {!withdrawn && onViewRequests && <button type="button" onClick={() => { onViewRequests(); onClose(); }} className="btn btn-primary w-full sm:w-auto">View request</button>}
            {withdrawn && <button type="button" onClick={onClose} className="btn btn-primary w-full sm:w-auto">Done</button>}
          </div>
        }
      >
        <p>
          {withdrawn
            ? `Your request to ${post.author} was withdrawn. They can no longer accept it.`
            : `${post.author} will see your request in Signals. If they accept, a private conversation opens. You’ll see their answer under Signals → Requests.`}
        </p>
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      </Sheet>
    );
  }

  return (
    <Sheet
      title="Send connection request"
      size="sm"
      onClose={() => { if (!sending) onClose(); }}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={sending} className="btn btn-ghost w-full sm:w-auto">Cancel</button>
          <button type="button" onClick={send} disabled={sending} className="btn btn-primary w-full sm:w-auto">{sending ? 'Sending…' : 'Send request'}</button>
        </div>
      }
    >
      <div className="flex items-center gap-3 mb-3">
        <AnimalAvatar avatar={post.authorAvatar} seed={post.authorId || post.author} className="w-10 h-10" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[length:calc(15px_*_var(--fs,1))] font-semibold text-fg">{post.author}</p>
          <p className="text-[length:calc(12px_*_var(--fs,1))] text-subtle">About their {INTENTION_LABELS[post.intention]} post</p>
        </div>
      </div>
      <p className="mb-3">
        {post.author} needs to accept before private messaging opens. Accepting only means they’re open to talking; it isn’t consent to dating or anything else.
      </p>
      <label htmlFor="cr-message" className="sr-only">Introduction (optional)</label>
      <textarea
        id="cr-message"
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, REQUEST_MESSAGE_MAX))}
        maxLength={REQUEST_MESSAGE_MAX}
        rows={4}
        placeholder="A short introduction (optional)"
        className="w-full px-4 py-2.5 rounded-xl bg-ink border border-line text-base sm:text-sm text-fg placeholder:text-subtle focus:outline-none focus:border-berry resize-none"
      />
      <p className="mt-1 text-right text-[length:calc(11px_*_var(--fs,1))] text-subtle">{text.length}/{REQUEST_MESSAGE_MAX}</p>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </Sheet>
  );
};

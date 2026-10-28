import React, { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, LoaderCircle, MessageCircle, RefreshCw, Reply, Send, ShieldCheck, X } from 'lucide-react';
import { auth } from '../lib/firebase.ts';

type SignalMessage = {
  id: string;
  senderId: string;
  text: string;
  createdAt: string | null;
  replyTo?: { messageId: string; senderId: string; text: string } | null;
  reactions?: { emoji: string; count: number; userReacted: boolean }[];
};

type SignalsConversationProps = {
  pairId: string;
  onBack: () => void;
};

async function request<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const user = auth?.currentUser;
  if (!user) throw new Error('Your session is still preparing. Please try again.');
  const token = await user.getIdToken();
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const messages: Record<string, string> = {
      unauthenticated: 'Your session needs to refresh. Please try again.',
      not_allowed: 'You can no longer message this connection.',
      pair_not_found: 'This connection could not be found.',
      pair_not_active: 'This connection has ended.',
      account_unavailable: 'Messaging is temporarily unavailable for this account.',
      internal_error: 'Signals is temporarily unavailable. Please try again.',
    };
    throw new Error(messages[data.error] || 'Could not complete that action. Please try again.');
  }
  return data as T;
}

function formatTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

export const SignalsConversation: React.FC<SignalsConversationProps> = ({ pairId, onBack }) => {
  const [messages, setMessages] = useState<SignalMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [replyingTo, setReplyingTo] = useState<SignalMessage | null>(null);
  const [reactingId, setReactingId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const userId = auth?.currentUser?.uid;

  const loadMessages = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const result = await request<{ messages: SignalMessage[] }>(
        `/api/signals?view=messages&pairId=${encodeURIComponent(pairId)}`
      );
      setMessages(Array.isArray(result.messages) ? result.messages : []);
      setError(null);
      setEnded(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load messages.';
      if (message.toLowerCase().includes('ended')) setEnded(true);
      setError(message);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [pairId]);

  useEffect(() => {
    void loadMessages();
    const timer = window.setInterval(() => void loadMessages(true), 4000);
    return () => window.clearInterval(timer);
  }, [loadMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: messages.length > 1 ? 'smooth' : 'auto', block: 'end' });
  }, [messages]);

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending || ended) return;
    setSending(true);
    setError(null);
    try {
      const reply = replyingTo;
      const result = await request<SignalMessage>('/api/signals', {
        action: 'send-message',
        pairId,
        text,
        ...(reply ? {
          replyTo: {
            messageId: reply.id,
            text: reply.text,
            sender: reply.senderId === userId ? 'self' : 'partner',
          },
        } : {}),
      });
      setMessages((current) => current.some((item) => item.id === result.id) ? current : [...current, result]);
      setDraft('');
      setReplyingTo(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Message could not be sent.';
      if (message.toLowerCase().includes('ended')) setEnded(true);
      setError(message);
    } finally {
      setSending(false);
    }
  };

  const toggleReaction = async (message: SignalMessage, emoji: string) => {
    if (reactingId || ended) return;
    setReactingId(message.id);
    setError(null);
    try {
      await request('/api/signals', { action: 'react-message', pairId, messageId: message.id, emoji });
      await loadMessages(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update reaction.');
    } finally {
      setReactingId(null);
    }
  };

  return (
    <section aria-label="Private Signals conversation" className="relative mx-auto flex min-h-[min(620px,calc(100dvh-9rem))] w-full max-w-xl flex-col px-4 py-3 anim-rise sm:px-6 sm:py-5">
      <header className="mb-3 flex items-center gap-3 border-b border-line pb-3">
        <button type="button" onClick={onBack} aria-label="Back to Signals" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line text-muted transition hover:border-berry/50 hover:text-fg">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-lavender/20 bg-plum/30 text-lavender">
          <MessageCircle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold text-fg">A mutual connection</h1>
          <p className="mt-0.5 text-xs text-muted">{ended ? 'Connection ended' : 'Private conversation'}</p>
        </div>
        <button type="button" onClick={() => void loadMessages()} disabled={loading} aria-label="Refresh messages" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition hover:text-fg disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      <div className="mb-3 flex items-start gap-2 rounded-xl border border-line bg-raised/50 px-3 py-2.5">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-lavender" />
        <p className="text-[11px] leading-relaxed text-muted">A space for the two of you. Be kind, protect your privacy, and only share what feels comfortable.</p>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-2xl border border-line/70 bg-surface/40 p-3 sm:p-4" aria-live="polite" aria-relevant="additions">
        {loading && messages.length === 0 ? (
          <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted">
            <LoaderCircle className="h-4 w-4 animate-spin text-berry" /> Opening your conversation…
          </div>
        ) : messages.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center px-4 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-plum/30 text-lavender"><MessageCircle className="h-5 w-5" /></div>
            <p className="text-sm font-medium text-fg">A quiet little beginning</p>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted">Say hello when you're ready. There's no need to rush.</p>
          </div>
        ) : (
          messages.map((message) => {
            const mine = message.senderId === userId;
            return (
              <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] sm:max-w-[80%] ${mine ? 'text-right' : 'text-left'}`}>
                  <div className={`rounded-2xl px-3.5 py-2.5 text-left ${mine ? 'rounded-br-md bg-berry text-ink' : 'rounded-bl-md border border-line bg-raised text-fg'}`}>
                    {message.replyTo && (
                      <div className={`mb-2 rounded-lg border-l-2 px-2 py-1 text-left text-[11px] ${mine ? 'border-ink/40 bg-ink/10 text-ink/80' : 'border-lavender bg-surface/70 text-muted'}`}>
                        <p className="font-semibold">{message.replyTo.senderId === userId ? 'You replied to yourself' : message.replyTo.senderId === message.senderId ? 'Reply to your message' : 'Replying to a message'}</p>
                        <p className="truncate">{message.replyTo.text}</p>
                      </div>
                    )}
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.text}</p>
                    {message.createdAt && <p className={`mt-1 text-right text-[10px] ${mine ? 'text-ink/70' : 'text-subtle'}`}>{formatTime(message.createdAt)}</p>}
                  </div>
                  <div className={`mt-1 flex flex-wrap items-center gap-1.5 ${mine ? 'justify-end' : 'justify-start'}`}>
                    {(message.reactions || []).map((reaction) => (
                      <button key={reaction.emoji} type="button" onClick={() => void toggleReaction(message, reaction.emoji)} disabled={reactingId === message.id} aria-label={`${reaction.emoji} reaction, ${reaction.count} total`} className={`rounded-full border px-2 py-0.5 text-xs transition ${reaction.userReacted ? 'border-berry/60 bg-plum/40' : 'border-line bg-raised/70'} disabled:opacity-50`}>
                        {reaction.emoji} {reaction.count}
                      </button>
                    ))}
                    <button type="button" onClick={() => setReplyingTo(message)} aria-label="Reply to message" className="rounded-full px-2 py-1 text-[10px] text-muted transition hover:bg-raised hover:text-fg">
                      <Reply className="inline h-3 w-3" /> Reply
                    </button>
                    {['💜', '🥹', '😂', '✨'].map((emoji) => (
                      <button key={emoji} type="button" onClick={() => void toggleReaction(message, emoji)} disabled={reactingId === message.id} aria-label={`React with ${emoji}`} className="rounded-full px-1 py-0.5 text-xs opacity-70 transition hover:bg-raised hover:opacity-100 disabled:opacity-40">{emoji}</button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-berry/30 bg-plum/20 p-3 text-xs text-fg">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => void loadMessages()} className="font-semibold text-berry underline underline-offset-4">Retry</button>
        </div>
      )}

      {ended ? (
        <div className="mt-3 rounded-xl border border-line bg-raised/60 p-3 text-center text-sm text-muted">
          This connection has ended. Messaging is now closed.
          <button type="button" onClick={onBack} className="ml-2 font-semibold text-berry underline underline-offset-4">Back to Signals</button>
        </div>
      ) : (
        <>
        {replyingTo && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-raised/70 px-3 py-2">
            <Reply className="h-4 w-4 shrink-0 text-lavender" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold text-muted">Replying to {replyingTo.senderId === userId ? 'your message' : 'their message'}</p>
              <p className="truncate text-xs text-fg">{replyingTo.text}</p>
            </div>
            <button type="button" onClick={() => setReplyingTo(null)} aria-label="Cancel reply" className="rounded-full p-1 text-muted hover:text-fg"><X className="h-4 w-4" /></button>
          </div>
        )}
        <form onSubmit={sendMessage} className="mt-3 flex items-end gap-2">
          <label className="sr-only" htmlFor="signals-message">Your message</label>
          <textarea
            id="signals-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, 1000))}
            placeholder="Write a message…"
            rows={1}
            maxLength={1000}
            disabled={sending}
            className="max-h-32 min-h-11 flex-1 resize-y rounded-2xl border border-line bg-raised px-4 py-3 text-sm text-fg outline-none placeholder:text-subtle focus:border-berry/60 disabled:opacity-60"
          />
          <button type="submit" disabled={!draft.trim() || sending} aria-label="Send message" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-berry text-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
            {sending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
        </>
      )}
      {!ended && <p className="mt-2 text-center text-[10px] text-subtle">Messages refresh automatically · Up to 1,000 characters</p>}
    </section>
  );
};

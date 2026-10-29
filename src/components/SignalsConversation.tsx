import React, { FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, LoaderCircle, MessageCircle, RefreshCw, Reply, Send, X } from 'lucide-react';
import { auth } from '../lib/firebase.ts';
import { useVisualViewport } from '../hooks/useVisualViewportHeight.ts';
import { AnimalAvatar } from './AnimalAvatar.tsx';
import { isValidAvatar } from '../utils/avatar.ts';
import { soundEffects } from '../utils/sound.ts';
import { hasNewIncomingMessage } from '../utils/incomingMessage.ts';

type SignalMessage = {
  id: string;
  senderId: string;
  text: string;
  createdAt: string | null;
  replyTo?: { messageId: string; senderId: string; text: string } | null;
  reactions?: { emoji: string; count: number; userReacted: boolean }[];
};

/** The other member's public pseudonym and avatar, as returned by the Signals API. */
export type SignalsPartner = { displayName: string | null; avatar: string | null };

type SignalsConversationProps = {
  pairId: string;
  partner?: SignalsPartner;
  isSoundMuted?: boolean;
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

export const SignalsConversation: React.FC<SignalsConversationProps> = ({ pairId, partner, isSoundMuted = false, onBack }) => {
  const [messages, setMessages] = useState<SignalMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [replyingTo, setReplyingTo] = useState<SignalMessage | null>(null);
  const [reactingId, setReactingId] = useState<string | null>(null);
  /** Message whose Reply / reaction actions are open (tap or Enter on the bubble). */
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hasUnseen, setHasUnseen] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** True while the reader is at (or near) the newest message; scrolling up pauses auto-scroll. */
  const stickToBottom = useRef(true);
  const lastCount = useRef(0);
  const lastOwnSend = useRef(false);
  const lastMessageId = useRef<string | null>(null);
  /** Set after the first successful load, so a failed first load cannot make history chime later. */
  const loadedOnce = useRef(false);
  const soundMutedRef = useRef(isSoundMuted);
  soundMutedRef.current = isSoundMuted;
  const userId = auth?.currentUser?.uid;
  const partnerName = partner?.displayName?.trim() || 'Anonymous member';
  const { height: viewportHeight, offsetTop: viewportTop } = useVisualViewport();
  const coarsePointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  // On phones the keyboard overlays the page (iOS), so lift the conversation to the visible area while typing.
  const lifted = coarsePointer && composerFocused && viewportHeight !== null;
  const chrome = 'var(--header-h) - env(safe-area-inset-top) - var(--tabbar-h)';

  const loadMessages = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const result = await request<{ messages: SignalMessage[] }>(
        `/api/signals?view=messages&pairId=${encodeURIComponent(pairId)}`
      );
      const next = Array.isArray(result.messages) ? result.messages : [];
      if (!loadedOnce.current) {
        loadedOnce.current = true;
        lastMessageId.current = next.length ? next[next.length - 1].id : '';
      }
      setMessages(next);
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

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    stickToBottom.current = true;
    setHasUnseen(false);
  }, []);

  // Chime when the other member's message arrives (the list is polled); existing history stays silent.
  useEffect(() => {
    if (!loadedOnce.current) return;
    const mapped = messages.map((m) => ({ id: m.id, isSelf: m.senderId === userId }));
    if (hasNewIncomingMessage(lastMessageId.current, mapped) && !soundMutedRef.current) soundEffects.playMessageReceived();
    lastMessageId.current = mapped.length ? mapped[mapped.length - 1].id : '';
  }, [messages, userId]);

  // Follow new messages only while the reader is at the bottom (or just sent one); otherwise flag them.
  useLayoutEffect(() => {
    const grew = messages.length > lastCount.current;
    const first = lastCount.current === 0;
    lastCount.current = messages.length;
    if (!grew) return;
    if (first || stickToBottom.current || lastOwnSend.current) scrollToBottom(!first);
    else setHasUnseen(true);
    lastOwnSend.current = false;
  }, [messages, scrollToBottom]);

  // Opening the keyboard shrinks the list; keep the newest message in view if the reader was there.
  useEffect(() => {
    if (stickToBottom.current) scrollToBottom(false);
  }, [viewportHeight, lifted, scrollToBottom]);

  // Grow the composer with its text, up to a few lines.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, [draft]);

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
      lastOwnSend.current = true;
      if (!soundMutedRef.current) soundEffects.playMessageSent();
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
    <>
      {/* Keeps the page height while the conversation is lifted over the app header for typing. */}
      {lifted && <div aria-hidden="true" style={{ height: `calc(100dvh - ${chrome})` }} />}
      <section
        aria-label={`Private conversation with ${partnerName}`}
        className={`flex min-w-0 flex-col overflow-hidden bg-ink ${
          lifted ? 'fixed inset-x-0 top-0 z-[45] mx-auto w-full max-w-xl' : 'relative mx-auto w-full max-w-xl'
        }`}
        style={
          lifted
            ? { height: viewportHeight!, transform: viewportTop ? `translateY(${viewportTop}px)` : undefined }
            : { height: `calc(${viewportHeight ? `${viewportHeight}px` : '100dvh'} - ${chrome})` }
        }
      >
        <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-3 py-2">
          <button type="button" onClick={onBack} aria-label="Back to Signals" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition hover:text-fg">
            <ArrowLeft className="h-5 w-5" />
          </button>
          {isValidAvatar(partner?.avatar)
            ? <AnimalAvatar avatar={partner?.avatar} seed={pairId} className="h-9 w-9" />
            : <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-lavender/20 bg-plum/30 text-lavender"><MessageCircle className="h-4 w-4" /></div>}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[length:calc(15px_*_var(--fs,1))] font-semibold leading-tight text-fg" title={partnerName}>{partnerName}</h1>
            <p className="truncate text-[length:calc(11px_*_var(--fs,1))] leading-tight text-subtle">{ended ? 'Connection ended' : 'Private conversation · just the two of you'}</p>
          </div>
          <button type="button" onClick={() => void loadMessages()} disabled={loading} aria-label="Refresh messages" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition hover:text-fg disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </header>

        <div className="relative min-h-0 flex-1">
          <div
            ref={listRef}
            onScroll={(event) => {
              const el = event.currentTarget;
              const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              stickToBottom.current = atBottom;
              if (atBottom) setHasUnseen(false);
            }}
            className="h-full overflow-y-auto overscroll-contain px-3 py-2"
            aria-live="polite"
            aria-relevant="additions"
          >
            {loading && messages.length === 0 ? (
              <div className="flex h-full min-h-40 items-center justify-center gap-2 text-sm text-muted">
                <LoaderCircle className="h-4 w-4 animate-spin text-berry" /> Opening your conversation…
              </div>
            ) : messages.length === 0 ? (
              <div className="flex h-full min-h-40 flex-col items-center justify-center px-4 text-center">
                <p className="text-sm font-medium text-fg">A quiet little beginning</p>
                <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted">Say hello to {partnerName} when you're ready. There's no need to rush.</p>
              </div>
            ) : (
              messages.map((message, index) => {
                const mine = message.senderId === userId;
                const sameSenderAsPrev = index > 0 && messages[index - 1].senderId === message.senderId;
                const open = activeId === message.id;
                const toggleActive = () => setActiveId((current) => (current === message.id ? null : message.id));
                return (
                  <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'} ${index === 0 ? '' : sameSenderAsPrev ? 'mt-0.5' : 'mt-2'}`}>
                    <div className={`flex min-w-0 max-w-[82%] flex-col sm:max-w-[75%] ${mine ? 'items-end' : 'items-start'}`}>
                      <div
                        role="button"
                        tabIndex={0}
                        aria-expanded={open}
                        aria-label={`${mine ? 'Your' : `${partnerName}'s`} message: ${message.text}. Show actions`}
                        onClick={toggleActive}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleActive(); }
                        }}
                        className={`min-w-0 max-w-full cursor-pointer rounded-2xl px-3 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-berry/60 ${mine ? 'rounded-br-md bg-berry text-ink' : 'rounded-bl-md border border-line bg-raised text-fg'}`}
                      >
                        {message.replyTo && (
                          <div className={`mb-1 rounded-md border-l-2 px-2 py-0.5 text-[length:calc(11px_*_var(--fs,1))] leading-snug ${mine ? 'border-ink/40 bg-ink/10 text-ink/80' : 'border-lavender bg-surface/70 text-muted'}`}>
                            <p className="font-semibold">{message.replyTo.senderId === userId ? 'You' : partnerName}</p>
                            <p className="line-clamp-1 break-words">{message.replyTo.text}</p>
                          </div>
                        )}
                        <div className="flex flex-wrap items-end justify-end gap-x-2">
                          <p className="min-w-0 max-w-full flex-auto whitespace-pre-wrap break-words text-[length:calc(15px_*_var(--fs,1))] leading-snug">{message.text}</p>
                          {message.createdAt && <span className={`ml-auto translate-y-px select-none text-[length:calc(10px_*_var(--fs,1))] leading-snug tabular-nums ${mine ? 'text-ink/60' : 'text-subtle'}`}>{formatTime(message.createdAt)}</span>}
                        </div>
                      </div>
                      {((message.reactions || []).length > 0 || open) && (
                        <div className={`mt-0.5 flex flex-wrap items-center gap-1 ${mine ? 'justify-end' : 'justify-start'}`}>
                          {(message.reactions || []).map((reaction) => (
                            <button key={reaction.emoji} type="button" onClick={() => void toggleReaction(message, reaction.emoji)} disabled={reactingId === message.id} aria-label={`${reaction.emoji} reaction, ${reaction.count} total`} className={`flex h-7 min-w-7 items-center justify-center rounded-full border px-1.5 text-xs transition ${reaction.userReacted ? 'border-berry/60 bg-plum/40' : 'border-line bg-raised/70'} disabled:opacity-50`}>
                              {reaction.emoji}{reaction.count > 1 ? ` ${reaction.count}` : ''}
                            </button>
                          ))}
                          {open && !ended && (
                            <>
                              <button type="button" onClick={() => { setReplyingTo(message); setActiveId(null); textareaRef.current?.focus(); }} aria-label="Reply to message" className="flex h-8 items-center gap-1 rounded-full px-2 text-[length:calc(11px_*_var(--fs,1))] text-muted transition hover:bg-raised hover:text-fg">
                                <Reply className="h-3.5 w-3.5" /> Reply
                              </button>
                              {['💜', '🥹', '😂', '✨'].map((emoji) => (
                                <button key={emoji} type="button" onClick={() => { void toggleReaction(message, emoji); setActiveId(null); }} disabled={reactingId === message.id} aria-label={`React with ${emoji}`} className="flex h-8 w-8 items-center justify-center rounded-full text-sm transition hover:bg-raised disabled:opacity-40">{emoji}</button>
                              ))}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {hasUnseen && (
            <button type="button" onClick={() => scrollToBottom(true)} className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-berry/40 bg-raised/95 px-3 py-1.5 text-xs font-semibold text-fg shadow-lg shadow-black/40">
              <ArrowDown className="h-3.5 w-3.5 text-berry" /> New messages
            </button>
          )}
        </div>

        {error && (
          <div role="alert" className="mx-3 mb-1 flex shrink-0 items-start gap-2 rounded-xl border border-berry/30 bg-plum/20 px-3 py-2 text-xs text-fg">
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => void loadMessages()} className="font-semibold text-berry underline underline-offset-4">Retry</button>
          </div>
        )}

        {ended ? (
          <div className="shrink-0 border-t border-line bg-raised/60 p-3 text-center text-sm text-muted">
            This connection has ended. Messaging is now closed.
            <button type="button" onClick={onBack} className="ml-2 font-semibold text-berry underline underline-offset-4">Back to Signals</button>
          </div>
        ) : (
          <div className="shrink-0 border-t border-line bg-ink px-3 pb-2 pt-2">
            {replyingTo && (
              <div className="mb-1.5 flex items-center gap-2 rounded-xl border border-line bg-raised/70 px-3 py-1.5">
                <Reply className="h-4 w-4 shrink-0 text-lavender" />
                <div className="min-w-0 flex-1">
                  <p className="text-[length:calc(10px_*_var(--fs,1))] font-semibold text-muted">Replying to {replyingTo.senderId === userId ? 'yourself' : partnerName}</p>
                  <p className="truncate text-xs text-fg">{replyingTo.text}</p>
                </div>
                <button type="button" onClick={() => setReplyingTo(null)} aria-label="Cancel reply" className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:text-fg"><X className="h-4 w-4" /></button>
              </div>
            )}
            <form onSubmit={sendMessage} className="flex items-end gap-2">
              <label className="sr-only" htmlFor="signals-message">Your message</label>
              <textarea
                ref={textareaRef}
                id="signals-message"
                value={draft}
                onChange={(event) => setDraft(event.target.value.slice(0, 1000))}
                onFocus={() => setComposerFocused(true)}
                onBlur={() => setComposerFocused(false)}
                placeholder="Write a message…"
                rows={1}
                maxLength={1000}
                disabled={sending}
                className="max-h-28 min-h-10 min-w-0 flex-1 resize-none rounded-2xl border border-line bg-raised px-3.5 py-2 text-[length:calc(15px_*_var(--fs,1))] leading-snug text-fg outline-none placeholder:text-subtle focus:border-berry/60 disabled:opacity-60"
              />
              <button type="submit" disabled={!draft.trim() || sending} aria-label="Send message" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-berry text-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
                {sending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </form>
          </div>
        )}
      </section>
    </>
  );
};

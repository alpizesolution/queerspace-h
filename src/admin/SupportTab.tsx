import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUp } from 'lucide-react';
import { AnimalAvatar } from '../components/AnimalAvatar.tsx';
import { formatChatTime } from '../utils/matching-logic.ts';
import {
  markSupportReadByTeam,
  replyAsTeam,
  SUPPORT_MAX_LENGTH,
  SupportMessage,
  SupportThread,
  subscribeToSupportMessages,
  subscribeToSupportThreads,
  TEAM_NAME,
} from '../services/supportService.ts';
import { whileActive } from '../utils/whileActive.ts';
import { useVisualViewportHeight } from '../hooks/useVisualViewportHeight.ts';

/** Admin inbox for member support chats. Listeners run only while this tab is open. */
export const SupportTab: React.FC<{ formatAgo: (ms: number) => string; onUnreadChange: (n: number) => void }> = ({
  formatAgo,
  onUnreadChange,
}) => {
  const [threads, setThreads] = useState<SupportThread[] | null>(null);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // On phones the conversation is its own screen, so remember where the inbox was scrolled and put it back.
  const listScroll = useRef(0);
  const openThread = (id: string) => {
    listScroll.current = window.scrollY;
    setOpenId(id);
    window.scrollTo({ top: 0 });
  };
  const closeThread = () => {
    setOpenId(null);
    requestAnimationFrame(() => window.scrollTo({ top: listScroll.current }));
  };

  useEffect(
    () =>
      whileActive(() =>
        subscribeToSupportThreads(
          (next) => {
            setThreads(next);
            onUnreadChange(next.filter((t) => t.unreadForTeam).length);
          },
          () => {
            setThreads([]);
            setError(true);
          }
        )
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const open = threads?.find((t) => t.id === openId) ?? null;

  return (
    <div className="min-w-0">
      <h1 className={`mb-1 text-2xl font-semibold tracking-tight ${open ? 'hidden md:block' : ''}`}>Support</h1>
      <p className={`mb-4 text-[length:calc(13px_*_var(--fs,1))] text-muted sm:mb-5 ${open ? 'hidden md:block' : ''}`}>
        <span className="sm:hidden">Private messages to the {TEAM_NAME}.</span>
        <span className="hidden sm:inline">
          Private chats from “Chat with us”. Replies show as {TEAM_NAME}, and the member sees them next time they open
          the app.
        </span>
      </p>
      {error && <p className="card p-4 mb-4 text-sm text-danger">Support chats couldn’t load. Try again.</p>}

      {/* Single column on phones; inbox + conversation side by side from tablet width up. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] desk:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div
          className={`min-w-0 self-start overflow-hidden rounded-2xl border border-line bg-surface md:max-h-[75dvh] md:overflow-y-auto ${
            open ? 'hidden md:block' : ''
          }`}
        >
          {!threads ? (
            <p className="px-4 py-4 text-[length:calc(13px_*_var(--fs,1))] text-subtle">Loading…</p>
          ) : threads.length === 0 ? (
            <p className="px-4 py-4 text-[length:calc(13px_*_var(--fs,1))] text-subtle">No support chats yet.</p>
          ) : (
            <ul className="divide-y divide-line/60">
              {threads.map((t) => (
                <li key={t.id} className="min-w-0">
                  <button
                    onClick={() => openThread(t.id)}
                    aria-current={t.id === openId ? 'true' : undefined}
                    className={`flex w-full min-w-0 min-h-[64px] items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer hover:bg-raised/70 active:bg-raised focus-visible:outline-none focus-visible:bg-raised focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-berry/60 ${
                      t.id === openId ? 'bg-raised' : ''
                    }`}
                  >
                    <AnimalAvatar avatar={t.avatar} seed={t.id} className="h-11 w-11 shrink-0" />
                    <span className="block min-w-0 flex-1">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span
                          className={`min-w-0 flex-1 truncate text-[length:calc(15px_*_var(--fs,1))] leading-tight ${
                            t.unreadForTeam ? 'font-semibold text-fg' : 'font-medium text-fg/90'
                          }`}
                        >
                          {t.displayName}
                        </span>
                        <span className="shrink-0 text-[length:calc(11px_*_var(--fs,1))] text-subtle">{formatAgo(t.updatedAt)}</span>
                      </span>
                      <span className="mt-0.5 flex min-w-0 items-start gap-2">
                        <span
                          className={`line-clamp-1 min-w-0 flex-1 break-words text-[length:calc(13px_*_var(--fs,1))] leading-snug sm:line-clamp-2 ${
                            t.unreadForTeam ? 'text-muted' : 'text-subtle'
                          }`}
                        >
                          {t.lastFrom === 'team' ? 'You: ' : ''}
                          {t.lastMessage}
                        </span>
                        {t.unreadForTeam && (
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-berry">
                            <span className="sr-only">Unread</span>
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {open ? (
          <SupportConversation key={open.id} thread={open} onBack={closeThread} />
        ) : (
          <div className="hidden min-w-0 items-center justify-center rounded-2xl border border-line bg-surface p-8 text-[length:calc(13px_*_var(--fs,1))] text-subtle md:flex">
            Pick a chat to read and reply.
          </div>
        )}
      </div>
    </div>
  );
};

const SupportConversation: React.FC<{ thread: SupportThread; onBack: () => void }> = ({ thread, onBack }) => {
  const [messages, setMessages] = useState<SupportMessage[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  // Phones: fill the screen between the admin header and tab bar, shrinking with the on-screen keyboard.
  const viewportHeight = useVisualViewportHeight();
  const screenHeight = `calc(${viewportHeight ? `${viewportHeight}px` : '100dvh'} - var(--header-h) - env(safe-area-inset-top) - var(--tabbar-h) - 1.5rem)`;

  useEffect(
    () => whileActive(() => subscribeToSupportMessages(thread.id, setMessages, () => setMessages([]))),
    [thread.id]
  );

  // Opening a chat with a new member message marks it read for the team.
  useEffect(() => {
    if (thread.unreadForTeam) markSupportReadByTeam(thread.id);
  }, [thread.id, thread.unreadForTeam]);

  useEffect(() => {
    // Scroll the message list itself, never the whole page.
    const list = endRef.current?.parentElement;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages?.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    setFailed(false);
    const ok = await replyAsTeam(thread.id, text);
    setSending(false);
    if (ok) setText('');
    else setFailed(true);
  };

  return (
    <section
      className="card flex min-w-0 flex-col h-[var(--conv-h)] md:h-[calc(var(--conv-h)-8.5rem)] desk:h-auto desk:min-h-[60dvh] desk:max-h-[75dvh]"
      style={{ '--conv-h': screenHeight } as React.CSSProperties}
      aria-label={`Chat with ${thread.displayName}`}
    >
      <header className="flex shrink-0 items-center gap-3 px-2 py-2 border-b border-line md:p-3">
        <button onClick={onBack} className="icon-btn w-11 h-11 -ml-1 md:hidden" aria-label="Back to support chats">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <AnimalAvatar avatar={thread.avatar} seed={thread.id} className="w-8 h-8" />
        <p className="min-w-0 flex-1 truncate text-[length:calc(14px_*_var(--fs,1))] font-semibold text-fg">{thread.displayName}</p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-3 md:p-4">
        {!messages ? (
          <p className="text-[length:calc(13px_*_var(--fs,1))] text-subtle">Loading…</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex flex-col ${m.from === 'team' ? 'items-end' : 'items-start'}`}>
              <p className="mb-1 px-1 text-[length:calc(11px_*_var(--fs,1))] text-subtle">
                {m.from === 'team' ? TEAM_NAME : thread.displayName} · {formatChatTime(m.timestamp)}
              </p>
              <div
                className={`max-w-[85%] px-3.5 py-2 text-[length:calc(14px_*_var(--fs,1))] leading-snug rounded-[18px] break-words [overflow-wrap:anywhere] whitespace-pre-wrap ${
                  m.from === 'team' ? 'bg-plum text-fg rounded-br-md' : 'bg-raised text-fg rounded-bl-md'
                }`}
              >
                {m.text}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {failed && (
        <p className="px-4 pb-1 text-[length:calc(12px_*_var(--fs,1))] text-danger" role="alert">
          Couldn’t send the reply. Try again.
        </p>
      )}
      <form onSubmit={send} className="flex shrink-0 items-end gap-2 p-3 border-t border-line">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) send(e);
          }}
          rows={2}
          maxLength={SUPPORT_MAX_LENGTH}
          placeholder={`Reply as ${TEAM_NAME}`}
          aria-label={`Reply to ${thread.displayName}`}
          className="flex-1 min-w-0 resize-none px-3.5 py-2.5 rounded-2xl bg-ink border border-line text-base md:text-[length:calc(14px_*_var(--fs,1))] text-fg placeholder:text-subtle focus:outline-none focus:border-berry"
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          className="w-11 h-11 shrink-0 rounded-full bg-berry text-ink flex items-center justify-center disabled:bg-raised disabled:text-subtle cursor-pointer disabled:cursor-not-allowed"
          aria-label="Send reply"
        >
          <ArrowUp className="w-5 h-5" strokeWidth={2.5} />
        </button>
      </form>
    </section>
  );
};

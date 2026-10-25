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

/** Admin inbox for member support chats. Listeners run only while this tab is open. */
export const SupportTab: React.FC<{ formatAgo: (ms: number) => string; onUnreadChange: (n: number) => void }> = ({
  formatAgo,
  onUnreadChange,
}) => {
  const [threads, setThreads] = useState<SupportThread[] | null>(null);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(
    () =>
      subscribeToSupportThreads(
        (next) => {
          setThreads(next);
          onUnreadChange(next.filter((t) => t.unreadForTeam).length);
        },
        () => {
          setThreads([]);
          setError(true);
        }
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const open = threads?.find((t) => t.id === openId) ?? null;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Support</h1>
      <p className="text-[13px] text-muted mb-5">
        Private chats from “Chat with us”. Replies show as {TEAM_NAME}, and the member sees them next time they open
        the app.
      </p>
      {error && <p className="card p-4 mb-4 text-sm text-danger">Support chats couldn’t load. Try again.</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <ul className={`card divide-y divide-line self-start ${open ? 'hidden lg:block' : ''}`}>
          {!threads ? (
            <li className="p-4 text-[13px] text-subtle">Loading…</li>
          ) : threads.length === 0 ? (
            <li className="p-4 text-[13px] text-subtle">No support chats yet.</li>
          ) : (
            threads.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => setOpenId(t.id)}
                  className={`w-full flex items-start gap-3 p-3 text-left hover:bg-raised transition-colors cursor-pointer ${
                    t.id === openId ? 'bg-raised' : ''
                  }`}
                >
                  <AnimalAvatar avatar={t.avatar} seed={t.id} className="w-9 h-9 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={`truncate text-[14px] ${t.unreadForTeam ? 'font-semibold text-fg' : 'text-muted'}`}>
                        {t.displayName}
                      </span>
                      <span className="ml-auto shrink-0 text-[11px] text-subtle">{formatAgo(t.updatedAt)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[12.5px] text-subtle">
                        {t.lastFrom === 'team' ? 'You: ' : ''}
                        {t.lastMessage}
                      </span>
                      {t.unreadForTeam && (
                        <span className="ml-auto w-2 h-2 shrink-0 rounded-full bg-berry">
                          <span className="sr-only">Unread</span>
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>

        {open ? (
          <SupportConversation key={open.id} thread={open} onBack={() => setOpenId(null)} />
        ) : (
          <div className="hidden lg:flex card p-8 items-center justify-center text-[13px] text-subtle">
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

  useEffect(
    () => subscribeToSupportMessages(thread.id, setMessages, () => setMessages([])),
    [thread.id]
  );

  // Opening a chat with a new member message marks it read for the team.
  useEffect(() => {
    if (thread.unreadForTeam) markSupportReadByTeam(thread.id);
  }, [thread.id, thread.unreadForTeam]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
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
    <section className="card flex flex-col min-h-[60dvh] max-h-[75dvh]" aria-label={`Chat with ${thread.displayName}`}>
      <header className="flex items-center gap-3 p-3 border-b border-line">
        <button onClick={onBack} className="icon-btn w-9 h-9 lg:hidden" aria-label="Back to support chats">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <AnimalAvatar avatar={thread.avatar} seed={thread.id} className="w-8 h-8" />
        <p className="text-[14px] font-semibold text-fg truncate">{thread.displayName}</p>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {!messages ? (
          <p className="text-[13px] text-subtle">Loading…</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex flex-col ${m.from === 'team' ? 'items-end' : 'items-start'}`}>
              <p className="mb-1 px-1 text-[11px] text-subtle">
                {m.from === 'team' ? TEAM_NAME : thread.displayName} · {formatChatTime(m.timestamp)}
              </p>
              <div
                className={`max-w-[85%] px-3.5 py-2 text-[14px] leading-snug rounded-[18px] break-words whitespace-pre-wrap ${
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
        <p className="px-4 pb-1 text-[12px] text-danger" role="alert">
          Couldn’t send the reply. Try again.
        </p>
      )}
      <form onSubmit={send} className="flex items-end gap-2 p-3 border-t border-line">
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
          className="flex-1 min-w-0 resize-none px-3.5 py-2.5 rounded-2xl bg-ink border border-line text-[14px] text-fg placeholder:text-subtle focus:outline-none focus:border-berry"
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          className="w-10 h-10 shrink-0 rounded-full bg-berry text-ink flex items-center justify-center disabled:bg-raised disabled:text-subtle cursor-pointer disabled:cursor-not-allowed"
          aria-label="Send reply"
        >
          <ArrowUp className="w-5 h-5" strokeWidth={2.5} />
        </button>
      </form>
    </section>
  );
};

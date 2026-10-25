import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, BadgeCheck, Trash2 } from 'lucide-react';
import { AnimalAvatar } from '../components/AnimalAvatar.tsx';
import { formatChatTime } from '../utils/matching-logic.ts';
import { deleteRoomMessage } from '../services/adminService.ts';
import { sendTeamRoomMessage, subscribeToPublicRoom } from '../services/publicRoomService.ts';
import { TEAM_NAME } from '../services/supportService.ts';
import type { PublicRoomMessage } from '../types.ts';

interface RoomTabProps {
  onConfirm: (c: { title: string; message: string; confirmLabel: string; run: () => Promise<void> }) => void;
}

/** The live Public Room for admins: read along, post as the team, delete messages. */
export const RoomTab: React.FC<RoomTabProps> = ({ onConfirm }) => {
  const [messages, setMessages] = useState<PublicRoomMessage[] | null>(null);
  const [error, setError] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      subscribeToPublicRoom(setMessages, () => {
        setMessages([]);
        setError(true);
      }),
    []
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages?.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    setFailed(false);
    const id = await sendTeamRoomMessage(text);
    setSending(false);
    if (id) setText('');
    else setFailed(true);
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Public Room</h1>
      <p className="text-[13px] text-muted mb-4">Live. Your posts here show as {TEAM_NAME} with a Team badge.</p>
      {error && <p className="card p-4 mb-4 text-sm text-danger">The room couldn’t load. Try again.</p>}

      <section className="card flex flex-col h-[calc(100dvh-var(--header-h)-var(--tabbar-h)-11rem)] sm:h-[65dvh] min-h-[320px]">
        <div className="flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4 space-y-3">
          {!messages ? (
            <p className="text-[13px] text-subtle">Loading…</p>
          ) : messages.length === 0 ? (
            <p className="text-[13px] text-subtle">No messages yet.</p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className="group flex items-start gap-2.5">
                {m.team ? (
                  <span
                    aria-hidden="true"
                    className="w-8 h-8 shrink-0 rounded-full bg-berry text-ink flex items-center justify-center text-[15px] font-bold"
                  >
                    Q
                  </span>
                ) : (
                  <AnimalAvatar avatar={m.authorAvatar} seed={m.authorId || m.author} className="w-8 h-8 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-[12px]">
                    <span className={`font-semibold truncate ${m.team ? 'text-berry' : 'text-fg'}`}>{m.author}</span>
                    {m.team && <BadgeCheck className="w-3.5 h-3.5 text-berry shrink-0" aria-label="Team" />}
                    <span className="text-subtle shrink-0">{formatChatTime(m.timestamp)}</span>
                  </p>
                  <p className="text-[14px] text-fg break-words whitespace-pre-wrap">{m.text}</p>
                </div>
                <button
                  onClick={() =>
                    onConfirm({
                      title: 'Delete this message?',
                      message: `“${m.text.slice(0, 80)}${m.text.length > 80 ? '…' : ''}” will be removed for everyone.`,
                      confirmLabel: 'Delete',
                      run: () => deleteRoomMessage(m.id),
                    })
                  }
                  className="icon-btn w-8 h-8 shrink-0"
                  aria-label={`Delete message from ${m.author}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>

        {failed && (
          <p className="px-4 pb-1 text-[12px] text-danger" role="alert">
            Couldn’t post. Try again.
          </p>
        )}
        <form onSubmit={send} className="flex items-center gap-2 p-3 border-t border-line">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            placeholder={`Message as ${TEAM_NAME}`}
            aria-label={`Post to the Public Room as ${TEAM_NAME}`}
            enterKeyHint="send"
            autoComplete="off"
            className="flex-1 min-w-0 h-11 px-4 rounded-full bg-ink border border-line text-base sm:text-[14px] text-fg placeholder:text-subtle focus:outline-none focus:border-berry"
          />
          <button
            type="submit"
            onMouseDown={(e) => e.preventDefault()}
            disabled={!text.trim() || sending}
            className="w-11 h-11 shrink-0 rounded-full bg-berry text-ink flex items-center justify-center disabled:bg-raised disabled:text-subtle cursor-pointer disabled:cursor-not-allowed"
            aria-label="Post as team"
          >
            <ArrowUp className="w-5 h-5" strokeWidth={2.5} />
          </button>
        </form>
      </section>
    </div>
  );
};

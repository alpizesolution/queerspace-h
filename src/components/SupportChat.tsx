import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, LifeBuoy } from 'lucide-react';
import { Sheet } from './Sheet.tsx';
import { UserPreferences } from '../types.ts';
import { formatChatTime } from '../utils/matching-logic.ts';
import {
  getMySupportThreadId,
  markSupportReadByUser,
  sendSupportMessage,
  SUPPORT_MAX_LENGTH,
  SupportMessage,
  subscribeToSupportMessages,
  TEAM_NAME,
} from '../services/supportService.ts';

interface SupportChatProps {
  userPrefs: UserPreferences;
  onClose: () => void;
  onOpenSuggestions: () => void;
}

/** Private chat with the QUEERSPACE team. Only this member and admins can read it. */
export const SupportChat: React.FC<SupportChatProps> = ({ userPrefs, onClose, onOpenSuggestions }) => {
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let unsubscribe = () => {};
    let cancelled = false;
    getMySupportThreadId().then((uid) => {
      if (cancelled) return;
      if (!uid) {
        setStatus('error');
        return;
      }
      unsubscribe = subscribeToSupportMessages(
        uid,
        (next) => {
          setMessages(next);
          setStatus('ready');
        },
        () => setStatus('error')
      );
    });
    // Opening the chat counts as reading the team's latest reply.
    markSupportReadByUser();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean || sending) return;
    setSending(true);
    setNotice(null);
    const result = await sendSupportMessage(userPrefs, clean);
    setSending(false);
    if (result === 'sent') setText('');
    else if (result === 'too-fast') setNotice('One sec, sending a bit fast. Try again.');
    else setNotice("Couldn't send. Check your connection and try again.");
  };

  return (
    <Sheet
      title="Chat with us"
      onClose={onClose}
      size="md"
      icon={
        <span className="w-9 h-9 rounded-xl bg-berry/15 text-berry flex items-center justify-center">
          <LifeBuoy className="w-[18px] h-[18px]" />
        </span>
      }
      footer={
        <>
          {notice && (
            <p className="pb-2 text-[length:calc(12px_*_var(--fs,1))] text-danger" role="alert">
              {notice}
            </p>
          )}
          <form onSubmit={handleSend} className="flex items-center gap-2">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={SUPPORT_MAX_LENGTH}
              disabled={status === 'error'}
              placeholder="Write to the team"
              aria-label="Message the QUEERSPACE team"
              enterKeyHint="send"
              autoComplete="off"
              className="flex-1 min-w-0 h-11 px-4 rounded-full bg-ink border border-line text-base sm:text-[length:calc(15px_*_var(--fs,1))] text-fg placeholder:text-subtle focus:outline-none focus:border-berry"
            />
            <button
              type="submit"
              onMouseDown={(e) => e.preventDefault()}
              disabled={!text.trim() || sending}
              className="w-11 h-11 shrink-0 rounded-full bg-berry text-ink flex items-center justify-center transition-all disabled:bg-raised disabled:text-subtle cursor-pointer disabled:cursor-not-allowed active:scale-95"
              aria-label="Send to the team"
            >
              <ArrowUp className="w-5 h-5" strokeWidth={2.5} />
            </button>
          </form>
          <button
            onClick={onOpenSuggestions}
            className="mt-2 w-full text-center text-[length:calc(12px_*_var(--fs,1))] text-subtle hover:text-fg transition-colors cursor-pointer"
          >
            Have an idea instead? Send a suggestion
          </button>
        </>
      }
    >
      <div className="min-h-[40dvh] flex flex-col gap-3 pt-1" aria-live="polite">
        <div className="flex items-end gap-2">
          <TeamAvatar />
          <div className="max-w-[85%]">
            <p className="mb-1 px-1 text-[length:calc(12px_*_var(--fs,1))] font-semibold text-fg">{TEAM_NAME}</p>
            <div className="min-w-0 px-3.5 py-2 text-[length:calc(14.5px_*_var(--fs,1))] leading-snug rounded-[20px] rounded-bl-md bg-raised text-fg">
              Hi {userPrefs.displayName || 'there'} 💜 Questions, a bug, or something that feels unsafe? Message us
              here. Only you and the team can see this chat, and we usually reply within a day.
            </div>
          </div>
        </div>

        {status === 'error' && (
          <p className="text-center text-[length:calc(13px_*_var(--fs,1))] text-muted py-4">
            Can't reach support right now. You can still email us from Suggestions.
          </p>
        )}

        {messages.map((msg) =>
          msg.from === 'team' ? (
            <div key={msg.id} className="flex items-end gap-2">
              <TeamAvatar />
              <div className="max-w-[85%]">
                <p className="mb-1 px-1 text-[length:calc(12px_*_var(--fs,1))]">
                  <span className="font-semibold text-fg">{TEAM_NAME}</span>
                  <span className="text-subtle"> · {formatChatTime(msg.timestamp)}</span>
                </p>
                <div className="px-3.5 py-2 text-[length:calc(14.5px_*_var(--fs,1))] leading-snug rounded-[20px] rounded-bl-md bg-raised text-fg [overflow-wrap:anywhere] whitespace-pre-wrap">
                  {msg.text}
                </div>
              </div>
            </div>
          ) : (
            <div key={msg.id} className="flex flex-col items-end">
              <p className="mb-1 px-1 text-[length:calc(12px_*_var(--fs,1))] text-subtle">{formatChatTime(msg.timestamp)}</p>
              <div className="min-w-0 max-w-[85%] px-3.5 py-2 text-[length:calc(14.5px_*_var(--fs,1))] leading-snug rounded-[20px] rounded-br-md bg-plum text-fg [overflow-wrap:anywhere] whitespace-pre-wrap">
                {msg.text}
              </div>
            </div>
          )
        )}
        <div ref={endRef} />
      </div>
    </Sheet>
  );
};

const TeamAvatar = () => (
  <span
    aria-hidden="true"
    className="w-8 h-8 shrink-0 rounded-full bg-berry text-ink flex items-center justify-center text-[length:calc(15px_*_var(--fs,1))] font-bold"
  >
    Q
  </span>
);

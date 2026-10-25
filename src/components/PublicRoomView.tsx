import React, { useState, useEffect, useRef } from 'react';
import { AnimalAvatar } from './AnimalAvatar.tsx';
import { ArrowUp, BadgeCheck, Users } from 'lucide-react';
import { useVisualViewportHeight } from '../hooks/useVisualViewportHeight.ts';
import { PublicRoomMessage, UserPreferences } from '../types.ts';
import { formatChatTime, sanitizeMessageText } from '../utils/matching-logic.ts';
import { soundEffects } from '../utils/sound.ts';
import {
  canPostAsTeam,
  isPublicRoomAvailable,
  sendPublicRoomMessage,
  sendTeamRoomMessage,
  subscribeToPublicRoom,
} from '../services/publicRoomService.ts';
import { TEAM_NAME } from '../services/supportService.ts';

interface PublicRoomViewProps {
  userPrefs: UserPreferences;
  isSoundMuted: boolean;
  onOpenDonationModal?: () => void;
}

export const PublicRoomView: React.FC<PublicRoomViewProps> = ({
  userPrefs,
  isSoundMuted,
  onOpenDonationModal,
}) => {
  const [messages, setMessages] = useState<PublicRoomMessage[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(() =>
    isPublicRoomAvailable() ? 'loading' : 'error'
  );
  const [sendError, setSendError] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastCountRef = useRef(0);
  // Admins signed in on this device can post as the team without leaving the room.
  const [teamAvailable, setTeamAvailable] = useState(false);
  const [asTeam, setAsTeam] = useState(false);

  useEffect(() => {
    let cancelled = false;
    canPostAsTeam().then((ok) => {
      if (!cancelled) setTeamAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isPublicRoomAvailable()) return;
    return subscribeToPublicRoom(
      (next) => {
        setMessages(next);
        setStatus('ready');
      },
      () => setStatus('error')
    );
  }, []);

  // Auto-scroll and chime when someone else's message arrives.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    const latest = messages[messages.length - 1];
    if (lastCountRef.current > 0 && messages.length > lastCountRef.current && latest && !latest.isSelf && !isSoundMuted) {
      soundEffects.playMessageReceived();
    }
    lastCountRef.current = messages.length;
  }, [messages, isSoundMuted]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (inputText.trim() === '/donate') {
      setInputText('');
      onOpenDonationModal?.();
      return;
    }

    const sanitized = sanitizeMessageText(inputText);
    if (sanitized.isBlocked) {
      setSendError(sanitized.warning ?? "That message can't be sent.");
      return;
    }

    setInputText('');
    setSendError(null);
    const result =
      teamAvailable && asTeam
        ? (await sendTeamRoomMessage(sanitized.cleanText))
          ? 'sent'
          : 'failed'
        : await sendPublicRoomMessage(userPrefs, sanitized.cleanText);
    if (result !== 'sent') {
      setInputText(sanitized.cleanText);
      setSendError(
        result === 'too-fast'
          ? 'Slow down a little, then try again.'
          : "Couldn't send. Check your connection and try again."
      );
      return;
    }
    if (!isSoundMuted) soundEffects.playMessageSent();
  };

  const viewportHeight = useVisualViewportHeight();
  const chrome = 'var(--header-h) - env(safe-area-inset-top) - var(--tabbar-h)';

  return (
    <div
      className="flex flex-col max-w-3xl mx-auto w-full md:border-x md:border-line"
      style={{ height: `calc(${viewportHeight ? `${viewportHeight}px` : '100dvh'} - ${chrome})` }}
    >
      <div className="px-4 sm:px-5 py-3 border-b border-line flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-raised border border-line flex items-center justify-center text-berry shrink-0">
          <Users className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold text-fg">Public Room</h1>
          <p className="text-[12px] text-subtle truncate">Everyone here can see what you write. Be kind.</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-3 sm:px-5 py-4 space-y-4" aria-live="polite">
        {status === 'error' && (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <p className="text-[15px] font-medium text-fg">Can't reach the room</p>
            <p className="text-[13px] text-muted mt-1">Check your connection and try again.</p>
          </div>
        )}

        {status === 'ready' && messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <p className="text-[15px] font-medium text-fg">It's quiet in here</p>
            <p className="text-[13px] text-muted mt-1">Say hi, or share what you're reading or listening to.</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex items-end gap-2 ${msg.isSelf ? 'flex-row-reverse' : ''}`}>
            {!msg.isSelf &&
              (msg.team ? (
                <span
                  aria-hidden="true"
                  className="w-8 h-8 shrink-0 rounded-full bg-berry text-ink flex items-center justify-center text-[15px] font-bold"
                >
                  Q
                </span>
              ) : (
                <AnimalAvatar avatar={msg.authorAvatar} seed={msg.authorId || msg.author} className="w-8 h-8" />
              ))}

            <div className={`max-w-[80%] flex flex-col ${msg.isSelf ? 'items-end' : 'items-start'}`}>
              <div className="flex items-baseline gap-1.5 mb-1 px-1 text-[12px]">
                {!msg.isSelf && <span className="font-semibold text-fg">{msg.author}</span>}
                {msg.team && (
                  <span className="inline-flex items-center gap-1 self-center px-1.5 py-px rounded-full bg-berry/15 text-berry text-[10.5px] font-semibold uppercase tracking-wide">
                    <BadgeCheck className="w-3 h-3" aria-hidden="true" />
                    Team
                  </span>
                )}
                {!msg.isSelf && !msg.team && <span className="text-subtle">{msg.authorPronouns}</span>}
                <span className="text-subtle">{formatChatTime(msg.timestamp)}</span>
              </div>
              <div
                className={`px-3.5 py-2 text-[15px] leading-snug rounded-[20px] break-words whitespace-pre-wrap ${
                  msg.isSelf
                    ? 'bg-plum text-fg rounded-br-md'
                    : msg.team
                      ? 'bg-berry/10 border border-berry/30 text-fg rounded-bl-md'
                      : 'bg-raised text-fg rounded-bl-md'
                }`}
              >
                {msg.text}
              </div>
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {sendError && (
        <p className="px-4 pt-2 text-[12px] text-danger border-t border-line" role="alert">
          {sendError}
        </p>
      )}
      {teamAvailable && (
        <div className="flex items-center gap-2 px-3 sm:px-4 pt-2.5 border-t border-line" role="group" aria-label="Post as">
          <span className="text-[12px] text-subtle">Post as</span>
          {[
            { team: false, label: userPrefs.displayName || 'You' },
            { team: true, label: TEAM_NAME },
          ].map((opt) => (
            <button
              key={String(opt.team)}
              type="button"
              // Keep the keyboard open: a blur here would shift the layout mid-tap.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setAsTeam(opt.team)}
              aria-pressed={asTeam === opt.team}
              className={`chip h-7 px-2.5 text-[12px] max-w-[45%] truncate ${
                asTeam === opt.team ? (opt.team ? '!bg-berry !text-ink !border-berry' : '!bg-fg !text-ink !border-fg') : ''
              }`}
            >
              {opt.team && <BadgeCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
              <span className="truncate">{opt.label}</span>
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={handleSendMessage}
        className={`flex items-center gap-2 px-3 sm:px-4 py-2.5 ${teamAvailable ? '' : 'border-t border-line'}`}
      >
        <input
          type="text"
          value={inputText}
          onChange={(e) => {
            setInputText(e.target.value);
            if (sendError) setSendError(null);
          }}
          maxLength={1000}
          disabled={status === 'error'}
          placeholder={`Message as ${teamAvailable && asTeam ? TEAM_NAME : userPrefs.displayName || 'Sapphic Guest'}`}
          aria-label="Message the public room"
          enterKeyHint="send"
          autoComplete="off"
          className="flex-1 min-w-0 h-11 px-4 rounded-full bg-surface border border-line text-base sm:text-[15px] text-fg placeholder:text-subtle focus:outline-none focus:border-berry"
        />
        <button
          type="submit"
          // Keep focus in the input so the keyboard stays open and the tab bar doesn't
          // reappear mid-tap (which would shift the layout and swallow the click).
          onMouseDown={(e) => e.preventDefault()}
          disabled={!inputText.trim()}
          className="w-11 h-11 shrink-0 rounded-full bg-berry text-ink flex items-center justify-center transition-all disabled:bg-raised disabled:text-subtle cursor-pointer disabled:cursor-not-allowed active:scale-95"
          aria-label="Send to public room"
        >
          <ArrowUp className="w-5 h-5" strokeWidth={2.5} />
        </button>
      </form>
    </div>
  );
};

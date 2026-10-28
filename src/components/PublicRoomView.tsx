import React, { useState, useEffect, useRef } from 'react';
import { ReactableBubble } from './ReactionPicker.tsx';
import { AnimalAvatar } from './AnimalAvatar.tsx';
import { ArrowUp, BadgeCheck, CheckCircle2, Reply, Trash2, Users, X } from 'lucide-react';
import { ConfirmDialog } from './Sheet.tsx';
import { SwipeToReply } from './SwipeToReply.tsx';
import { useVisualViewport } from '../hooks/useVisualViewportHeight.ts';
import { PublicRoomMessage, UserPreferences } from '../types.ts';
import { formatChatTime, sanitizeMessageText } from '../utils/matching-logic.ts';
import { soundEffects } from '../utils/sound.ts';
import {
  adminDeleteRoomMessage,
  canPostAsTeam,
  fetchIsRoomModerator,
  isPublicRoomAvailable,
  quoteOf,
  ROOM_REACTIONS,
  RoomReactionId,
  setRoomReaction,
  sendPublicRoomMessage,
  sendTeamRoomMessage,
  subscribeToPublicRoom,
} from '../services/publicRoomService.ts';
import { TEAM_NAME } from '../services/supportService.ts';
import { whileActive } from '../utils/whileActive.ts';

// Which reaction this device left on each message, so it shows highlighted. The server still allows one per person.
const REACTED_KEY = 'qs_room_reacted';
const REACTED_KEEP = 100;

function loadReacted(): Record<string, RoomReactionId> {
  try {
    return JSON.parse(localStorage.getItem(REACTED_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveReacted(map: Record<string, RoomReactionId>) {
  try {
    const entries = Object.entries(map).slice(-REACTED_KEEP);
    localStorage.setItem(REACTED_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Per-device convenience only.
  }
}

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
  // Admins can answer a specific message; replies always go out as the team.
  const [replyingTo, setReplyingTo] = useState<PublicRoomMessage | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // True while the reader is at (or near) the bottom, so new messages follow along but reading history isn't interrupted.
  const stickToBottomRef = useRef(true);
  const coarsePointer = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);
  // On phones and tablets, a focused composer means the on-screen keyboard is up.
  const [composerFocused, setComposerFocused] = useState(false);
  // The room's normal height, kept as a spacer while the room is lifted over the app header for typing.
  const [spacerHeight, setSpacerHeight] = useState<number | null>(null);
  const { height: viewportHeight, offsetTop: viewportTop } = useVisualViewport();
  const lifted = coarsePointer && composerFocused && viewportHeight !== null;

  const [reacted, setReacted] = useState<Record<string, RoomReactionId>>(loadReacted);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const updateReacted = (messageId: string, type: RoomReactionId | null) => {
    setReacted((prev) => {
      const next = { ...prev };
      delete next[messageId];
      if (type) next[messageId] = type;
      saveReacted(next);
      return next;
    });
  };

  // Tap a reaction to add it, tap your own again to take it back, tap another to switch.
  const react = async (messageId: string, type: RoomReactionId) => {
    setPickerFor(null);
    const current = reacted[messageId];
    if (current === type) {
      updateReacted(messageId, null);
      if (!(await setRoomReaction(messageId, type, false))) updateReacted(messageId, type);
      return;
    }
    if (current) {
      updateReacted(messageId, null);
      if (!(await setRoomReaction(messageId, current, false))) {
        updateReacted(messageId, current);
        return;
      }
    }
    updateReacted(messageId, type);
    if (!(await setRoomReaction(messageId, type, true))) updateReacted(messageId, null);
  };

  // Moderator controls: shown only when admins/{uid} exists for this session; the rules re-check every delete.
  const [isModerator, setIsModerator] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchIsRoomModerator().then((ok) => {
      if (!cancelled) setIsModerator(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const confirmDelete = async () => {
    if (!pendingDeleteId || deleting) return;
    setDeleting(true);
    const ok = await adminDeleteRoomMessage(pendingDeleteId);
    setDeleting(false);
    setToast(
      ok
        ? { text: 'Message deleted.', ok: true }
        : { text: "Couldn't delete that. Nothing was removed, please try again.", ok: false }
    );
    setPendingDeleteId(null);
  };

  const startReply = (msg: PublicRoomMessage) => {
    setReplyingTo(msg);
    setAsTeam(true);
    inputRef.current?.focus();
  };

  const jumpTo = (id: string) => {
    const el = document.getElementById(`room-${id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.classList.add('ring-2', 'ring-berry/60');
    window.setTimeout(() => el?.classList.remove('ring-2', 'ring-berry/60'), 1200);
  };

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
    return whileActive(() =>
      subscribeToPublicRoom(
        (next) => {
          setMessages(next);
          setStatus('ready');
        },
        () => setStatus('error')
      )
    );
  }, []);

  const scrollToBottom = (smooth: boolean) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  // The keyboard opening or closing changes the visible height: stay on the latest message if that's where we were.
  useEffect(() => {
    if (stickToBottomRef.current) scrollToBottom(false);
  }, [viewportHeight, lifted]);

  // Grow the composer with its text, up to its max height, then scroll inside it.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [inputText]);

  // Follow new messages only if the reader is at the bottom or just sent one; chime when someone else's arrives.
  useEffect(() => {
    const latest = messages[messages.length - 1];
    if (stickToBottomRef.current || latest?.isSelf) scrollToBottom(true);
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
    const quoted = teamAvailable && asTeam && replyingTo ? quoteOf(replyingTo) : undefined;
    const result =
      teamAvailable && asTeam
        ? (await sendTeamRoomMessage(sanitized.cleanText, quoted))
          ? 'sent'
          : 'failed'
        : await sendPublicRoomMessage(userPrefs, sanitized.cleanText);
    if (result === 'sent') setReplyingTo(null);
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

  const chrome = 'var(--header-h) - env(safe-area-inset-top) - var(--tabbar-h)';

  return (
    <>
    {/* Keeps the page the same height while the room is lifted over the header and tab bar. */}
    {lifted && spacerHeight !== null && <div aria-hidden="true" style={{ height: spacerHeight }} />}
    <div
      ref={wrapperRef}
      className={
        lifted
          ? 'fixed inset-x-0 top-0 z-[45] flex flex-col bg-ink max-w-3xl mx-auto w-full md:border-x md:border-line'
          : 'flex flex-col max-w-3xl mx-auto w-full md:border-x md:border-line'
      }
      style={
        lifted
          ? { height: viewportHeight!, transform: viewportTop ? `translateY(${viewportTop}px)` : undefined }
          : { height: `calc(${viewportHeight ? `${viewportHeight}px` : '100dvh'} - ${chrome})` }
      }
    >
      <div className="px-4 sm:px-5 py-3 border-b border-line flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-raised border border-line flex items-center justify-center text-berry shrink-0">
          <Users className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold text-fg">Galaxy</h1>
          <p className="text-[12px] text-subtle truncate">Everyone here can see what you write. Be kind.</p>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex-1 overflow-y-auto overscroll-contain px-3 sm:px-5 py-3 space-y-3"
        aria-live="polite"
      >
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
              <div className="flex items-baseline gap-1.5 mb-0.5 px-1 text-[12px]">
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
              <SwipeToReply onReply={() => startReply(msg)} disabled={!teamAvailable} className="max-w-full">
                <ReactableBubble
                  id={`room-${msg.id}`}
                  open={pickerFor === msg.id}
                  onToggle={() => setPickerFor((current) => (current === msg.id ? null : msg.id))}
                  onOpen={() => setPickerFor(msg.id)}
                  onClose={() => setPickerFor((current) => (current === msg.id ? null : current))}
                  reactions={ROOM_REACTIONS}
                  mine={reacted[msg.id]}
                  onPick={(id) => react(msg.id, id as RoomReactionId)}
                  boundsRef={scrollRef}
                  alignRight={msg.isSelf}
                  className={`px-3.5 py-2 text-[15px] leading-snug rounded-[20px] break-words transition-shadow ${
                    msg.isSelf
                      ? 'bg-plum text-fg rounded-br-md'
                      : msg.team
                        ? 'bg-berry/10 border border-berry/30 text-fg rounded-bl-md'
                        : 'bg-raised text-fg rounded-bl-md'
                  }`}
                >
                  {msg.replyTo && (
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onPointerUp={(e) => e.stopPropagation()}
                      onClick={() => jumpTo(msg.replyTo!.id)}
                      className="block w-full text-left mb-1.5 -mx-1 px-2.5 py-1.5 rounded-xl bg-black/20 border-l-2 border-berry cursor-pointer"
                      aria-label={`Replying to ${msg.replyTo.author}: ${msg.replyTo.text}`}
                    >
                      <span className="block text-[12px] font-semibold text-berry">{msg.replyTo.author}</span>
                      <span className="block text-[13px] text-fg/75 line-clamp-2 break-words">{msg.replyTo.text}</span>
                    </button>
                  )}
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                </ReactableBubble>
              </SwipeToReply>

              {ROOM_REACTIONS.some((r) => msg.reactions?.[r.id] || reacted[msg.id] === r.id) && (
                <div className={`flex flex-wrap items-center gap-1 mt-1 ${msg.isSelf ? 'justify-end' : ''}`}>
                  {ROOM_REACTIONS.filter((r) => msg.reactions?.[r.id] || reacted[msg.id] === r.id).map((r) => {
                    const mine = reacted[msg.id] === r.id;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => react(msg.id, r.id)}
                        aria-pressed={mine}
                        aria-label={`${r.label} reaction, ${msg.reactions?.[r.id] ?? 0}${mine ? ', yours' : ''}`}
                        className={`inline-flex items-center gap-1 h-6 px-1.5 rounded-full text-[12px] border transition-colors cursor-pointer ${
                          mine ? 'bg-plum/40 border-berry/60 text-fg' : 'bg-surface border-line text-muted hover:text-fg'
                        }`}
                      >
                        <span aria-hidden="true">{r.emoji}</span>
                        {msg.reactions?.[r.id] ?? 0}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {(teamAvailable || isModerator) && (
              <div className="flex shrink-0 self-center">
            {teamAvailable && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => startReply(msg)}
                className="icon-btn w-8 h-8 shrink-0 self-center text-subtle"
                aria-label={`Reply to ${msg.isSelf ? 'your message' : msg.author} as ${TEAM_NAME}`}
                title="Reply as Team"
              >
                <Reply className="w-4 h-4" />
              </button>
            )}
            {isModerator && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setPendingDeleteId(msg.id)}
                className="icon-btn w-8 h-8 shrink-0 text-subtle"
                aria-label={`Delete message by ${msg.isSelf ? 'you' : msg.author} (moderator)`}
                title="Delete message (moderator)"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
              </div>
            )}
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
          <span className="text-[12px] text-subtle whitespace-nowrap shrink-0">Post as</span>
          {[
            { team: false, label: userPrefs.displayName || 'You' },
            { team: true, label: TEAM_NAME },
          ].map((opt) => (
            <button
              key={String(opt.team)}
              type="button"
              // Keep the keyboard open: a blur here would shift the layout mid-tap.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setAsTeam(opt.team);
                if (!opt.team) setReplyingTo(null);
              }}
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
      {replyingTo && (
        <div className="flex items-center gap-2 mx-3 sm:mx-4 mt-2 pl-3 pr-1 py-1.5 rounded-xl bg-raised border-l-2 border-berry">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-berry">
              Replying to {replyingTo.isSelf ? 'your message' : replyingTo.author} as {TEAM_NAME}
            </p>
            <p className="text-[13px] text-muted truncate">{replyingTo.text}</p>
          </div>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setReplyingTo(null)}
            className="icon-btn w-8 h-8"
            aria-label="Cancel reply"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      <form
        onSubmit={handleSendMessage}
        className={`flex items-end gap-2 px-3 sm:px-4 py-2.5 ${teamAvailable ? '' : 'border-t border-line'}`}
      >
        <textarea
          rows={1}
          value={inputText}
          onFocus={() => {
            if (wrapperRef.current) setSpacerHeight(wrapperRef.current.getBoundingClientRect().height);
            setComposerFocused(true);
          }}
          onBlur={() => setComposerFocused(false)}
          onKeyDown={(e) => {
            // Phones: Enter is a new line (the send button sends). Desktop: Enter sends, Shift+Enter is a new line.
            if (e.key === 'Enter' && !e.shiftKey && !coarsePointer && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSendMessage();
            }
          }}
          onChange={(e) => {
            setInputText(e.target.value);
            if (sendError) setSendError(null);
          }}
          maxLength={1000}
          disabled={status === 'error'}
          placeholder={`Message as ${teamAvailable && asTeam ? TEAM_NAME : userPrefs.displayName || 'Sapphic Guest'}`}
          ref={inputRef}
          aria-label="Message the public room"
          enterKeyHint={coarsePointer ? 'enter' : 'send'}
          autoComplete="off"
          className="flex-1 min-w-0 min-h-11 max-h-[7.5rem] px-4 py-[10px] leading-6 resize-none overflow-y-auto rounded-[22px] bg-surface border border-line text-base sm:text-[15px] text-fg placeholder:text-subtle focus:outline-none focus:border-berry"
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

      {pendingDeleteId && (
        <ConfirmDialog
          title="Delete this message?"
          message="This message will be removed for everyone in Galaxy. This action cannot be undone."
          confirmLabel={deleting ? 'Deleting…' : 'Delete permanently'}
          tone="danger"
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => {
            if (!deleting) setPendingDeleteId(null);
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed z-[60] left-1/2 -translate-x-1/2 top-[calc(env(safe-area-inset-top)+0.75rem)] w-[calc(100%-2rem)] max-w-sm flex items-start gap-2.5 bg-raised/95 backdrop-blur-xl text-fg px-4 py-3 rounded-2xl shadow-2xl shadow-black/50 border border-line text-sm anim-pop"
        >
          <CheckCircle2 className={`w-[18px] h-[18px] shrink-0 mt-px ${toast.ok ? 'text-berry' : 'text-danger'}`} />
          <span>{toast.text}</span>
        </div>
      )}
    </div>
    </>
  );
};

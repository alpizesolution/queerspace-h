import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnimalAvatar } from './AnimalAvatar.tsx';
import {
  ArrowUp,
  ChevronLeft,
  LogOut,
  ShieldAlert,
  Smile,
  Check,
  AlertCircle,
  MoreVertical,
  Volume2,
  VolumeX,
  SlidersHorizontal,
  SkipForward,
  Reply,
  X,
} from 'lucide-react';
import { SwipeToReply } from './SwipeToReply.tsx';
import { MatchCelebration } from './MatchCelebration.tsx';
import { auth } from '../lib/firebase.ts';
import { ConfirmDialog, Sheet } from './Sheet.tsx';
import { useVisualViewport } from '../hooks/useVisualViewportHeight.ts';
import { ChatMessage, PartnerProfile, PartnerStatus, UserPreferences } from '../types.ts';
import { ICEBREAKER_PROMPTS } from '../utils/mock-partners.ts';
import { INTENTION_LABELS, formatChatTime, sanitizeMessageText } from '../utils/matching-logic.ts';
import { soundEffects } from '../utils/sound.ts';
import { createTypingSender, createTypingWatcher, TypingSender } from '../utils/typing-indicator.ts';
import { chatEventManager } from '../utils/chat-events.ts';
import {
  startOrCreateConversation,
  sendCloudMessage,
  subscribeToCloudMessages,
  subscribeToConversationStatus,
  setTypingState,
  endCloudConversation,
  submitCloudReport,
} from '../services/chatService.ts';
import { autoSuspendPartner, UNDERAGE_REPORT_REASON } from '../services/suspensionService.ts';

interface ChatViewProps {
  partner: PartnerProfile;
  /** Conversation created by live matchmaking; both participants open the same one. */
  conversationId?: string;
  userPrefs: UserPreferences;
  isSoundMuted: boolean;
  onToggleSound: () => void;
  onNextMatch: () => void;
  onLeaveChat: () => void;
  onBlockAndReport: (
    reason: string,
    statusOutcome?: { reportSent?: boolean; convEnded?: boolean; isCloud?: boolean }
  ) => void;
  onOpenSetup?: () => void;
  onOpenDonationModal?: () => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  partner,
  conversationId,
  userPrefs,
  isSoundMuted,
  onToggleSound,
  onNextMatch,
  onLeaveChat,
  onBlockAndReport,
  onOpenSetup,
  onOpenDonationModal,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [partnerStatus, setPartnerStatus] = useState<PartnerStatus>(
    partner.status || chatEventManager.getStatus(partner.id)
  );
  const [showReportModal, setShowReportModal] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [reportReason, setReportReason] = useState('Harassment or disrespectful behavior');
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  /** Message whose reactions and reply button are showing (tap on touch screens). */
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the overflow menu on outside press or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);
  // Hide a tapped message's actions when tapping anywhere else.
  useEffect(() => {
    if (!activeMessageId) return;
    const onPointer = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.(`[data-msg="${activeMessageId}"]`)) setActiveMessageId(null);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [activeMessageId]);
  const [inputError, setInputError] = useState<string | null>(null);
  const [cloudConvId, setCloudConvId] = useState<string | null>(null);
  const [isCloudActive, setIsCloudActive] = useState<boolean>(false);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [partnerLeft, setPartnerLeft] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // True while the reader is at (or near) the bottom, so new messages follow along but reading history isn't interrupted.
  const stickToBottomRef = useRef(true);
  const sendingRef = useRef(false);
  const coarsePointer = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);

  // Set up real-time status change listener
  useEffect(() => {
    if (partner.status) {
      chatEventManager.emitPartnerStatus(partner.id, partner.status);
    }

    const unsubscribe = chatEventManager.subscribeToPartnerStatus(partner.id, (newStatus) => {
      setPartnerStatus(newStatus);
    });

    return () => {
      unsubscribe();
    };
  }, [partner.id, partner.status]);


  const [remoteTyping, setRemoteTyping] = useState(false);
  const typingSenderRef = useRef<TypingSender | null>(null);
  const isPartnerTyping = (partnerStatus === 'typing' || remoteTyping) && !partnerLeft;
  const soundMutedRef = useRef(isSoundMuted);
  soundMutedRef.current = isSoundMuted;

  // Join the live conversation and listen for messages and for the partner leaving.
  useEffect(() => {
    let cancelled = false;
    let unsubscribeMessages: (() => void) | null = null;
    let unsubscribeStatus: (() => void) | null = null;
    let partnerMessageCount = 0;
    const watcher = createTypingWatcher((typing) => {
      if (!cancelled) setRemoteTyping(typing);
    });
    let sender: TypingSender | null = null;
    setRemoteTyping(false);

    setMessages([]);
    setReplyingTo(null);
    setCloudConvId(null);
    setIsCloudActive(false);
    setPartnerLeft(false);

    const start = (convId: string) => {
      if (cancelled) return;
      setCloudConvId(convId);
      setIsCloudActive(true);
      setCelebrating(true);
      if (!soundMutedRef.current) soundEffects.playMatchFound();

      const systemMsg: ChatMessage = {
        id: 'sys-start',
        sender: 'system',
        text: `You're chatting with ${partner.displayName}. Be kind and respectful.`,
        timestamp: Date.now(),
      };
      setMessages([systemMsg]);

      unsubscribeMessages = subscribeToCloudMessages(
        convId,
        (cloudMsgs) => {
          if (cancelled) return;
          const incoming = cloudMsgs.filter((m) => m.sender === 'partner').length;
          if (incoming > partnerMessageCount && !soundMutedRef.current) soundEffects.playMessageReceived();
          partnerMessageCount = incoming;
          // Keep local-only reactions when the message list refreshes.
          setMessages((prev) => [
            systemMsg,
            ...cloudMsgs.map((m) => ({ ...m, reactions: prev.find((p) => p.id === m.id)?.reactions })),
          ]);
        },
        (err) => console.warn('[ChatView] Cloud message listener notice:', err)
      );

      sender = createTypingSender((typing) => void setTypingState(convId, typing));
      typingSenderRef.current = sender;

      unsubscribeStatus = subscribeToConversationStatus(
        convId,
        (status) => {
          if (cancelled || status === 'active') return;
          sender?.reset();
          setPartnerLeft(true);
        },
        (stamp) => watcher.update(stamp)
      );
    };

    if (conversationId) {
      start(conversationId);
    } else {
      startOrCreateConversation(partner.id).then((session) => {
        if (session.isCloud && session.convId) start(session.convId);
        else if (!cancelled) setInputError("Couldn't open this conversation.");
      });
    }

    return () => {
      cancelled = true;
      unsubscribeMessages?.();
      unsubscribeStatus?.();
      watcher.dispose();
      // Leaving: clear my stamp if I'm showing as typing (if this can't be sent, readers expire it).
      sender?.stop();
      typingSenderRef.current = null;
    };
  }, [partner.id, conversationId]);

  // Backgrounding the tab or closing the page ends typing right away; if the write can't make it, readers expire it.
  useEffect(() => {
    const stop = () => typingSenderRef.current?.stop();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', stop);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', stop);
    };
  }, []);

  const { height: viewportHeight, offsetTop: viewportTop } = useVisualViewport();

  // Landscape, or a small phone with the keyboard up: drop the optional icebreaker chips so the history keeps room.
  const shortViewport = viewportHeight !== null && viewportHeight < 520;

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Follow new messages and the typing bubble, but only if the reader is at the bottom or just sent one.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (stickToBottomRef.current || last?.sender === 'user') scrollToBottom(true);
  }, [messages, isPartnerTyping, scrollToBottom]);

  // Grow the composer with its text, up to its max height, then scroll inside it.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [inputText]);

  // The keyboard opening or closing changes the visible height: stay on the latest message if that's where we were.
  useEffect(() => {
    if (stickToBottomRef.current) scrollToBottom(false);
  }, [viewportHeight, scrollToBottom]);

  const handleSendMessage = async (textToSend?: string) => {
    // The ref closes the gap before isSending re-renders (double tap, or Enter plus a tap).
    if (isSending || sendingRef.current) return;
    sendingRef.current = true;

    const raw = textToSend !== undefined ? textToSend : inputText;
    if (raw.trim() === '/donate') {
      setInputText('');
      if (onOpenDonationModal) {
        onOpenDonationModal();
      }
      sendingRef.current = false;
      return;
    }

    const sanitized = sanitizeMessageText(raw);

    if (sanitized.isBlocked) {
      if (sanitized.warning) {
        setInputError(sanitized.warning);
        setTimeout(() => setInputError(null), 3500);
      }
      sendingRef.current = false;
      return;
    }

    setIsSending(true);

    try {
      // Real-Time Cloud Message Path
      if (isCloudActive && cloudConvId) {
        setInputText('');
        setInputError(null);
        if (!isSoundMuted) {
          soundEffects.playMessageSent();
        }

        const quoted = replyingTo;
        setReplyingTo(null);
        // The message write clears my typing stamp too, so sending costs no extra write.
        const wasTyping = typingSenderRef.current?.isActive() ?? false;
        typingSenderRef.current?.reset();
        const res = await sendCloudMessage(
          cloudConvId,
          sanitized.cleanText,
          quoted
            ? {
                id: quoted.id,
                text: quoted.text,
                senderId: quoted.sender === 'user' ? auth?.currentUser?.uid ?? '' : partner.id,
              }
            : undefined,
          wasTyping
        );
        if (!res.success) {
          setInputError(res.error || 'Cloud send failed.');
          setTimeout(() => setInputError(null), 3500);
        }
        return;
      }

      setInputError(partnerLeft ? `${partner.displayName} has left the chat.` : 'Still connecting…');
      setTimeout(() => setInputError(null), 3500);
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  };

  const handleToggleReaction = (messageId: string, emoji: string) => {
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== messageId) return msg;
        const existing = msg.reactions || [];
        const index = existing.findIndex((r) => r.emoji === emoji);

        if (index >= 0) {
          const current = existing[index];
          if (current.userReacted) {
            // Remove reaction
            const newCount = current.count - 1;
            const updated =
              newCount > 0
                ? existing.map((r, i) => (i === index ? { ...r, count: newCount, userReacted: false } : r))
                : existing.filter((_, i) => i !== index);
            return { ...msg, reactions: updated };
          } else {
            // Add reaction
            const updated = existing.map((r, i) =>
              i === index ? { ...r, count: r.count + 1, userReacted: true } : r
            );
            return { ...msg, reactions: updated };
          }
        } else {
          return {
            ...msg,
            reactions: [...existing, { emoji, count: 1, userReacted: true }],
          };
        }
      })
    );
  };

  const endCelebration = useCallback(() => setCelebrating(false), []);

  const startReply = (msg: ChatMessage) => {
    setReplyingTo(msg);
    setActiveMessageId(null);
    inputRef.current?.focus();
  };

  const jumpToMessage = (id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('anim-flash');
    void el.offsetWidth;
    el.classList.add('anim-flash');
  };

  const handleAddEmoji = (emoji: string) => {
    setInputText((prev) => prev + emoji);
    inputRef.current?.focus();
    setEmojiPickerOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Phones: Enter is a new line (the send button sends). Desktop: Enter sends, Shift+Enter is a new line.
    if (e.key === 'Enter' && !e.shiftKey && !coarsePointer && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSendMessage();
    } else if (e.key === 'Escape' && replyingTo) {
      setReplyingTo(null);
    }
  };

  const visibleExpressions =
    partner.showGenderExpressionOnProfile && partner.genderExpression ? partner.genderExpression : [];
  const visibleOrientation = partner.showSogieOnProfile ? partner.sexualOrientation : undefined;
  const visibleLocation = partner.showLocationOnProfile !== false ? partner.location || partner.region : undefined;
  const hasExchange = messages.filter((m) => m.sender !== 'system').length > 3;

  const closeMenu = () => setMenuOpen(false);

  return (
    <div
      className="fixed inset-x-0 top-0 h-[100dvh] z-30 flex flex-col bg-ink desk:relative desk:z-auto desk:max-w-3xl desk:mx-auto desk:w-full desk:border-x desk:border-line"
      style={viewportHeight ? { height: viewportHeight, transform: viewportTop ? `translateY(${viewportTop}px)` : undefined } : undefined}
    >
      {/* Header */}
      <header className="pt-safe bg-ink/90 backdrop-blur-xl border-b border-line z-20">
        <div className="h-16 px-1.5 sm:px-3 flex items-center gap-0.5 sm:gap-1.5">
          <button
            onClick={() => setShowLeaveConfirm(true)}
            className="icon-btn"
            aria-label="Leave conversation"
            title="Leave"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>

          <AnimalAvatar avatar={partner.avatar} seed={partner.id} className="w-10 h-10" />

          <div className="min-w-0 flex-1 pl-2">
            <h1 className="text-[15px] font-semibold text-fg truncate">{partner.displayName}</h1>
            <p className="text-[12px] text-muted truncate" aria-live="polite">
              {isPartnerTyping ? (
                <span className="text-berry font-medium">typing…</span>
              ) : (
                <>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${partnerLeft ? 'bg-subtle' : 'bg-emerald-400'}`} />
                  {partner.pronouns} · {partnerLeft ? 'Left the chat' : isCloudActive ? 'Online' : 'Connecting…'}
                  {visibleLocation && <> · {visibleLocation}</>}
                </>
              )}
            </p>
          </div>

          <button
            onClick={() => setShowSkipConfirm(true)}
            className="icon-btn"
            aria-label="Skip to next match"
            title="Next match"
          >
            <SkipForward className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowReportModal(true)}
            className="icon-btn hover:text-danger"
            aria-label="Report and block"
            title="Report & block"
          >
            <ShieldAlert className="w-5 h-5" />
          </button>
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="icon-btn"
              aria-label="More options"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <MoreVertical className="w-5 h-5" />
            </button>
            {menuOpen && (
              <>
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-1 z-40 w-56 py-1.5 card bg-raised shadow-2xl shadow-black/50 anim-pop"
                >
                  {onOpenSetup && (
                    <MenuItem
                      icon={<SlidersHorizontal className="w-4 h-4" />}
                      label="Match preferences"
                      onClick={() => {
                        closeMenu();
                        onOpenSetup();
                      }}
                    />
                  )}
                  <MenuItem
                    icon={isSoundMuted ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                    label={isSoundMuted ? 'Unmute sounds' : 'Mute sounds'}
                    onClick={() => {
                      closeMenu();
                      onToggleSound();
                    }}
                  />
                  <div className="my-1.5 border-t border-line" />
                  <MenuItem
                    icon={<LogOut className="w-4 h-4" />}
                    label="Leave conversation"
                    danger
                    onClick={() => {
                      closeMenu();
                      setShowLeaveConfirm(true);
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 sm:px-5 py-4"
      >
        {/* Match context */}
        <div className="text-center mb-5 space-y-2">
          <p className="text-[12px] text-subtle">
            Looking for <span className="text-muted font-medium">{INTENTION_LABELS[partner.intention] ?? partner.intention}</span>
            {partner.topics.length > 0 && <> · {partner.topics.slice(0, 2).join(', ')}</>}
          </p>
          {(visibleExpressions.length > 0 || visibleOrientation) && (
            <div className="flex flex-wrap justify-center gap-1.5">
              {visibleExpressions.map((expr) => (
                <span key={expr} className="tag">
                  {expr}
                </span>
              ))}
              {visibleOrientation && <span className="tag">{visibleOrientation}</span>}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          {messages.map((msg, i) => {
            if (msg.sender === 'system') {
              return (
                <p key={msg.id} className="text-center text-[12px] text-subtle px-6 py-2">
                  {msg.text}
                </p>
              );
            }

            const isUser = msg.sender === 'user';
            const next = messages[i + 1];
            const lastInGroup = !next || next.sender !== msg.sender;
            const showActions = activeMessageId === msg.id;

            return (
              <div
                key={msg.id}
                data-msg={msg.id}
                className={`group flex flex-col ${isUser ? 'items-end' : 'items-start'} ${lastInGroup ? 'pb-2' : ''}`}
              >
                <SwipeToReply
                  onReply={() => startReply(msg)}
                  onTap={() => setActiveMessageId((id) => (id === msg.id ? null : msg.id))}
                  className={`max-w-[80%] sm:max-w-[70%] flex ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    id={`msg-${msg.id}`}
                    className={`px-3.5 py-2 text-[15px] leading-snug rounded-[20px] ${
                      isUser
                        ? `bg-plum text-fg ${lastInGroup ? 'rounded-br-md' : ''}`
                        : `bg-raised text-fg ${lastInGroup ? 'rounded-bl-md' : ''}`
                    }`}
                  >
                    {msg.replyTo && (
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onPointerUp={(e) => e.stopPropagation()}
                        onClick={() => jumpToMessage(msg.replyTo!.id)}
                        className="block w-full text-left mb-1.5 -mx-1 px-2.5 py-1.5 rounded-xl bg-black/20 border-l-2 border-berry cursor-pointer"
                        aria-label={`Replying to: ${msg.replyTo.text}`}
                      >
                        <span className="block text-[12px] font-semibold text-berry">
                          {msg.replyTo.sender === 'user' ? 'You' : partner.displayName}
                        </span>
                        <span className="block text-[13px] text-fg/75 line-clamp-2 break-words">{msg.replyTo.text}</span>
                      </button>
                    )}
                    <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                  </div>
                </SwipeToReply>

                {msg.reactions && msg.reactions.length > 0 && (
                  <div className="flex flex-wrap gap-1 -mt-1.5 mx-2 relative">
                    {msg.reactions.map((r) => (
                      <button
                        key={r.emoji}
                        onClick={() => handleToggleReaction(msg.id, r.emoji)}
                        aria-pressed={!!r.userReacted}
                        aria-label={`${r.emoji} reaction, ${r.count}`}
                        className={`inline-flex items-center gap-1 h-6 px-2 rounded-full text-[12px] border cursor-pointer ${
                          r.userReacted ? 'bg-plum/60 border-berry/60 text-fg' : 'bg-surface border-line text-muted'
                        }`}
                      >
                        <span>{r.emoji}</span>
                        <span>{r.count}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className={`flex items-center gap-1 mt-0.5 px-1 ${isUser ? 'flex-row-reverse' : ''}`}>
                  {lastInGroup && (
                    <span className="text-[11px] text-subtle flex items-center gap-1">
                      {formatChatTime(msg.timestamp)}
                      {isUser && <Check className="w-3 h-3" aria-label="Sent" />}
                    </span>
                  )}
                  <div
                    className={`items-center gap-0.5 rounded-full transition-opacity ${
                      showActions
                        ? 'flex bg-raised border border-line px-1 py-0.5 shadow-lg shadow-black/30 anim-pop'
                        : 'hidden desk:flex opacity-0 group-hover:opacity-100 focus-within:opacity-100'
                    }`}
                  >
                    {QUICK_REACTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => {
                          handleToggleReaction(msg.id, emoji);
                          setActiveMessageId(null);
                        }}
                        className={`${showActions ? 'w-9 h-9 text-[19px]' : 'w-7 h-7 text-[14px]'} rounded-full hover:bg-surface cursor-pointer transition-transform active:scale-125`}
                        aria-label={`React with ${emoji}`}
                      >
                        {emoji}
                      </button>
                    ))}
                    <button
                      onClick={() => startReply(msg)}
                      className={`${showActions ? 'w-9 h-9' : 'w-7 h-7'} rounded-full hover:bg-surface text-muted hover:text-fg flex items-center justify-center cursor-pointer`}
                      aria-label="Reply"
                      title="Reply"
                    >
                      <Reply className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {isPartnerTyping && (
            <div data-testid="partner-typing-bubble" aria-live="polite" className="flex items-start anim-fade">
              <div
                className="bg-raised rounded-[20px] rounded-bl-md px-4 py-3 flex items-center gap-1"
                aria-label="Stranger is typing"
              >
                <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" />
                <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce [animation-delay:0.15s]" />
                <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce [animation-delay:0.3s]" />
                <span className="ml-1.5 text-[12px] text-lavender">Stranger is typing…</span>
              </div>
            </div>
          )}
        </div>

        <div ref={messagesEndRef} />
      </div>

      {/* Composer, or next steps once the partner has left */}
      {partnerLeft ? (
        <div className="border-t border-line bg-ink px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-center anim-fade">
          <p className="text-[14px] text-muted mb-3">{partner.displayName} left the chat.</p>
          <div className="flex flex-col sm:flex-row gap-2 sm:justify-center">
            <button onClick={onNextMatch} className="btn btn-primary">
              Find someone new
            </button>
            <button onClick={onLeaveChat} className="btn btn-ghost">
              Back to home
            </button>
          </div>
        </div>
      ) : (
        <div className="border-t border-line bg-ink pb-[max(0.5rem,env(safe-area-inset-bottom))] focus-within:pb-2">
          {!hasExchange && !shortViewport && (
            <div className="flex gap-2 overflow-x-auto scrollbar-none px-3 pt-2.5" aria-label="Icebreakers">
              {ICEBREAKER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleSendMessage(prompt)}
                  className="chip h-8 text-[12px] shrink-0"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}

          {inputError && (
            <p role="alert" className="mx-3 mt-2 px-3 py-2 rounded-xl bg-danger/10 text-danger text-[13px] flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {inputError}
            </p>
          )}

          {replyingTo && (
            <div className="mx-3 mt-2 flex items-center gap-2.5 pl-3 pr-1 py-1.5 rounded-xl bg-surface border-l-2 border-berry anim-fade">
              <Reply className="w-4 h-4 text-berry shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-berry">
                  Replying to {replyingTo.sender === 'user' ? 'yourself' : partner.displayName}
                </p>
                <p className="text-[13px] text-muted truncate">{replyingTo.text}</p>
              </div>
              <button
                type="button"
                onClick={() => setReplyingTo(null)}
                className="icon-btn w-9 h-9 shrink-0"
                aria-label="Cancel reply"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="relative flex items-end gap-1.5 px-2 sm:px-3 pt-2">
            {emojiPickerOpen && (
              <div className="absolute bottom-full left-2 mb-2 p-1.5 card bg-raised shadow-2xl shadow-black/50 grid grid-cols-5 gap-0.5 z-30 anim-pop">
                {EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleAddEmoji(emoji)}
                    className="w-10 h-10 rounded-lg text-xl hover:bg-surface cursor-pointer"
                    aria-label={`Insert ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setEmojiPickerOpen(!emojiPickerOpen)}
              className="icon-btn w-11 h-11"
              aria-label="Emoji"
              aria-expanded={emojiPickerOpen}
            >
              <Smile className="w-[22px] h-[22px]" />
            </button>

            <textarea
              ref={inputRef}
              rows={1}
              maxLength={1000}
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                typingSenderRef.current?.input(e.target.value.trim().length > 0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Message"
              aria-label={`Message ${partner.displayName}`}
              enterKeyHint={coarsePointer ? 'enter' : 'send'}
              autoComplete="off"
              className="flex-1 min-w-0 min-h-11 max-h-[7.5rem] px-4 py-[10px] leading-6 resize-none overflow-y-auto rounded-[22px] bg-surface border border-line text-base sm:text-[15px] text-fg placeholder:text-subtle focus:outline-none focus:border-berry"
            />

            <button
              type="button"
              // Keep focus (and the keyboard) in the field when tapping send.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSendMessage()}
              disabled={!inputText.trim()}
              className="w-11 h-11 shrink-0 rounded-full bg-berry text-ink flex items-center justify-center transition-all disabled:bg-raised disabled:text-subtle cursor-pointer disabled:cursor-not-allowed active:scale-95"
              aria-label="Send message"
            >
              <ArrowUp className="w-5 h-5" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      )}

      {celebrating && (
        <MatchCelebration
          me={{ avatar: userPrefs.avatar, seed: auth?.currentUser?.uid ?? userPrefs.displayName ?? 'me' }}
          partner={{ avatar: partner.avatar, seed: partner.id, name: partner.displayName }}
          onDone={endCelebration}
        />
      )}

      {showSkipConfirm && (
        <ConfirmDialog
          title="Skip to someone new?"
          message={<>Your chat with {partner.displayName} will end and be cleared.</>}
          confirmLabel="Skip"
          onCancel={() => setShowSkipConfirm(false)}
          onConfirm={() => {
            setShowSkipConfirm(false);
            if (isCloudActive && cloudConvId && !partnerLeft) {
              endCloudConversation(cloudConvId, 'ended');
            }
            onNextMatch();
          }}
        />
      )}

      {showLeaveConfirm && (
        <ConfirmDialog
          title="Leave this conversation?"
          message="The chat will end and the transcript will be cleared."
          confirmLabel="Leave"
          cancelLabel="Stay"
          tone="danger"
          onCancel={() => setShowLeaveConfirm(false)}
          onConfirm={() => {
            setShowLeaveConfirm(false);
            if (isCloudActive && cloudConvId && !partnerLeft) {
              endCloudConversation(cloudConvId, 'ended');
            }
            onLeaveChat();
          }}
        />
      )}

      {showReportModal && (
        <Sheet
          title={`Report ${partner.displayName}`}
          icon={<ShieldAlert className="w-5 h-5 text-danger" />}
          onClose={() => setShowReportModal(false)}
          footer={
            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button onClick={() => setShowReportModal(false)} className="btn btn-ghost w-full sm:w-auto">
                Cancel
              </button>
              <button
                onClick={async () => {
                  setShowReportModal(false);
                  let reportSent = false;
                  let convEnded = false;
                  if (isCloudActive && cloudConvId) {
                    convEnded = await endCloudConversation(cloudConvId, 'blocked');
                    reportSent = await submitCloudReport(partner.id, 'user', reportReason);
                    // Underage reports pause the partner's account until the team reviews it.
                    if (reportSent && reportReason === UNDERAGE_REPORT_REASON) {
                      await autoSuspendPartner(partner.id, cloudConvId);
                    }
                  }
                  onBlockAndReport(reportReason, { reportSent, convEnded, isCloud: isCloudActive });
                }}
                className="btn btn-danger w-full sm:w-auto"
              >
                Report &amp; block
              </button>
            </div>
          }
        >
          <p className="mb-4">This ends the chat and blocks them from matching with you again.</p>
          <fieldset className="space-y-2">
            <legend className="sr-only">Reason</legend>
            {REPORT_REASONS.map((reason) => (
              <label
                key={reason}
                className={`flex items-center gap-3 min-h-12 px-3.5 py-2.5 rounded-xl border cursor-pointer text-sm transition-colors ${
                  reportReason === reason ? 'border-danger/60 bg-danger/10 text-fg' : 'border-line text-muted hover:text-fg'
                }`}
              >
                <input
                  type="radio"
                  name="reportReason"
                  value={reason}
                  checked={reportReason === reason}
                  onChange={(e) => setReportReason(e.target.value)}
                  className="w-4 h-4 accent-[#f17c8a]"
                />
                <span>{reason}</span>
              </label>
            ))}
          </fieldset>
        </Sheet>
      )}
    </div>
  );
};

const QUICK_REACTIONS = ['😻', '😹', '😽', '🙀', '😿', '❤️'];
const EMOJIS = ['😺', '😻', '😹', '😽', '🙀', '😿', '😼', '🐈', '🐾', '🌸', '❤️', '✨', '🫂', '🥺', '🎉'];
const REPORT_REASONS = [
  'Harassment or disrespectful behavior',
  'Unsolicited sexual messages or content',
  'Suspected male imposter / Not sapphic',
  UNDERAGE_REPORT_REASON,
  'Spam, advertising, or scam links',
];

const MenuItem: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }> = ({
  icon,
  label,
  onClick,
  danger,
}) => (
  <button
    role="menuitem"
    onClick={onClick}
    className={`w-full flex items-center gap-3 h-11 px-4 text-sm text-left cursor-pointer hover:bg-surface transition-colors ${
      danger ? 'text-danger' : 'text-fg'
    }`}
  >
    {icon}
    {label}
  </button>
);

import React, { useState, useEffect, useRef } from 'react';
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
} from 'lucide-react';
import { ConfirmDialog, Sheet } from './Sheet.tsx';
import { useVisualViewportHeight } from '../hooks/useVisualViewportHeight.ts';
import { ChatMessage, PartnerProfile, PartnerStatus, UserPreferences } from '../types.ts';
import { ICEBREAKER_PROMPTS, getPartnerReply } from '../utils/mock-partners.ts';
import { INTENTION_LABELS, formatChatTime, sanitizeMessageText } from '../utils/matching-logic.ts';
import { soundEffects } from '../utils/sound.ts';
import { chatEventManager } from '../utils/chat-events.ts';
import {
  startOrCreateConversation,
  sendCloudMessage,
  subscribeToCloudMessages,
  endCloudConversation,
  submitCloudReport,
} from '../services/chatService.ts';

interface ChatViewProps {
  partner: PartnerProfile;
  partnerSource?: 'cloud' | 'local_fallback' | 'dynamic_fallback';
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
  partnerSource,
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
  const [inputError, setInputError] = useState<string | null>(null);
  const [cloudConvId, setCloudConvId] = useState<string | null>(null);
  const [isCloudActive, setIsCloudActive] = useState<boolean>(false);
  const [isSending, setIsSending] = useState<boolean>(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const isPartnerTyping = partnerStatus === 'typing';

  // Initialize Cloud Conversation if partnerSource === 'cloud' or fallback to Local Demo
  useEffect(() => {
    let unsubscribeCloud: (() => void) | null = null;
    let cancelled = false;

    // Reset messages and cloud state on partner switch to prevent stale message leakage
    setMessages([]);
    setCloudConvId(null);
    setIsCloudActive(false);

    if (partnerSource === 'cloud' && partner.id) {
      startOrCreateConversation(partner.id).then((session) => {
        if (cancelled) return;
        if (session.isCloud && session.convId) {
          setCloudConvId(session.convId);
          setIsCloudActive(true);

          unsubscribeCloud = subscribeToCloudMessages(
            session.convId,
            (cloudMsgs) => {
              if (cancelled) return;
              const systemMsg: ChatMessage = {
                id: 'sys-start',
                sender: 'system',
                text: `Connected with ${partner.displayName} (${partner.pronouns}) via Cloud. Pseudonymous 1-on-1 chat active.`,
                timestamp: Date.now(),
              };
              setMessages([systemMsg, ...cloudMsgs]);
            },
            (err) => {
              console.warn('[ChatView] Cloud message listener notice:', err);
            }
          );
        }
      });
    }

    // If local demo mode (partnerSource !== 'cloud'), run simulated demo conversation
    if (partnerSource !== 'cloud') {
      if (!isSoundMuted) {
        soundEffects.playMatchFound();
      }

      const systemMsg: ChatMessage = {
        id: 'sys-start',
        sender: 'system',
        text: `You are connected with ${partner.displayName} (${partner.pronouns}). Say hello and please be respectful!`,
        timestamp: Date.now(),
      };

      setMessages([systemMsg]);

      const timer = setTimeout(() => {
        chatEventManager.emitPartnerStatus(partner.id, 'typing');

        setTimeout(() => {
          chatEventManager.emitPartnerStatus(partner.id, 'online');
          const greetingTexts = [
            `Hey ${userPrefs.displayName}! So happy to match with you. How's your day going? ✨`,
            `Hi there! Hope you're having a gentle day. Love seeing other sapphic folks on here! 🌸`,
            `Hello! It's so nice to connect with someone. What are you up to today? ☕`,
          ];
          const greeting = greetingTexts[Math.floor(Math.random() * greetingTexts.length)];
          const partnerMsg: ChatMessage = {
            id: `msg-${Date.now()}`,
            sender: 'partner',
            text: greeting,
            timestamp: Date.now(),
            status: 'delivered',
          };
          setMessages((prev) => [...prev, partnerMsg]);
          if (!isSoundMuted) {
            soundEffects.playMessageReceived();
          }
        }, 1600);
      }, 1000);

      return () => {
        clearTimeout(timer);
        chatEventManager.emitPartnerStatus(partner.id, 'online');
      };
    }

    return () => {
      cancelled = true;
      if (unsubscribeCloud) unsubscribeCloud();
    };
  }, [partner.id, partnerSource]);

  // Scroll to bottom on new messages or typing
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isPartnerTyping]);

  const handleSendMessage = async (textToSend?: string) => {
    if (isSending) return;

    const raw = textToSend !== undefined ? textToSend : inputText;
    if (raw.trim() === '/donate') {
      setInputText('');
      if (onOpenDonationModal) {
        onOpenDonationModal();
      }
      return;
    }

    const sanitized = sanitizeMessageText(raw);

    if (sanitized.isBlocked) {
      if (sanitized.warning) {
        setInputError(sanitized.warning);
        setTimeout(() => setInputError(null), 3500);
      }
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

        const res = await sendCloudMessage(cloudConvId, sanitized.cleanText);
        if (!res.success) {
          setInputError(res.error || 'Cloud send failed.');
          setTimeout(() => setInputError(null), 3500);
        }
        return;
      }

      // Local Demo Mode Path
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        sender: 'user',
        text: sanitized.cleanText,
        timestamp: Date.now(),
        status: 'delivered',
      };

      setMessages((prev) => [...prev, userMsg]);
      setInputText('');
      setInputError(null);

      if (!isSoundMuted) {
        soundEffects.playMessageSent();
      }

      const typingDelay = 1100 + Math.random() * 800;
      const replyDelay = typingDelay + 1400 + Math.random() * 1100;

      const partnerReply = getPartnerReply(partner, sanitized.cleanText, messages.length);

      setTimeout(() => {
        chatEventManager.emitPartnerStatus(partner.id, 'typing');
      }, typingDelay);

      setTimeout(() => {
        chatEventManager.emitPartnerStatus(partner.id, 'online');
        const partnerMsg: ChatMessage = {
          id: `partner-${Date.now()}`,
          sender: 'partner',
          text: partnerReply.text,
          timestamp: Date.now(),
          status: 'delivered',
          reactions: partnerReply.reaction
            ? [{ emoji: partnerReply.reaction, count: 1, userReacted: false }]
            : undefined,
        };
        setMessages((prev) => [...prev, partnerMsg]);

        if (!isSoundMuted) {
          soundEffects.playMessageReceived();
        }
      }, replyDelay);
    } finally {
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

  const handleAddEmoji = (emoji: string) => {
    setInputText((prev) => prev + emoji);
    inputRef.current?.focus();
    setEmojiPickerOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const isDemo = !!partnerSource && partnerSource !== 'cloud';
  const visibleExpressions =
    partner.showGenderExpressionOnProfile && partner.genderExpression ? partner.genderExpression : [];
  const visibleOrientation = partner.showSogieOnProfile ? partner.sexualOrientation : undefined;
  const visibleLocation = partner.showLocationOnProfile !== false ? partner.location || partner.region : undefined;
  const hasExchange = messages.filter((m) => m.sender !== 'system').length > 3;

  const closeMenu = () => setMenuOpen(false);
  const viewportHeight = useVisualViewportHeight();

  return (
    <div
      className="fixed inset-x-0 top-0 h-[100dvh] z-30 flex flex-col bg-ink md:static md:z-auto md:max-w-3xl md:mx-auto md:w-full md:border-x md:border-line"
      style={viewportHeight ? { height: viewportHeight } : undefined}
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

          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-[15px] shrink-0"
            style={{ backgroundColor: partner.avatarColor }}
            aria-hidden="true"
          >
            {partner.displayName.charAt(0)}
          </div>

          <div className="min-w-0 flex-1 pl-2">
            <h1 className="text-[15px] font-semibold text-fg truncate">{partner.displayName}</h1>
            <p className="text-[12px] text-muted truncate" aria-live="polite">
              {isPartnerTyping ? (
                <span className="text-berry font-medium">typing…</span>
              ) : (
                <>
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 align-middle" />
                  {partner.pronouns} · {isDemo ? 'Demo match' : 'Online'}
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
      <div className="flex-1 overflow-y-auto overscroll-contain px-3 sm:px-5 py-4">
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
          {isDemo && (
            <p className="inline-flex items-center gap-1.5 text-[11px] text-amber-300/90">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              Local demo partner (simulated replies)
            </p>
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

            return (
              <div
                key={msg.id}
                className={`group flex flex-col ${isUser ? 'items-end' : 'items-start'} ${lastInGroup ? 'pb-2' : ''}`}
              >
                <div
                  className={`max-w-[80%] sm:max-w-[70%] px-3.5 py-2 text-[15px] leading-snug rounded-[20px] ${
                    isUser
                      ? `bg-plum text-fg ${lastInGroup ? 'rounded-br-md' : ''}`
                      : `bg-raised text-fg ${lastInGroup ? 'rounded-bl-md' : ''}`
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                </div>

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
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    {QUICK_REACTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => handleToggleReaction(msg.id, emoji)}
                        className="w-7 h-7 rounded-full hover:bg-raised text-[13px] cursor-pointer"
                        aria-label={`React with ${emoji}`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}

          {isPartnerTyping && (
            <div data-testid="partner-typing-bubble" aria-live="polite" className="flex items-start anim-fade">
              <div
                className="bg-raised rounded-[20px] rounded-bl-md px-4 py-3 flex items-center gap-1"
                aria-label={`${partner.displayName} is typing`}
              >
                <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" />
                <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce [animation-delay:0.15s]" />
                <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce [animation-delay:0.3s]" />
              </div>
            </div>
          )}
        </div>

        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-line bg-ink pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {!hasExchange && (
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
            onClick={() => setEmojiPickerOpen(!emojiPickerOpen)}
            className="icon-btn w-11 h-11"
            aria-label="Emoji"
            aria-expanded={emojiPickerOpen}
          >
            <Smile className="w-[22px] h-[22px]" />
          </button>

          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message"
            aria-label={`Message ${partner.displayName}`}
            enterKeyHint="send"
            autoComplete="off"
            className="flex-1 min-w-0 h-11 px-4 rounded-full bg-surface border border-line text-base sm:text-[15px] text-fg placeholder:text-subtle focus:outline-none focus:border-berry"
          />

          <button
            type="button"
            onClick={() => handleSendMessage()}
            disabled={!inputText.trim()}
            className="w-11 h-11 shrink-0 rounded-full bg-berry text-ink flex items-center justify-center transition-all disabled:bg-raised disabled:text-subtle cursor-pointer disabled:cursor-not-allowed active:scale-95"
            aria-label="Send message"
          >
            <ArrowUp className="w-5 h-5" strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {showSkipConfirm && (
        <ConfirmDialog
          title="Skip to someone new?"
          message={<>Your chat with {partner.displayName} will end and be cleared.</>}
          confirmLabel="Skip"
          onCancel={() => setShowSkipConfirm(false)}
          onConfirm={() => {
            setShowSkipConfirm(false);
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
            if (isCloudActive && cloudConvId) {
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

const QUICK_REACTIONS = ['🌸', '❤️', '✨', '☕'];
const EMOJIS = ['🌸', '❤️', '✨', '☕', '🫂', '🌿', '📖', '🐱', '🥺', '🎉'];
const REPORT_REASONS = [
  'Harassment or disrespectful behavior',
  'Unsolicited sexual messages or content',
  'Suspected male imposter / Not sapphic',
  'Underage participant (violating 18+ policy)',
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

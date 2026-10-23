import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Sparkles,
  ArrowRight,
  LogOut,
  ShieldAlert,
  Smile,
  Check,
  CheckCheck,
  AlertCircle,
  MoreVertical,
  Volume2,
  VolumeX,
  MessageCircle,
  SlidersHorizontal,
  SkipForward,
} from 'lucide-react';
import { ChatMessage, PartnerProfile, PartnerStatus, UserPreferences } from '../types.ts';
import { ICEBREAKER_PROMPTS, getPartnerReply } from '../utils/mock-partners.ts';
import { formatChatTime, sanitizeMessageText } from '../utils/matching-logic.ts';
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
  onBlockAndReport: (reason: string) => void;
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
  const [inputError, setInputError] = useState<string | null>(null);
  const [cloudConvId, setCloudConvId] = useState<string | null>(null);
  const [isCloudActive, setIsCloudActive] = useState<boolean>(false);

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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isPartnerTyping]);

  const handleSendMessage = (textToSend?: string) => {
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

    // Real-Time Cloud Message Path
    if (isCloudActive && cloudConvId) {
      setInputText('');
      setInputError(null);
      if (!isSoundMuted) {
        soundEffects.playMessageSent();
      }

      sendCloudMessage(cloudConvId, sanitized.cleanText).then((res) => {
        if (!res.success) {
          setInputError(res.error || 'Cloud send failed.');
          setTimeout(() => setInputError(null), 3500);
        }
      });
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

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-4xl mx-auto w-full bg-[#17121B] sm:border-x border-[#403247]">
      {/* Chat Header */}
      <div className="bg-[#150826] px-3.5 py-2.5 sm:px-6 sm:py-3.5 border-b border-[#4a1f6d] shadow-xs z-20 flex flex-col justify-center">
        {/* Top Row: Avatar + Name/Status on Left, Actions on Right */}
        <div className="flex items-center justify-between gap-2 sm:gap-4 w-full">
          {/* Left: Avatar + Primary Identity */}
          <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0 flex-1">
            <div
              className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl flex items-center justify-center text-white font-serif font-bold text-sm sm:text-base shrink-0 shadow-xs border border-[#4a1f6d]"
              style={{ backgroundColor: partner.avatarColor }}
            >
              {partner.displayName.charAt(0)}
            </div>

            <div className="min-w-0 flex-1">
              {/* Name + Pronouns + Source Badge */}
              <div className="flex items-center gap-1.5 truncate">
                <h3 className="font-serif font-bold text-sm sm:text-base text-[#fcf7fa] truncate">
                  {partner.displayName}
                </h3>
                <span className="text-[10px] sm:text-[11px] font-medium text-[#e07bb8] bg-[#230d3b] px-2 py-0.5 rounded-full border border-[#4a1f6d] shrink-0">
                  {partner.pronouns}
                </span>
                {partnerSource && partnerSource !== 'cloud' && (
                  <span className="text-[9px] sm:text-[10px] font-medium text-amber-300 bg-amber-950/70 px-2 py-0.5 rounded-full border border-amber-700/60 shrink-0 flex items-center gap-1">
                    Demo Match
                  </span>
                )}
              </div>

              {/* Status & Shared Topics */}
              <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-[#cbbccf] min-w-0 mt-0.5">
                {partnerStatus === 'typing' ? (
                  <div className="flex items-center gap-1 text-[#e07bb8] font-semibold animate-pulse shrink-0">
                    <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-[#e07bb8]" />
                    <span className="flex items-center gap-0.5">
                      <span>Typing</span>
                      <span className="flex gap-0.5 ml-0.5">
                        <span className="w-1 h-1 bg-[#e07bb8] rounded-full animate-bounce" />
                        <span className="w-1 h-1 bg-[#e07bb8] rounded-full animate-bounce [animation-delay:0.2s]" />
                        <span className="w-1 h-1 bg-[#e07bb8] rounded-full animate-bounce [animation-delay:0.4s]" />
                      </span>
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-[#cbbccf] shrink-0">
                    <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Connected</span>
                  </div>
                )}
                {partner.topics.length > 0 && (
                  <>
                    <span className="text-[#4a1f6d] shrink-0">•</span>
                    <span className="truncate text-[#e07bb8] text-[10px] sm:text-[11px]">
                      {partner.topics.slice(0, 2).join(', ')}
                    </span>
                  </>
                )}
              </div>

              {/* Desktop Tags (rendered inline under name on sm+) */}
              <div className="hidden sm:flex sm:items-center sm:gap-1.5 sm:flex-wrap sm:mt-1">
                {partner.showGenderExpressionOnProfile &&
                  partner.genderExpression &&
                  partner.genderExpression.length > 0 &&
                  partner.genderExpression.map((expr) => (
                    <span
                      key={expr}
                      className="text-[10px] font-medium text-[#fcf7fa] bg-[#a85293]/30 px-2 py-0.5 rounded-full border border-[#e07bb8]/40 shrink-0"
                    >
                      {expr}
                    </span>
                  ))}
                {partner.showSogieOnProfile && partner.sexualOrientation && (
                  <span className="text-[10px] text-[#cbbccf] bg-[#230d3b] px-2 py-0.5 rounded-full border border-[#4a1f6d] shrink-0">
                    {partner.sexualOrientation}
                  </span>
                )}
                {partner.showLocationOnProfile !== false && (partner.location || partner.region) && (
                  <span className="text-[10px] text-[#cbbccf] bg-[#230d3b] px-2 py-0.5 rounded-full border border-[#4a1f6d] shrink-0 flex items-center gap-1">
                    <span>📍</span>
                    <span className="truncate max-w-[180px]">{partner.location || partner.region}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: Action Toolbar */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {onOpenSetup && (
              <button
                onClick={onOpenSetup}
                className="p-1.5 sm:p-2 rounded-full text-[#cbbccf] hover:text-[#e07bb8] hover:bg-[#230d3b] transition-colors cursor-pointer border border-transparent hover:border-[#4a1f6d]"
                title="Preferences & Discovery Filters"
                aria-label="Preferences & Discovery Filters"
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>
            )}

            <button
              onClick={() => setShowLeaveConfirm(true)}
              className="p-1.5 sm:p-2 rounded-full text-[#cbbccf] hover:text-red-400 hover:bg-[#230d3b] transition-colors cursor-pointer border border-transparent hover:border-[#4a1f6d]"
              title="Leave conversation"
              aria-label="Leave conversation"
            >
              <LogOut className="w-4 h-4" />
            </button>

            <button
              onClick={() => setShowReportModal(true)}
              className="p-1.5 sm:p-2 rounded-full text-[#cbbccf] hover:text-red-400 hover:bg-[#230d3b] transition-colors cursor-pointer border border-transparent hover:border-[#4a1f6d]"
              title="Report or block participant"
              aria-label="Report or block participant"
            >
              <ShieldAlert className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mobile Tags Sub-row (rendered cleanly below the top row on mobile screens < sm) */}
        {((partner.showGenderExpressionOnProfile && partner.genderExpression && partner.genderExpression.length > 0) ||
          (partner.showSogieOnProfile && partner.sexualOrientation) ||
          (partner.showLocationOnProfile !== false && (partner.location || partner.region))) && (
          <div className="flex sm:hidden items-center gap-1.5 overflow-x-auto pt-2 pb-0.5 scrollbar-none text-[10px]">
            {partner.showGenderExpressionOnProfile &&
              partner.genderExpression &&
              partner.genderExpression.length > 0 &&
              partner.genderExpression.map((expr) => (
                <span
                  key={expr}
                  className="text-[10px] font-medium text-[#fcf7fa] bg-[#a85293]/30 px-2 py-0.5 rounded-full border border-[#e07bb8]/40 shrink-0 whitespace-nowrap"
                >
                  {expr}
                </span>
              ))}
            {partner.showSogieOnProfile && partner.sexualOrientation && (
              <span className="text-[10px] text-[#cbbccf] bg-[#230d3b] px-2 py-0.5 rounded-full border border-[#4a1f6d] shrink-0 whitespace-nowrap">
                {partner.sexualOrientation}
              </span>
            )}
            {partner.showLocationOnProfile !== false && (partner.location || partner.region) && (
              <span className="text-[10px] text-[#cbbccf] bg-[#230d3b] px-2 py-0.5 rounded-full border border-[#4a1f6d] shrink-0 flex items-center gap-1 whitespace-nowrap">
                <span>📍</span>
                <span>{partner.location || partner.region}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#17121B]">
        {/* Intention & Discovery Match Banner */}
        <div className="bg-[#241B29] rounded-2xl p-3 border border-[#403247] text-xs text-[#BDB0BF] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#C77DAA]" />
            <span>
              Looking for:{' '}
              <strong className="text-[#F7F0F6] capitalize">
                {partner.intention.replace('_', ' ')}
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-2">
            {partnerSource && partnerSource !== 'cloud' ? (
              <span className="text-[10px] font-medium text-amber-300 bg-amber-950/60 px-2.5 py-0.5 rounded-full border border-amber-700/60 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                Local Demo Mode Partner
              </span>
            ) : (
              <span className="text-[10px] font-medium text-emerald-300 bg-emerald-950/60 px-2.5 py-0.5 rounded-full border border-emerald-700/60 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Verified Cloud Candidate
              </span>
            )}
            {userPrefs.applyGenderExpressionFilter &&
              userPrefs.preferredGenderExpressions &&
              userPrefs.preferredGenderExpressions.length > 0 &&
              !userPrefs.preferredGenderExpressions.includes('Any / No preference') && (
                <span className="text-[10px] text-[#C77DAA] bg-[#302235] px-2 py-0.5 rounded-full border border-[#403247]">
                  Filter: {userPrefs.preferredGenderExpressions.join(', ')}
                </span>
              )}
            {partner.region && (
              <span className="text-[11px] text-[#C77DAA]">{partner.region}</span>
            )}
          </div>
        </div>

        {/* Rendered Messages */}
        {messages.map((msg) => {
          if (msg.sender === 'system') {
            return (
              <div key={msg.id} className="text-center my-3">
                <span className="inline-block px-3 py-1 rounded-full bg-[#241B29] text-[#C77DAA] text-xs font-medium border border-[#403247]">
                  {msg.text}
                </span>
              </div>
            );
          }

          const isUser = msg.sender === 'user';

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} group`}
            >
              <div
                className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm relative ${
                  isUser
                    ? 'bg-[#8E547E] text-[#F7F0F6] rounded-br-xs'
                    : 'bg-[#241B29] text-[#F7F0F6] border border-[#403247] rounded-bl-xs'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                <div
                  className={`flex items-center gap-1.5 text-[10px] mt-1 justify-end ${
                    isUser ? 'text-white/70' : 'text-[#BDB0BF]'
                  }`}
                >
                  <span>{formatChatTime(msg.timestamp)}</span>
                  {isUser && <CheckCheck className="w-3 h-3 text-[#C77DAA]" />}
                </div>

                {/* Emoji reactions display */}
                {msg.reactions && msg.reactions.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5 -mb-0.5">
                    {msg.reactions.map((r) => (
                      <button
                        key={r.emoji}
                        onClick={() => handleToggleReaction(msg.id, r.emoji)}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] border cursor-pointer transition-all ${
                          r.userReacted
                            ? 'bg-[#8E547E]/40 border-[#C77DAA] text-[#F7F0F6] font-bold'
                            : 'bg-[#302235] text-[#BDB0BF] border-[#403247]'
                        }`}
                      >
                        <span>{r.emoji}</span>
                        <span>{r.count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Hover quick reactions */}
              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 mt-1 text-xs">
                {['🌸', '❤️', '✨', '☕'].map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => handleToggleReaction(msg.id, emoji)}
                    className="p-1 rounded-full hover:bg-[#302235] hover:shadow-xs transition-colors cursor-pointer text-xs"
                    title={`React with ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        {/* Partner Typing Bubble */}
        {isPartnerTyping && (
          <div data-testid="partner-typing-bubble" aria-live="polite" className="flex items-start animate-in fade-in duration-200">
            <div className="bg-[#241B29] border border-[#403247] rounded-2xl rounded-bl-xs px-3.5 py-2.5 text-xs text-[#BDB0BF] flex items-center gap-1.5 shadow-sm">
              <span className="font-semibold text-[#F7F0F6]">{partner.displayName}</span>
              <span className="text-[#C77DAA] font-medium">is typing</span>
              <span className="flex gap-1 ml-1">
                <span className="w-1.5 h-1.5 bg-[#C77DAA] rounded-full animate-bounce" />
                <span className="w-1.5 h-1.5 bg-[#C77DAA] rounded-full animate-bounce [animation-delay:0.2s]" />
                <span className="w-1.5 h-1.5 bg-[#C77DAA] rounded-full animate-bounce [animation-delay:0.4s]" />
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Icebreaker Suggestions (Show when few messages exchanged) */}
      {messages.filter((m) => m.sender !== 'system').length <= 3 && (
        <div className="px-4 py-2 border-t border-[#403247] bg-[#241B29]/90 overflow-x-auto">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-[#C77DAA] font-semibold shrink-0 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" />
              Icebreakers:
            </span>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar py-0.5">
              {ICEBREAKER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleSendMessage(prompt)}
                  className="whitespace-nowrap px-3 py-1 rounded-full bg-[#302235] border border-[#403247] hover:border-[#C77DAA] hover:text-[#F7F0F6] text-[11px] text-[#BDB0BF] transition-colors shrink-0 cursor-pointer shadow-xs"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Input Warning / Error */}
      {inputError && (
        <div className="px-4 py-1.5 bg-red-950/80 text-red-200 text-xs flex items-center gap-1.5 border-t border-red-800">
          <AlertCircle className="w-3.5 h-3.5" />
          <span>{inputError}</span>
        </div>
      )}

      {/* Message Composer Area */}
      <div className="p-3 sm:p-4 bg-[#241B29] border-t border-[#403247] relative">
        {/* Emoji picker dropdown */}
        {emojiPickerOpen && (
          <div className="absolute bottom-full left-4 mb-2 p-2.5 bg-[#241B29] rounded-2xl border border-[#403247] shadow-2xl flex gap-2 text-lg z-30">
            {['🌸', '❤️', '✨', '☕', '🫂', '🌿', '📖', '🐱', '🥺', '🎉'].map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => handleAddEmoji(emoji)}
                className="hover:scale-125 transition-transform p-1 cursor-pointer"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          {/* Emoji Toggle */}
          <button
            type="button"
            onClick={() => setEmojiPickerOpen(!emojiPickerOpen)}
            className="p-2.5 rounded-full text-[#BDB0BF] hover:text-[#F7F0F6] hover:bg-[#302235] transition-colors cursor-pointer"
            aria-label="Open emoji picker"
          >
            <Smile className="w-5 h-5" />
          </button>

          {/* Text Input */}
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${partner.displayName}... (Enter to send)`}
            className="flex-1 px-4 py-2.5 rounded-full bg-[#17121B] border border-[#403247] text-sm text-[#F7F0F6] placeholder-[#BDB0BF]/50 focus:outline-none focus:border-[#C77DAA] focus:ring-1 focus:ring-[#C77DAA]"
          />

          {/* Send Button */}
          <button
            type="button"
            onClick={() => handleSendMessage()}
            disabled={!inputText.trim()}
            className="p-2.5 rounded-full bg-[#C77DAA] hover:bg-[#d893bd] disabled:opacity-40 text-[#17121B] transition-all shadow-md cursor-pointer active:scale-95"
            aria-label="Send message"
          >
            <Send className="w-4 h-4 text-[#17121B]" />
          </button>
        </div>
      </div>

      {/* Skip Match Action Bar (positioned below chat input composer) */}
      <div className="px-3 py-2 sm:px-4 bg-[#1b1222] border-t border-[#403247]/70 flex items-center justify-between gap-2">
        <p className="text-[11px] text-[#cbbccf]/70 hidden sm:block">
          Want to connect with someone else?
        </p>
        <button
          type="button"
          onClick={() => setShowSkipConfirm(true)}
          className="w-full sm:w-auto ml-auto inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#2a173d] hover:bg-[#a85293] text-[#e07bb8] hover:text-[#fcf7fa] text-xs font-semibold border border-[#4a1f6d] transition-all cursor-pointer shadow-xs active:scale-95"
          title="Skip to next available person"
          aria-label="Skip to next match"
        >
          <SkipForward className="w-3.5 h-3.5" />
          <span>Skip</span>
        </button>
      </div>

      {/* Skip Match Warning Confirmation Dialog */}
      {showSkipConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-[#241B29] rounded-3xl p-6 border border-[#403247] max-w-sm w-full shadow-2xl">
            <div className="flex items-center gap-2 mb-2 text-[#e07bb8]">
              <SkipForward className="w-5 h-5 text-[#e07bb8]" />
              <h4 className="font-serif text-lg font-bold text-[#F7F0F6]">
                Skip this conversation?
              </h4>
            </div>
            <p className="text-xs text-[#BDB0BF] leading-relaxed mb-6">
              You will leave this chat with <strong className="text-[#F7F0F6]">{partner.displayName}</strong> and be matched with a new sapphic peer. Unsaved chat messages in this session will be cleared.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowSkipConfirm(false)}
                className="px-4 py-2 rounded-full border border-[#403247] text-xs font-semibold text-[#BDB0BF] hover:bg-[#302235] hover:text-[#F7F0F6] cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowSkipConfirm(false);
                  onNextMatch();
                }}
                className="px-4 py-2 rounded-full bg-[#a85293] hover:bg-[#c862b0] text-white text-xs font-semibold cursor-pointer shadow-md"
              >
                Yes, Skip & Rematch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leave Confirmation Dialog */}
      {showLeaveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-[#241B29] rounded-3xl p-6 border border-[#403247] max-w-sm w-full shadow-2xl">
            <h4 className="font-serif text-lg font-bold text-[#F7F0F6] mb-2">
              Leave this conversation?
            </h4>
            <p className="text-xs text-[#BDB0BF] leading-relaxed mb-6">
              Your chat transcript is ephemeral and will be cleared when you leave. You can return to home or match again anytime.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowLeaveConfirm(false)}
                className="px-4 py-2 rounded-full border border-[#403247] text-xs font-semibold text-[#BDB0BF] hover:bg-[#302235] hover:text-[#F7F0F6]"
              >
                Stay
              </button>
              <button
                onClick={() => {
                  setShowLeaveConfirm(false);
                  if (isCloudActive && cloudConvId) {
                    endCloudConversation(cloudConvId, 'ended');
                  }
                  onLeaveChat();
                }}
                className="px-4 py-2 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
              >
                Leave Chat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Block & Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-[#241B29] rounded-3xl p-6 border border-[#403247] max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-2 mb-3 text-red-400">
              <ShieldAlert className="w-5 h-5" />
              <h4 className="font-serif text-lg font-bold text-[#F7F0F6]">
                Report & Block {partner.displayName}
              </h4>
            </div>
            <p className="text-xs text-[#BDB0BF] leading-relaxed mb-4">
              We take safety very seriously. Submitting a report will immediately terminate this conversation and block this participant from ever being matched with you again.
            </p>

            <div className="space-y-2 mb-6">
              <label className="text-xs font-bold text-[#F7F0F6]">Select Reason:</label>
              {[
                'Harassment or disrespectful behavior',
                'Unsolicited sexual messages or content',
                'Suspected male imposter / Not sapphic',
                'Underage participant (violating 18+ policy)',
                'Spam, advertising, or scam links',
              ].map((reason) => (
                <label
                  key={reason}
                  className="flex items-center gap-2.5 p-2 rounded-xl border border-[#403247] bg-[#17121B] hover:bg-[#302235] cursor-pointer text-xs text-[#F7F0F6]"
                >
                  <input
                    type="radio"
                    name="reportReason"
                    value={reason}
                    checked={reportReason === reason}
                    onChange={(e) => setReportReason(e.target.value)}
                    className="accent-[#C77DAA]"
                  />
                  <span>{reason}</span>
                </label>
              ))}
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowReportModal(false)}
                className="px-4 py-2 rounded-full border border-[#403247] text-xs font-semibold text-[#BDB0BF] hover:bg-[#302235] hover:text-[#F7F0F6]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowReportModal(false);
                  if (isCloudActive && cloudConvId) {
                    endCloudConversation(cloudConvId, 'blocked');
                    submitCloudReport(partner.id, 'user', reportReason);
                  }
                  onBlockAndReport(reportReason);
                }}
                className="px-5 py-2 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
              >
                Report & Block
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

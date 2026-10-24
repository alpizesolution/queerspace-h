import React, { useState, useEffect, useRef } from 'react';
import { Send, Users, Sparkles, Smile, ArrowLeft, Shield } from 'lucide-react';
import { PublicRoomMessage, UserPreferences } from '../types.ts';
import { INITIAL_PUBLIC_ROOM_MESSAGES } from '../utils/community-data.ts';
import { formatChatTime, sanitizeMessageText } from '../utils/matching-logic.ts';
import { soundEffects } from '../utils/sound.ts';

import { getStorageItem, setStorageItem, STORAGE_KEYS } from '../utils/storage.ts';

interface PublicRoomViewProps {
  userPrefs: UserPreferences;
  isSoundMuted: boolean;
  onBackToHome: () => void;
  onOpen1on1: () => void;
  onOpenDonationModal?: () => void;
}

export const PublicRoomView: React.FC<PublicRoomViewProps> = ({
  userPrefs,
  isSoundMuted,
  onBackToHome,
  onOpen1on1,
  onOpenDonationModal,
}) => {
  const [messages, setMessages] = useState<PublicRoomMessage[]>(() => {
    const saved = getStorageItem(
      STORAGE_KEYS.PUBLIC_ROOM.current,
      STORAGE_KEYS.PUBLIC_ROOM.legacies
    );
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return INITIAL_PUBLIC_ROOM_MESSAGES;
      }
    }
    return INITIAL_PUBLIC_ROOM_MESSAGES;
  });

  const [inputText, setInputText] = useState('');
  const [activeUsersCount, setActiveUsersCount] = useState(14);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Persist messages in storage
  useEffect(() => {
    setStorageItem(STORAGE_KEYS.PUBLIC_ROOM.current, JSON.stringify(messages));
  }, [messages]);

  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (inputText.trim() === '/donate') {
      setInputText('');
      if (onOpenDonationModal) {
        onOpenDonationModal();
      }
      return;
    }

    const sanitized = sanitizeMessageText(inputText);
    if (sanitized.isBlocked) return;

    const newMsg: PublicRoomMessage = {
      id: `room-${Date.now()}`,
      author: userPrefs.displayName || 'Sapphic Guest',
      authorPronouns: userPrefs.pronouns || 'she/her',
      avatarColor: '#382038',
      text: sanitized.cleanText,
      timestamp: Date.now(),
      isSelf: true,
    };

    setMessages((prev) => [...prev, newMsg]);
    setInputText('');

    if (!isSoundMuted) {
      soundEffects.playMessageSent();
    }

    // Occasional simulated friendly room response after 3-5 seconds
    if (Math.random() > 0.4) {
      setTimeout(() => {
        const potentialPeers = [
          { author: 'Willow Lark', pronouns: 'she/her', color: '#8D426B', text: 'I love that! Such a good point ✨' },
          { author: 'Rowan Meadow', pronouns: 'they/she', color: '#5a2548', text: 'Totally agree, feeling so cozy in here today 🍵' },
          { author: 'Ruby Fern', pronouns: 'she/her', color: '#7a3159', text: 'Aww welcome! Happy you shared that 🌸' },
        ];
        const peer = potentialPeers[Math.floor(Math.random() * potentialPeers.length)];
        const peerMsg: PublicRoomMessage = {
          id: `room-peer-${Date.now()}`,
          author: peer.author,
          authorPronouns: peer.pronouns,
          avatarColor: peer.color,
          text: peer.text,
          timestamp: Date.now(),
          isSelf: false,
        };
        setMessages((prev) => [...prev, peerMsg]);
        if (!isSoundMuted) {
          soundEffects.playMessageReceived();
        }
      }, 3500);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-4xl mx-auto w-full bg-[#17121B] sm:border-x border-[#403247]">
      {/* Room Header */}
      <div className="bg-[#241B29] px-4 py-3 border-b border-[#403247] flex items-center justify-between shadow-xs z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToHome}
            className="p-1.5 rounded-full hover:bg-[#302235] text-[#BDB0BF] hover:text-[#F7F0F6] transition-colors"
            aria-label="Back to home"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-serif text-base sm:text-lg font-bold text-[#F7F0F6]">
                Sapphic Town Square
              </h2>
              <span className="text-[11px] font-semibold text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-800/60 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {activeUsersCount} online
              </span>
            </div>
            <p className="text-xs text-[#BDB0BF]">
              Public, open conversation for all sapphic community members
            </p>
          </div>
        </div>

        <button
          onClick={onOpen1on1}
          className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#C77DAA] hover:bg-[#d893bd] text-[#17121B] text-xs font-semibold shadow-xs transition-colors"
        >
          <span>Switch to 1-on-1</span>
        </button>
      </div>

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#17121B]">
        {/* Welcome notice */}
        <div className="bg-[#241B29] rounded-2xl p-4 border border-[#403247] text-center max-w-md mx-auto my-2 space-y-1 text-xs text-[#BDB0BF] shadow-sm">
          <div className="flex items-center justify-center gap-1.5 font-bold text-[#F7F0F6]">
            <Sparkles className="w-4 h-4 text-[#C77DAA]" />
            <span>Welcome to the Public Room</span>
          </div>
          <p>
            Drop a cozy hello, share what song or book you're loving, or just say hi to everyone. Keep it kind and respectful!
          </p>
        </div>

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex items-start gap-3 ${msg.isSelf ? 'flex-row-reverse' : ''}`}
          >
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-xs border border-[#403247]"
              style={{ backgroundColor: msg.avatarColor }}
            >
              {msg.author.charAt(0)}
            </div>

            <div className={`max-w-[80%] ${msg.isSelf ? 'text-right' : 'text-left'}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-xs text-[#F7F0F6]">{msg.author}</span>
                <span className="text-[10px] text-[#C77DAA] bg-[#302235] px-1.5 py-0.2 rounded-full border border-[#403247]">
                  {msg.authorPronouns}
                </span>
                <span className="text-[10px] text-[#BDB0BF]">
                  {formatChatTime(msg.timestamp)}
                </span>
              </div>

              <div
                className={`p-3 rounded-2xl text-xs sm:text-sm leading-relaxed shadow-sm break-words inline-block text-left ${
                  msg.isSelf
                    ? 'bg-[#8E547E] text-[#F7F0F6] rounded-tr-xs'
                    : 'bg-[#241B29] text-[#F7F0F6] border border-[#403247] rounded-tl-xs'
                }`}
              >
                {msg.text}
              </div>
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Composer */}
      <form
        onSubmit={handleSendMessage}
        className="p-3 sm:p-4 bg-[#241B29] border-t border-[#403247] flex items-center gap-2"
      >
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={`Chat in public room as ${userPrefs.displayName || 'Sapphic Guest'}...`}
          className="flex-1 px-4 py-2.5 rounded-full bg-[#17121B] border border-[#403247] text-xs sm:text-sm text-[#F7F0F6] placeholder-[#BDB0BF]/50 focus:outline-none focus:border-[#C77DAA]"
        />
        <button
          type="submit"
          disabled={!inputText.trim()}
          className="p-2.5 rounded-full bg-[#C77DAA] hover:bg-[#d893bd] disabled:opacity-40 text-[#17121B] transition-all shadow-md cursor-pointer active:scale-95"
          aria-label="Send public message"
        >
          <Send className="w-4 h-4 text-[#17121B]" />
        </button>
      </form>
    </div>
  );
};

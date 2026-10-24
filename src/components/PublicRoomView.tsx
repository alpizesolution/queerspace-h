import React, { useState, useEffect, useRef } from 'react';
import { ArrowUp, Users } from 'lucide-react';
import { useVisualViewportHeight } from '../hooks/useVisualViewportHeight.ts';
import { PublicRoomMessage, UserPreferences } from '../types.ts';
import { INITIAL_PUBLIC_ROOM_MESSAGES } from '../utils/community-data.ts';
import { formatChatTime, sanitizeMessageText } from '../utils/matching-logic.ts';
import { soundEffects } from '../utils/sound.ts';

import { getStorageItem, setStorageItem, STORAGE_KEYS } from '../utils/storage.ts';

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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
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
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <p className="text-[15px] font-medium text-fg">It's quiet in here</p>
            <p className="text-[13px] text-muted mt-1">Say hi, or share what you're reading or listening to.</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex items-end gap-2 ${msg.isSelf ? 'flex-row-reverse' : ''}`}>
            {!msg.isSelf && (
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[13px] font-semibold shrink-0"
                style={{ backgroundColor: msg.avatarColor }}
                aria-hidden="true"
              >
                {msg.author.charAt(0)}
              </div>
            )}

            <div className={`max-w-[80%] flex flex-col ${msg.isSelf ? 'items-end' : 'items-start'}`}>
              <div className="flex items-baseline gap-1.5 mb-1 px-1 text-[12px]">
                {!msg.isSelf && <span className="font-semibold text-fg">{msg.author}</span>}
                {!msg.isSelf && <span className="text-subtle">{msg.authorPronouns}</span>}
                <span className="text-subtle">{formatChatTime(msg.timestamp)}</span>
              </div>
              <div
                className={`px-3.5 py-2 text-[15px] leading-snug rounded-[20px] break-words whitespace-pre-wrap ${
                  msg.isSelf ? 'bg-plum text-fg rounded-br-md' : 'bg-raised text-fg rounded-bl-md'
                }`}
              >
                {msg.text}
              </div>
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSendMessage} className="flex items-center gap-2 px-3 sm:px-4 py-2.5 border-t border-line">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={`Message as ${userPrefs.displayName || 'Sapphic Guest'}`}
          aria-label="Message the public room"
          enterKeyHint="send"
          autoComplete="off"
          className="flex-1 min-w-0 h-11 px-4 rounded-full bg-surface border border-line text-base sm:text-[15px] text-fg placeholder:text-subtle focus:outline-none focus:border-berry"
        />
        <button
          type="submit"
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

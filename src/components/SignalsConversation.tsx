import React, { FormEvent, KeyboardEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, Camera, Ellipsis, ImagePlus, LoaderCircle, MessageCircle, RefreshCw, Reply, Send, X } from 'lucide-react';
import { auth } from '../lib/firebase.ts';
import { useVisualViewport } from '../hooks/useVisualViewportHeight.ts';
import { useComposerFocus } from '../hooks/useComposerFocus.ts';
import { MemberAvatar } from './ProfileNav.tsx';
import { ConfirmDialog } from './Sheet.tsx';
import { isValidAvatar } from '../utils/avatar.ts';
import { soundEffects } from '../utils/sound.ts';
import { SwipeToReply } from './SwipeToReply.tsx';
import { TimedPhotoComposer } from './TimedPhotoComposer.tsx';
import { TimedPhotoViewer } from './TimedPhotoViewer.tsx';
import { GifBubble, GifIcon, GifPicker } from './GifPicker.tsx';
import { ComfortCardBubble, ComfortCardPicker, ComfortCardsIcon } from './ComfortCards.tsx';
import type { ComfortCard } from '../utils/comfortCards.ts';
import { gifSendProblemText, type GifInfo } from '../utils/gif.ts';
import { pickedFileProblem, pickProblemText, photoCard, photoReadProblemText, type PhotoTimer } from '../utils/timedPhoto.ts';
import { copyPickedPhoto, prepareTimedPhoto, sendPhotoProblemText, sendTimedPhoto } from '../services/timedPhotoService.ts';
import { hasNewIncomingMessage } from '../utils/incomingMessage.ts';
import { whileActive } from '../utils/whileActive.ts';
import { QUICK_REACTIONS } from '../utils/reactions.ts';
import {
  applyMyReaction,
  describeSendFailure,
  mergeMessages,
  newerCursor,
  visibleThread,
  type PendingMessage,
  type ThreadMessage,
} from '../utils/signalsThread.ts';

type SignalMessage = ThreadMessage;

/** A request that has not answered in this long is treated as failed, so nothing waits forever. */
const REQUEST_TIMEOUT_MS = 20_000;

/** The other member's public pseudonym and avatar, as returned by the Signals API. */
export type SignalsPartner = { displayName: string | null; avatar: string | null };

type SignalsConversationProps = {
  pairId: string;
  partner?: SignalsPartner;
  isSoundMuted?: boolean;
  onBack: () => void;
  /** The other member's id, so their avatar can open their profile. */
  partnerId?: string;
  /** Ends this connection with the existing `end` action. Resolves to null on success, or a message to show. */
  onEnd?: () => Promise<string | null>;
};

async function request<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const user = auth?.currentUser;
  if (!user) throw new Error('Your session is still preparing. Please try again.');
  const token = await user.getIdToken();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  let data: Record<string, unknown> & { error?: string };
  try {
    response = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    data = await response.json().catch(() => ({}));
  } finally {
    window.clearTimeout(timer);
  }
  if (!response.ok) {
    const messages: Record<string, string> = {
      unauthenticated: 'Your session needs to refresh. Please try again.',
      not_allowed: 'You can no longer message this connection.',
      pair_not_found: 'This connection could not be found.',
      pair_not_active: 'This connection has ended.',
      account_unavailable: 'Messaging is temporarily unavailable for this account.',
      invalid_card: 'That card isn’t available. Please pick another.',
      internal_error: 'Signals is temporarily unavailable. Please try again.',
    };
    throw Object.assign(new Error(messages[data.error ?? ''] || gifSendProblemText(data.error) || 'Could not complete that action. Please try again.'), { code: data.error });
  }
  return data as T;
}

function formatTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

/**
 * A timed photo inside a message bubble. Before it is opened the picture is not here at all (there is nothing to blur):
 * a concealed card shows the timer and an "Open photo" action. Afterwards it only ever says "Photo expired".
 */
const PhotoBubble: React.FC<{ photo: NonNullable<SignalMessage['photo']>; clock: number; closedHere: boolean; onOpen: () => void }> = ({ photo, clock, closedHere, onOpen }) => {
  const card = photoCard(photo, clock, closedHere);
  if (card.kind === 'expired') return <p className="flex min-h-9 items-center gap-1.5 text-[length:calc(14px_*_var(--fs,1))] italic opacity-70"><Camera className="h-4 w-4" aria-hidden="true" /> Photo expired</p>;
  if (card.kind === 'openable') {
    return (
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onOpen(); }}
        className="relative flex h-24 w-44 max-w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-line bg-gradient-to-br from-plum/50 via-surface to-ink text-fg transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60"
      >
        <span aria-hidden="true" className="absolute inset-0 backdrop-blur-xl" />
        <span className="relative flex items-center gap-1.5 text-[length:calc(14px_*_var(--fs,1))] font-semibold"><Camera className="h-4 w-4" aria-hidden="true" /> Open photo</span>
        <span className="relative rounded-full bg-black/40 px-2 py-0.5 text-[length:calc(11px_*_var(--fs,1))] font-semibold tabular-nums text-white/85">{photo.durationSec}s</span>
      </button>
    );
  }
  return <p className="flex min-h-9 items-center gap-1.5 text-[length:calc(14px_*_var(--fs,1))]"><Camera className="h-4 w-4" aria-hidden="true" /> {card.label}</p>;
};

export const SignalsConversation: React.FC<SignalsConversationProps> = ({ pairId, partner, partnerId, isSoundMuted = false, onBack, onEnd }) => {
  const [messages, setMessages] = useState<SignalMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  /** Messages written but not yet confirmed by the server: shown at once, marked while sending or failed. */
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [replyingTo, setReplyingTo] = useState<SignalMessage | null>(null);
  /** Message whose Reply / reaction actions are open (tap or Enter on the bubble). */
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hasUnseen, setHasUnseen] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [endBusy, setEndBusy] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  // Timed photos: the file being prepared to send, and the photo being viewed. Photos closed on this device show as expired.
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoSending, setPhotoSending] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);
  const [gifOpen, setGifOpen] = useState(false);
  const [cardsOpen, setCardsOpen] = useState(false);
  const [closedPhotos, setClosedPhotos] = useState<Set<string>>(() => new Set());
  const [clock, setClock] = useState(() => Date.now());
  const photoInputRef = useRef<HTMLInputElement>(null);
  /** One id per chosen photo, kept across taps and retries, so the server can never make two messages from one photo. */
  const photoMessageId = useRef<string | null>(null);
  /** Set the instant a send starts, before any state update, so a quick second tap cannot start another. */
  const photoBusy = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** True while the reader is at (or near) the newest message; scrolling up pauses auto-scroll. */
  const stickToBottom = useRef(true);
  const lastCount = useRef(0);
  const lastOwnSend = useRef(false);
  /** Where the last poll left off, so the next one asks only for what changed. */
  const cursor = useRef<string | null>(null);
  /** Sends go out one at a time, in the order they were written, so they land in that order. */
  const sendQueue = useRef<Promise<void>>(Promise.resolve());
  /** Messages with a reaction request in flight; a second tap on the same message waits for the first. */
  const reacting = useRef(new Set<string>());
  const lastMessageId = useRef<string | null>(null);
  /** Set after the first successful load, so a failed first load cannot make history chime later. */
  const loadedOnce = useRef(false);
  const soundMutedRef = useRef(isSoundMuted);
  soundMutedRef.current = isSoundMuted;
  const userId = auth?.currentUser?.uid;
  const partnerName = partner?.displayName?.trim() || 'Anonymous member';
  const { height: viewportHeight, offsetTop: viewportTop } = useVisualViewport();
  const coarsePointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  // On phones the keyboard overlays the page (iOS), so lift the conversation to the visible area while typing.
  const lifted = coarsePointer && composerFocused && viewportHeight !== null;
  // What the conversation gives up to the rest of the page: the app header and top safe area (none when the header is hidden on a
  // phone, see index.css) and the bottom tab bar.
  const chrome = 'var(--chat-top-chrome) - var(--tabbar-h)';

  const loadMessages = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      // After the first load, a poll asks only for messages that are new or changed (a reaction) since the cursor.
      const since = quiet && cursor.current ? `&after=${encodeURIComponent(cursor.current)}` : '';
      const result = await request<{ messages: SignalMessage[]; cursor?: string | null }>(
        `/api/signals?view=messages&pairId=${encodeURIComponent(pairId)}${since}`
      );
      const next = Array.isArray(result.messages) ? result.messages : [];
      cursor.current = newerCursor(cursor.current, result.cursor);
      if (!loadedOnce.current) {
        loadedOnce.current = true;
        lastMessageId.current = next.length ? next[next.length - 1].id : '';
      }
      setMessages((current) => (loadedOnce.current && current.length ? mergeMessages(current, next) : next));
      setError(null);
      setEnded(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load messages.';
      if (message.toLowerCase().includes('ended')) setEnded(true);
      setError(message);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [pairId]);

  // Polls only while someone is around: a hidden or idle tab stops asking, and coming back makes one quiet catch-up read
  // (it asks only for what changed since the cursor) before the polling resumes.
  useEffect(() => whileActive(() => {
    void loadMessages(loadedOnce.current);
    const timer = window.setInterval(() => void loadMessages(true), 4000);
    return () => window.clearInterval(timer);
  }), [loadMessages]);

  // The options menu closes on an outside tap or Escape, and focus returns to its button.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { setMenuOpen(false); menuButtonRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const confirmEndConversation = async () => {
    if (!onEnd || endBusy) return;
    setEndBusy(true);
    setEndError(null);
    const failure = await onEnd();
    setEndBusy(false);
    if (failure) setEndError(failure);
    else setConfirmEnd(false);
  };

  const thread = useMemo(() => visibleThread(messages, pending, userId ?? ''), [messages, pending, userId]);

  // Mark the conversation read once the reader can actually see the newest incoming message: the tab is visible and
  // the chat is open. The server recounts from that message, so anything that arrives afterwards stays unread.
  const markedThrough = useRef<string | null>(null);
  const [tabVisible, setTabVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  useEffect(() => {
    const onVisibility = () => setTabVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  useEffect(() => {
    if (!tabVisible || !userId) return;
    const newestIncoming = [...messages].reverse().find((m) => m.senderId !== userId);
    if (!newestIncoming || markedThrough.current === newestIncoming.id) return;
    markedThrough.current = newestIncoming.id;
    request('/api/signals', { action: 'mark-read', pairId, throughMessageId: newestIncoming.id }).catch(() => {
      // Not marked: allow the next poll to try again.
      if (markedThrough.current === newestIncoming.id) markedThrough.current = null;
    });
  }, [messages, tabVisible, userId, pairId]);

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    stickToBottom.current = true;
    setHasUnseen(false);
  }, []);

  // Swiping or tapping Reply: focus the message box, keep the latest message in view, and offer a one-tap fallback if the browser
  // will not raise the keyboard on its own (see hooks/useComposerFocus.ts).
  const composerFocus = useComposerFocus(textareaRef, {
    coarsePointer: Boolean(coarsePointer),
    afterFocus: () => {
      if (stickToBottom.current) scrollToBottom(false);
      textareaRef.current?.scrollIntoView?.({ block: 'nearest' });
    },
  }) ;

  // Chime when the other member's message arrives (the list is polled); existing history stays silent.
  useEffect(() => {
    if (!loadedOnce.current) return;
    const mapped = messages.map((m) => ({ id: m.id, isSelf: m.senderId === userId }));
    if (hasNewIncomingMessage(lastMessageId.current, mapped) && !soundMutedRef.current) soundEffects.playMessageReceived();
    lastMessageId.current = mapped.length ? mapped[mapped.length - 1].id : '';
  }, [messages, userId]);

  // Follow new messages only while the reader is at the bottom (or just sent one); otherwise flag them.
  useLayoutEffect(() => {
    const grew = thread.length > lastCount.current;
    const first = lastCount.current === 0;
    lastCount.current = thread.length;
    if (!grew) return;
    if (first || stickToBottom.current || lastOwnSend.current) scrollToBottom(!first);
    else setHasUnseen(true);
    lastOwnSend.current = false;
  }, [thread.length, scrollToBottom]);

  // Opening the keyboard shrinks the list; keep the newest message in view if the reader was there.
  useEffect(() => {
    if (stickToBottom.current) scrollToBottom(false);
  }, [viewportHeight, lifted, scrollToBottom]);

  // Grow the composer with its text, up to a few lines.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, [draft]);

  // A photo's expiry is shown from the clock, so keep it fresh while any photo is waiting or open.
  const hasLivePhoto = messages.some((m) => m.photo && m.photo.status !== 'expired');
  useEffect(() => {
    if (!hasLivePhoto) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasLivePhoto]);

  const choosePhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    const problem = pickedFileProblem(file);
    if (problem) { input.value = ''; setError(pickProblemText(problem)); return; }
    try {
      // Read it into memory now, before the picker's reference can go stale, and keep only the copy.
      const copy = await copyPickedPhoto(file);
      setError(null);
      setPhotoError(null);
      photoMessageId.current = crypto.randomUUID();
      setPhotoFile(copy);
    } catch (err) {
      console.warn('[Photo] could not read the chosen file:', err);
      setError(photoReadProblemText(err));
    } finally {
      input.value = '';
    }
  };

  const sendPhoto = async (timer: PhotoTimer) => {
    if (!photoFile || photoBusy.current) return;
    photoBusy.current = true;
    photoMessageId.current ??= crypto.randomUUID();
    setPhotoSending(true);
    setPhotoError(null);
    try {
      let imageBase64: string;
      try {
        imageBase64 = await prepareTimedPhoto(photoFile);
      } catch (err) {
        // Only a problem with the photo itself is reported as one, and it names the step that failed.
        console.warn('[Photo] could not prepare the photo:', err);
        setPhotoError(photoReadProblemText(err));
        return;
      }
      const result = await sendTimedPhoto({ pairId, messageId: photoMessageId.current, timer, imageBase64 });
      if (!result.ok) {
        if (result.reason === 'ended') setEnded(true);
        setPhotoError(sendPhotoProblemText(result.reason));
        return;
      }
      // The photo is sent. Nothing below may report it as a failure.
      lastOwnSend.current = true;
      stickToBottom.current = true;
      try { if (!soundMutedRef.current) soundEffects.playMessageSent(); } catch { /* a sound is never worth an error */ }
      setMessages((current) => mergeMessages(current, [result.message]));
      photoMessageId.current = null;
      setPhotoFile(null);
    } finally {
      photoBusy.current = false;
      setPhotoSending(false);
    }
  };

  /** Sends one pending message to the server. Safe to repeat: the server keeps a single copy per message id. */
  const deliver = async (item: PendingMessage) => {
    setPending((list) => list.map((p) => (p.id === item.id ? { ...p, status: 'sending', error: undefined } : p)));
    try {
      const result = await request<SignalMessage>('/api/signals', {
        action: 'send-message',
        pairId,
        messageId: item.id,
        // A GIF goes by its GIPHY id only; the server finds the picture and its address itself.
        // A Comfort Card goes by its id alone; the server supplies the question.
        ...(item.cardId ? { kind: 'card', cardId: item.cardId } : item.gif ? { kind: 'gif', gifId: item.gif.id } : { text: item.text }),
        ...(item.replyTo ? { replyTo: { messageId: item.replyTo.messageId, text: item.replyTo.text, sender: item.replyTo.sender } } : {}),
      });
      setMessages((current) => mergeMessages(current, [result]));
      setPending((list) => list.filter((p) => p.id !== item.id));
    } catch (err) {
      const failure = describeSendFailure(err);
      if (!failure.retryable && failure.message.toLowerCase().includes('ended')) setEnded(true);
      setPending((list) =>
        list.map((p) => (p.id === item.id ? { ...p, status: 'failed', error: failure.message, retryable: failure.retryable } : p))
      );
    }
  };

  const enqueue = (item: PendingMessage) => {
    sendQueue.current = sendQueue.current.then(() => deliver(item));
  };

  /** Puts the message on screen and in the outbox right away; the write to the server happens behind it. */
  const submitDraft = () => {
    const text = draft.trim();
    if (!text || ended) return;
    const reply = replyingTo;
    const item: PendingMessage = {
      id: crypto.randomUUID(),
      text,
      replyTo: reply
        ? { messageId: reply.id, text: reply.text, sender: reply.senderId === userId ? 'self' : 'partner', senderId: reply.senderId }
        : null,
      status: 'sending',
      retryable: true,
      createdAt: Date.now(),
    };
    lastOwnSend.current = true;
    stickToBottom.current = true;
    if (!soundMutedRef.current) soundEffects.playMessageSent();
    setPending((list) => [...list, item]);
    setDraft('');
    setReplyingTo(null);
    setError(null);
    enqueue(item);
  };

  /** Sends the chosen Comfort Card as a message. It shows at once, marked "Sending…", and goes through the same outbox as text. */
  const sendCard = (card: ComfortCard) => {
    if (ended) return;
    const reply = replyingTo;
    const item: PendingMessage = {
      id: crypto.randomUUID(),
      text: card.question,
      cardId: card.id,
      replyTo: reply
        ? { messageId: reply.id, text: reply.text, sender: reply.senderId === userId ? 'self' : 'partner', senderId: reply.senderId }
        : null,
      status: 'sending',
      retryable: true,
      createdAt: Date.now(),
    };
    lastOwnSend.current = true;
    stickToBottom.current = true;
    if (!soundMutedRef.current) soundEffects.playMessageSent();
    setCardsOpen(false);
    setPending((list) => [...list, item]);
    setReplyingTo(null);
    setError(null);
    enqueue(item);
  };

  /** Sends the chosen GIF as a message. It shows at once, marked "Sending…", and goes through the same outbox as text. */
  const sendGif = (gif: GifInfo) => {
    if (ended) return;
    const reply = replyingTo;
    const item: PendingMessage = {
      id: crypto.randomUUID(),
      text: 'GIF',
      gif,
      replyTo: reply
        ? { messageId: reply.id, text: reply.text, sender: reply.senderId === userId ? 'self' : 'partner', senderId: reply.senderId }
        : null,
      status: 'sending',
      retryable: true,
      createdAt: Date.now(),
    };
    lastOwnSend.current = true;
    stickToBottom.current = true;
    if (!soundMutedRef.current) soundEffects.playMessageSent();
    setGifOpen(false);
    setPending((list) => [...list, item]);
    setReplyingTo(null);
    setError(null);
    enqueue(item);
  };

  const sendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitDraft();
  };

  // Same keys as the MATCHING chat: Enter sends on a computer (Shift+Enter for a new line); on a phone Enter adds a line.
  const handleComposerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !coarsePointer && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submitDraft();
    }
  };

  const retrySend = (id: string) => {
    const item = pending.find((p) => p.id === id);
    if (item && item.status === 'failed') enqueue(item);
  };

  const discardPending = (id: string) => setPending((list) => list.filter((p) => p.id !== id));

  // A dropped connection that comes back retries what could not be sent, once, without making copies.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => {
    const onOnline = () => pendingRef.current.filter((p) => p.status === 'failed' && p.retryable).forEach((p) => enqueue(p));
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** One reaction per person: the same emoji again removes it, another replaces it. Shown at once, undone if it fails. */
  const toggleReaction = async (message: SignalMessage, emoji: string) => {
    if (ended || reacting.current.has(message.id)) return;
    reacting.current.add(message.id);
    const before = message.reactions;
    setError(null);
    setMessages((current) => current.map((m) => (m.id === message.id ? { ...m, reactions: applyMyReaction(m.reactions, emoji) } : m)));
    try {
      await request('/api/signals', { action: 'react-message', pairId, messageId: message.id, emoji });
    } catch (err) {
      setMessages((current) => current.map((m) => (m.id === message.id ? { ...m, reactions: before } : m)));
      setError(err instanceof Error ? err.message : 'Could not update reaction.');
    } finally {
      reacting.current.delete(message.id);
    }
  };

  return (
    <>
      {/* Keeps the page height while the conversation is lifted over the app header for typing. */}
      {lifted && <div aria-hidden="true" style={{ height: `calc(100dvh - ${chrome})` }} />}
      <section
        aria-label={`Private conversation with ${partnerName}`}
        className={`flex min-w-0 flex-col overflow-hidden bg-ink ${
          lifted ? 'fixed inset-x-0 top-0 z-[45] mx-auto w-full max-w-xl' : 'relative mx-auto w-full max-w-xl'
        }`}
        style={
          lifted
            ? { height: viewportHeight!, transform: viewportTop ? `translateY(${viewportTop}px)` : undefined }
            : { height: `calc(${viewportHeight ? `${viewportHeight}px` : '100dvh'} - ${chrome})` }
        }
      >
        <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-3 pb-2" style={{ paddingTop: 'calc(0.5rem + var(--chat-safe-top, 0px))' }}>
          <button type="button" onClick={onBack} aria-label="Back to Signals" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition hover:text-fg">
            <ArrowLeft className="h-5 w-5" />
          </button>
          {isValidAvatar(partner?.avatar)
            ? <MemberAvatar memberId={partnerId} avatar={partner?.avatar} seed={pairId} name={partnerName} className="h-9 w-9" />
            : <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-lavender/20 bg-plum/30 text-lavender"><MessageCircle className="h-4 w-4" /></div>}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[length:calc(15px_*_var(--fs,1))] font-semibold leading-tight text-fg" title={partnerName}>{partnerName}</h1>
            <p className="truncate text-[length:calc(11px_*_var(--fs,1))] leading-tight text-subtle">{ended ? 'Connection ended' : 'Private conversation · just the two of you'}</p>
          </div>
          <button type="button" onClick={() => void loadMessages()} disabled={loading} aria-label="Refresh messages" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition hover:text-fg disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {onEnd && !ended && (
            <div ref={menuRef} className="relative shrink-0">
              <button
                ref={menuButtonRef}
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-label="Conversation options"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="flex h-10 w-10 items-center justify-center rounded-full text-muted transition hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60"
              >
                <Ellipsis className="h-5 w-5" />
              </button>
              {menuOpen && (
                <div role="menu" aria-label="Conversation options" className="absolute right-0 top-11 z-20 min-w-44 overflow-hidden rounded-xl border border-line bg-raised py-1 shadow-lg shadow-black/40">
                  <button
                    type="button"
                    role="menuitem"
                    autoFocus
                    onClick={() => { setMenuOpen(false); setEndError(null); setConfirmEnd(true); }}
                    className="flex min-h-11 w-full items-center px-4 text-left text-sm text-danger transition hover:bg-surface/70 focus-visible:bg-surface/70 focus-visible:outline-none"
                  >
                    End Conversation
                  </button>
                </div>
              )}
            </div>
          )}
        </header>

        <div className="relative min-h-0 flex-1">
          <div
            ref={listRef}
            onScroll={(event) => {
              const el = event.currentTarget;
              const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              stickToBottom.current = atBottom;
              if (atBottom) setHasUnseen(false);
            }}
            className="h-full overflow-y-auto overscroll-contain px-3 py-2"
            aria-live="polite"
            aria-relevant="additions"
          >
            {loading && messages.length === 0 ? (
              <div className="flex h-full min-h-40 items-center justify-center gap-2 text-sm text-muted">
                <LoaderCircle className="h-4 w-4 animate-spin text-berry" /> Opening your conversation…
              </div>
            ) : thread.length === 0 ? (
              <div className="flex h-full min-h-40 flex-col items-center justify-center px-4 text-center">
                <p className="text-sm font-medium text-fg">A quiet little beginning</p>
                <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted">Say hello to {partnerName} when you're ready. There's no need to rush.</p>
              </div>
            ) : (
              thread.map((message, index) => {
                const mine = message.senderId === userId;
                const unsent = Boolean(message.pending);
                const sameSenderAsPrev = index > 0 && thread[index - 1].senderId === message.senderId;
                const open = activeId === message.id;
                const toggleActive = () => setActiveId((current) => (current === message.id ? null : message.id));
                return (
                  <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'} ${index === 0 ? '' : sameSenderAsPrev ? 'mt-0.5' : 'mt-2'}`}>
                    <div className={`flex min-w-0 max-w-[82%] flex-col sm:max-w-[75%] ${mine ? 'items-end' : 'items-start'}`}>
                      <SwipeToReply
                        disabled={ended || unsent}
                        className="max-w-full"
                        onReply={() => { setReplyingTo(message); setActiveId(null); composerFocus.requestFocus(); }}
                      >
                      <div
                        role="button"
                        tabIndex={0}
                        aria-expanded={open}
                        aria-label={`${mine ? 'Your' : `${partnerName}'s`} message: ${message.text}. Show actions`}
                        onClick={unsent ? undefined : toggleActive}
                        onKeyDown={(event) => {
                          if (!unsent && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggleActive(); }
                        }}
                        className={`${unsent ? 'opacity-70' : ''} min-w-0 max-w-full cursor-pointer rounded-2xl px-3 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-berry/60 ${mine ? 'rounded-br-md bg-berry text-ink' : 'rounded-bl-md border border-line bg-raised text-fg'}`}
                      >
                        {message.replyTo && (
                          <div className={`mb-1 rounded-md border-l-2 px-2 py-0.5 text-[length:calc(11px_*_var(--fs,1))] leading-snug ${mine ? 'border-ink/40 bg-ink/10 text-ink/80' : 'border-lavender bg-surface/70 text-muted'}`}>
                            <p className="font-semibold">{message.replyTo.senderId === userId ? 'You' : partnerName}</p>
                            <p className="line-clamp-1 [overflow-wrap:anywhere]">{message.replyTo.text}</p>
                          </div>
                        )}
                        <div className="flex flex-wrap items-end justify-end gap-x-2">
                          {message.kind === 'card' && message.card ? (
                            <ComfortCardBubble
                              card={{ category: message.card.category as ComfortCard['category'], question: message.text }}
                              canAnswer={!ended && !unsent}
                              onAnswer={() => { setReplyingTo(message); setActiveId(null); composerFocus.requestFocus(); }}
                            />
                          ) : message.kind === 'gif' && message.gif ? (
                            <GifBubble gif={message.gif} mine={mine} />
                          ) : message.photo ? (
                            <PhotoBubble
                              photo={message.photo}
                              clock={clock}
                              closedHere={closedPhotos.has(message.id)}
                              onOpen={() => { setActiveId(null); setViewingPhoto(message.id); }}
                            />
                          ) : (
                          <p className="min-w-0 max-w-full flex-auto whitespace-pre-wrap [overflow-wrap:anywhere] text-[length:calc(15px_*_var(--fs,1))] leading-snug">{message.text}</p>
                          )}
                          {message.createdAt && <span className={`ml-auto translate-y-px select-none text-[length:calc(10px_*_var(--fs,1))] leading-snug tabular-nums ${mine ? 'text-ink/60' : 'text-subtle'}`}>{formatTime(message.createdAt)}</span>}
                        </div>
                      </div>
                      </SwipeToReply>
                      {message.pending && (
                        <p
                          className={`mt-0.5 flex flex-wrap items-center gap-x-2 text-[length:calc(11px_*_var(--fs,1))] ${message.pending.status === 'failed' ? 'text-danger' : 'text-subtle'}`}
                          role={message.pending.status === 'failed' ? 'alert' : 'status'}
                        >
                          {message.pending.status === 'sending' ? (
                            <span className="inline-flex items-center gap-1"><LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" /> Sending…</span>
                          ) : (
                            <>
                              <span>Not sent. {message.pending.error}</span>
                              {message.pending.retryable && (
                                <button type="button" onClick={() => retrySend(message.id)} className="font-semibold text-berry underline underline-offset-4">Retry</button>
                              )}
                              <button type="button" onClick={() => discardPending(message.id)} className="font-semibold text-muted underline underline-offset-4">Discard</button>
                            </>
                          )}
                        </p>
                      )}
                      {((message.reactions || []).length > 0 || open) && (
                        <div className={`mt-0.5 flex flex-wrap items-center gap-1 ${mine ? 'justify-end' : 'justify-start'}`}>
                          {(message.reactions || []).map((reaction) => (
                            <button key={reaction.emoji} type="button" onClick={() => void toggleReaction(message, reaction.emoji)} aria-pressed={reaction.userReacted} aria-label={`${reaction.emoji} reaction, ${reaction.count} total`} className={`flex h-7 min-w-7 items-center justify-center rounded-full border px-1.5 text-xs transition ${reaction.userReacted ? 'border-berry/60 bg-plum/40' : 'border-line bg-raised/70'}`}>
                              {reaction.emoji}{reaction.count > 1 ? ` ${reaction.count}` : ''}
                            </button>
                          ))}
                          {open && !ended && (
                            <>
                              <button type="button" onClick={() => { setReplyingTo(message); setActiveId(null); composerFocus.requestFocus(); }} aria-label="Reply to message" className="flex h-8 items-center gap-1 rounded-full px-2 text-[length:calc(11px_*_var(--fs,1))] text-muted transition hover:bg-raised hover:text-fg">
                                <Reply className="h-3.5 w-3.5" /> Reply
                              </button>
                              {QUICK_REACTIONS.map((emoji) => {
                                const mineNow = (message.reactions || []).some((r) => r.emoji === emoji && r.userReacted);
                                return (
                                  <button key={emoji} type="button" onClick={() => { void toggleReaction(message, emoji); setActiveId(null); }} aria-pressed={mineNow} aria-label={mineNow ? `Remove ${emoji} reaction` : `React with ${emoji}`} className={`flex h-8 w-8 items-center justify-center rounded-full text-sm transition active:scale-125 ${mineNow ? 'bg-plum/50' : 'hover:bg-raised'}`}>{emoji}</button>
                                );
                              })}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {hasUnseen && (
            <button type="button" onClick={() => scrollToBottom(true)} className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-berry/40 bg-raised/95 px-3 py-1.5 text-xs font-semibold text-fg shadow-lg shadow-black/40">
              <ArrowDown className="h-3.5 w-3.5 text-berry" /> New messages
            </button>
          )}
        </div>

        {error && (
          <div role="alert" className="mx-3 mb-1 flex shrink-0 items-start gap-2 rounded-xl border border-berry/30 bg-plum/20 px-3 py-2 text-xs text-fg">
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => void loadMessages()} className="font-semibold text-berry underline underline-offset-4">Retry</button>
          </div>
        )}

        {ended ? (
          <div className="shrink-0 border-t border-line bg-raised/60 p-3 text-center text-sm text-muted">
            This connection has ended. Messaging is now closed.
            <button type="button" onClick={onBack} className="ml-2 font-semibold text-berry underline underline-offset-4">Back to Signals</button>
          </div>
        ) : (
          <div className="shrink-0 border-t border-line bg-ink px-3 pb-2 pt-2">
            {replyingTo && (
              <div className="mb-1.5 flex items-center gap-2 rounded-xl border border-line bg-raised/70 px-3 py-1.5">
                <Reply className="h-4 w-4 shrink-0 text-lavender" />
                <div className="min-w-0 flex-1">
                  <p className="text-[length:calc(10px_*_var(--fs,1))] font-semibold text-muted">Replying to {replyingTo.senderId === userId ? 'yourself' : partnerName}</p>
                  <p className="truncate text-xs text-fg">{replyingTo.text}</p>
                  {composerFocus.needsTap && (
                    <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={composerFocus.tapToType} className="mt-0.5 text-[length:calc(11px_*_var(--fs,1))] font-semibold text-berry underline underline-offset-2">
                      Tap to type your reply
                    </button>
                  )}
                </div>
                <button type="button" onClick={() => setReplyingTo(null)} aria-label="Cancel reply" className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:text-fg"><X className="h-4 w-4" /></button>
              </div>
            )}
            <form onSubmit={sendMessage} className="flex items-end gap-1.5 sm:gap-2">
              <label className="sr-only" htmlFor="signals-message">Your message</label>
              <textarea
                ref={textareaRef}
                id="signals-message"
                value={draft}
                onChange={(event) => { setDraft(event.target.value.slice(0, 1000)); composerFocus.dismissHint(); }}
                onFocus={() => setComposerFocused(true)}
                onBlur={() => { setComposerFocused(false); composerFocus.dismissHint(); }}
                onKeyDown={handleComposerKey}
                enterKeyHint={coarsePointer ? 'enter' : 'send'}
                placeholder="Write a message…"
                rows={1}
                maxLength={1000}
                className="max-h-28 min-h-10 min-w-0 flex-1 resize-none rounded-2xl border border-line bg-raised px-3.5 py-2 text-[length:calc(15px_*_var(--fs,1))] leading-snug text-fg outline-none placeholder:text-subtle focus:border-berry/60"
              />
              <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void choosePhoto(event)} className="hidden" tabIndex={-1} aria-hidden="true" />
              <button type="button" onClick={() => photoInputRef.current?.click()} onMouseDown={(event) => event.preventDefault()} aria-label="Send a timed photo" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-raised text-muted transition hover:text-fg">
                <ImagePlus className="h-[18px] w-[18px]" />
              </button>
              <button type="button" onClick={() => setGifOpen(true)} onMouseDown={(event) => event.preventDefault()} aria-label="Send a GIF" aria-haspopup="dialog" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-raised text-muted transition hover:text-fg">
                <GifIcon className="h-[20px] w-[20px]" />
              </button>
              <button type="button" onClick={() => setCardsOpen(true)} onMouseDown={(event) => event.preventDefault()} aria-label="Comfort Cards" title="Comfort Cards" aria-haspopup="dialog" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-lavender/30 bg-raised text-lavender transition hover:brightness-125">
                <ComfortCardsIcon className="h-[18px] w-[18px]" />
              </button>
              <button type="submit" disabled={!draft.trim()} onMouseDown={(event) => event.preventDefault()} aria-label="Send message" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-berry text-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        )}
      </section>
      {photoFile && (
        <TimedPhotoComposer file={photoFile} sending={photoSending} error={photoError} onSend={(timer) => void sendPhoto(timer)} onClose={() => { photoMessageId.current = null; setPhotoFile(null); }} />
      )}
      {gifOpen && !ended && <GifPicker onSend={sendGif} onClose={() => setGifOpen(false)} />}
      {cardsOpen && !ended && <ComfortCardPicker onSend={sendCard} onClose={() => setCardsOpen(false)} />}
      {viewingPhoto && (
        <TimedPhotoViewer
          key={viewingPhoto}
          pairId={pairId}
          messageId={viewingPhoto}
          onDone={(outcome) => {
            const id = viewingPhoto;
            setViewingPhoto(null);
            if (outcome !== 'unavailable') setClosedPhotos((current) => new Set(current).add(id));
            void loadMessages();
          }}
        />
      )}
      {confirmEnd && (
        <ConfirmDialog
          title="End this conversation?"
          message={
            <>
              This will close the mutual connection in QUEERSPACE. You can’t undo this action, and no message will be sent to the other person.
              {endError && <span role="alert" className="mt-2 block text-danger">{endError}</span>}
            </>
          }
          confirmLabel={endBusy ? 'Ending…' : endError ? 'Try again' : 'End conversation'}
          cancelLabel="Keep conversation"
          tone="danger"
          busy={endBusy}
          onCancel={() => { if (!endBusy) setConfirmEnd(false); }}
          onConfirm={() => void confirmEndConversation()}
        />
      )}
    </>
  );
};

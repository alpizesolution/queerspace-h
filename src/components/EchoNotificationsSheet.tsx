import React, { useState } from 'react';
import { Bell, MessageCircle, Settings2, Sparkles } from 'lucide-react';
import { Sheet } from './Sheet.tsx';
import { formatPostedAgo } from '../services/unsaidService.ts';
import { notificationText, type EchoNotification, type EchoNotificationPrefs } from '../services/echoNotificationService.ts';
import { kindInfo } from '../utils/echoKinds.ts';

/** Echo Notifications: replies and milestones on the member's own Echoes. Private to them; nobody here is named. */

export interface EchoNotificationsSheetProps {
  items: EchoNotification[];
  unread: number;
  loaded: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  prefs: EchoNotificationPrefs;
  onClose: () => void;
  onOpen: (n: EchoNotification) => void;
  onMarkRead: (id: string) => void;
  onMarkAll: () => void;
  onLoadMore: () => void;
  onPrefs: (prefs: EchoNotificationPrefs) => void;
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5 text-[length:calc(13px_*_var(--fs,1))] text-fg cursor-pointer">
      {label}
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--color-lavender,#b7a4ff)]" />
    </label>
  );
}

export const EchoNotificationsSheet: React.FC<EchoNotificationsSheetProps> = ({ items, unread, loaded, hasMore, loadingMore, prefs, onClose, onOpen, onMarkRead, onMarkAll, onLoadMore, onPrefs }) => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const now = Date.now();
  return (
    <Sheet title="Echo notifications" onClose={onClose} icon={<Bell className="w-4 h-4" />}>
      <div className="flex flex-col gap-3 text-fg">
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={onMarkAll} disabled={unread === 0} className="btn btn-secondary btn-sm disabled:opacity-40">
            Mark all as read
          </button>
          <button type="button" onClick={() => setSettingsOpen((o) => !o)} aria-expanded={settingsOpen} aria-label="Notification settings" className="icon-btn w-8 h-8 text-muted">
            <Settings2 className="w-4 h-4" />
          </button>
        </div>

        {settingsOpen && (
          <div className="rounded-xl border border-line px-3 py-1.5" role="group" aria-label="Notification settings">
            <Switch label="Replies to my Echoes" checked={prefs.replies} onChange={(v) => onPrefs({ ...prefs, replies: v })} />
            <Switch label="Reaction milestones" checked={prefs.milestones} onChange={(v) => onPrefs({ ...prefs, milestones: v })} />
          </div>
        )}

        {!loaded ? (
          <div className="space-y-2" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card h-16 animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-10 px-4">
            <p className="text-[length:calc(15px_*_var(--fs,1))] font-medium">No notifications yet</p>
            <p className="text-[length:calc(13px_*_var(--fs,1))] text-muted mt-1">You'll see replies and milestones on your Echoes here.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Notifications">
            {items.map((n) => {
              const text = notificationText(n);
              const Icon = n.type === 'milestone' ? Sparkles : MessageCircle;
              return (
                <li key={n.id} className={`flex items-start gap-1 rounded-2xl border px-3 py-2.5 ${n.read ? 'border-line' : 'border-lavender/30 bg-lavender/[0.06]'}`} data-unread={!n.read}>
                  <button type="button" onClick={() => onOpen(n)} className="flex min-w-0 flex-1 items-start gap-2.5 text-left" aria-label={`${text.title}. Open Echo`}>
                    <span className="mt-0.5 text-lavender" aria-hidden="true"><Icon className="w-4 h-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-berry" aria-label="Unread" role="img" />}
                        <span className="text-[length:calc(13.5px_*_var(--fs,1))] font-medium leading-snug">{text.title}</span>
                      </span>
                      <span className="block text-[length:calc(13px_*_var(--fs,1))] text-muted leading-snug [overflow-wrap:anywhere]">{text.body}</span>
                      <span className="mt-1 flex items-center gap-2 text-[length:calc(11px_*_var(--fs,1))] text-subtle">
                        <span className="tag">{kindInfo(n.kind).label}</span>
                        <span>{formatPostedAgo(n.at, now)}</span>
                      </span>
                    </span>
                  </button>
                  {!n.read && (
                    <button type="button" onClick={() => onMarkRead(n.id)} className="shrink-0 rounded-full px-2 py-1 text-[length:calc(11px_*_var(--fs,1))] text-muted hover:text-fg" aria-label="Mark as read">
                      Mark read
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {loaded && hasMore && (
          <button type="button" onClick={onLoadMore} disabled={loadingMore} className="btn btn-secondary btn-sm self-center">
            {loadingMore ? 'Loading…' : 'Show older'}
          </button>
        )}
      </div>
    </Sheet>
  );
};

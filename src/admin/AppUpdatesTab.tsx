import React, { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  APP_UPDATE_BODY_MAX,
  APP_UPDATE_CATEGORIES,
  APP_UPDATE_LINK_LABEL_MAX,
  APP_UPDATE_TITLE_MAX,
  AppUpdate,
  CleanAppUpdate,
  categoryLabel,
  deleteDraftUpdate,
  loadAllUpdates,
  saveAppUpdate,
  setAppUpdatePublished,
  validateAppUpdate,
} from '../services/appUpdatesService.ts';
import { formatUpdateDate } from '../components/WhatsNewSheet.tsx';

interface AppUpdatesTabProps {
  onConfirm: (c: { title: string; message: string; confirmLabel: string; run: () => Promise<void> }) => void;
}

interface FormState {
  title: string;
  body: string;
  category: string;
  linkUrl: string;
  linkLabel: string;
}

const EMPTY: FormState = { title: '', body: '', category: 'feature', linkUrl: '', linkLabel: '' };

const fromUpdate = (u: AppUpdate): FormState => ({
  title: u.title,
  body: u.body,
  category: u.category,
  linkUrl: u.link?.url ?? '',
  linkLabel: u.link?.label ?? '',
});

/** Exactly what a member sees when they open the update. */
const Preview: React.FC<{ value: CleanAppUpdate; date: string }> = ({ value, date }) => (
  <div className="rounded-2xl border border-line bg-ink p-4">
    <p className="text-[length:calc(11px_*_var(--fs,1))] uppercase tracking-[0.14em] text-subtle font-semibold">
      {categoryLabel(value.category)} <span className="normal-case tracking-normal font-normal ml-1">{date}</span>
    </p>
    <p className="mt-1 text-[length:calc(15px_*_var(--fs,1))] font-semibold text-fg">{value.title}</p>
    <p className="mt-2 whitespace-pre-line text-[length:calc(14px_*_var(--fs,1))] leading-relaxed text-muted">{value.body}</p>
    {value.link && (
      <span className="mt-3 inline-flex items-center gap-1.5 text-[length:calc(14px_*_var(--fs,1))] font-medium text-lavender">
        {value.link.label}
        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
      </span>
    )}
  </div>
);

/** App Updates: write, preview, publish, edit and unpublish the "What's New" entries members see. */
export const AppUpdatesTab: React.FC<AppUpdatesTabProps> = ({ onConfirm }) => {
  const [items, setItems] = useState<AppUpdate[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<AppUpdate | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  const refresh = useCallback(() => {
    setLoadError(false);
    loadAllUpdates()
      .then(setItems)
      .catch(() => {
        setItems([]);
        setLoadError(true);
      });
  }, []);

  useEffect(refresh, [refresh]);

  const open = (target: AppUpdate | 'new') => {
    setEditing(target);
    setForm(target === 'new' ? EMPTY : fromUpdate(target));
    setShowPreview(false);
    setMessage(null);
  };

  const close = () => {
    setEditing(null);
    setMessage(null);
  };

  const checked = validateAppUpdate(form);
  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (publish: boolean) => {
    if (!checked.ok) {
      setMessage({ kind: 'error', text: checked.error });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await saveAppUpdate(editing === 'new' ? null : editing, checked.value, publish);
      refresh();
      setEditing(null);
    } catch {
      setMessage({ kind: 'error', text: 'Could not save. Check that you are signed in as an admin and try again.' });
    } finally {
      setBusy(false);
    }
  };

  const unpublish = (u: AppUpdate) =>
    onConfirm({
      title: 'Unpublish this update?',
      message: `“${u.title}” will disappear from What’s New for everyone. It stays here as a draft.`,
      confirmLabel: 'Unpublish',
      run: async () => {
        await setAppUpdatePublished(u, false);
        refresh();
      },
    });

  const publishNow = (u: AppUpdate) =>
    onConfirm({
      title: 'Publish this update?',
      message: `“${u.title}” will show in What’s New for everyone, and members will see an unread dot.`,
      confirmLabel: 'Publish',
      run: async () => {
        await setAppUpdatePublished(u, true);
        refresh();
      },
    });

  const removeDraft = (u: AppUpdate) =>
    onConfirm({
      title: 'Delete this draft?',
      message: `“${u.title}” will be deleted for good.`,
      confirmLabel: 'Delete',
      run: async () => {
        await deleteDraftUpdate(u.id);
        refresh();
      },
    });

  if (editing) {
    const isPublished = editing !== 'new' && editing.status === 'published';
    const previewDate = formatUpdateDate(editing !== 'new' && editing.publishedAt ? editing.publishedAt : Date.now());
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight mb-1">{editing === 'new' ? 'New update' : 'Edit update'}</h1>
        <p className="text-[length:calc(13px_*_var(--fs,1))] text-muted mb-4">
          {isPublished ? 'This update is live. Saving changes it for everyone right away.' : 'Drafts are only visible to admins.'}
        </p>

        <form className="card p-4 space-y-3" onSubmit={(e) => e.preventDefault()}>
          <label className="block">
            <span className="text-sm font-medium text-fg">Title</span>
            <input className="input mt-1" value={form.title} maxLength={APP_UPDATE_TITLE_MAX} onChange={set('title')} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-fg">Description</span>
            <textarea className="input mt-1 min-h-28" value={form.body} maxLength={APP_UPDATE_BODY_MAX} onChange={set('body')} />
            <span className="text-xs text-subtle tabular-nums">{form.body.length}/{APP_UPDATE_BODY_MAX}</span>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-fg">Category</span>
            <select className="input mt-1" value={form.category} onChange={set('category')}>
              {APP_UPDATE_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-fg">Link (optional)</span>
              <input className="input mt-1" type="url" inputMode="url" placeholder="https://" value={form.linkUrl} onChange={set('linkUrl')} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-fg">Link label</span>
              <input className="input mt-1" value={form.linkLabel} maxLength={APP_UPDATE_LINK_LABEL_MAX} onChange={set('linkLabel')} />
            </label>
          </div>

          {showPreview && checked.ok && <Preview value={checked.value} date={previewDate} />}
          {message && (
            <p role={message.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${message.kind === 'error' ? 'text-danger' : 'text-muted'}`}>
              {message.text}
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" className="chip" disabled={!checked.ok} onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              {showPreview ? 'Hide preview' : 'Preview'}
            </button>
            {!isPublished && (
              <button type="button" className="chip" disabled={busy} onClick={() => save(false)}>Save draft</button>
            )}
            <button type="button" className="chip !bg-fg !text-ink !border-fg" disabled={busy} onClick={() => save(true)}>
              {isPublished ? 'Save changes' : 'Publish'}
            </button>
            <button type="button" className="chip" disabled={busy} onClick={close}>Cancel</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start gap-3 mb-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight mb-1">App Updates</h1>
          <p className="text-[length:calc(13px_*_var(--fs,1))] text-muted">What members see under Settings → What’s New.</p>
        </div>
        <button type="button" className="chip shrink-0" onClick={() => open('new')}>
          <Plus className="w-4 h-4" /> New update
        </button>
      </div>

      {loadError && <p className="card p-4 mb-4 text-sm text-danger" role="alert">Updates couldn’t load. <button type="button" className="underline" onClick={refresh}>Try again</button></p>}
      {items === null && <p className="text-sm text-muted" role="status">Loading…</p>}
      {items?.length === 0 && !loadError && <p className="card p-4 text-sm text-muted">No updates yet. Create the first one.</p>}

      <ul className="space-y-3">
        {items?.map((u) => (
          <li key={u.id} className="card p-4">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle">
              <span
                className={`rounded-full px-2 py-0.5 font-semibold ${u.status === 'published' ? 'bg-berry text-ink' : 'bg-raised text-muted'}`}
              >
                {u.status === 'published' ? 'Published' : 'Draft'}
              </span>
              <span>{categoryLabel(u.category)}</span>
              <span>
                {u.status === 'published'
                  ? `Published ${formatUpdateDate(u.publishedAt)}`
                  : `Edited ${formatUpdateDate(u.updatedAt)}`}
              </span>
            </div>
            <p className="mt-1.5 font-semibold text-fg">{u.title}</p>
            <p className="mt-1 text-sm text-muted line-clamp-2">{u.body}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="chip" onClick={() => open(u)}>
                <Pencil className="w-4 h-4" /> Edit
              </button>
              {u.status === 'published' ? (
                <button type="button" className="chip" onClick={() => unpublish(u)}>Unpublish</button>
              ) : (
                <>
                  <button type="button" className="chip" onClick={() => publishNow(u)}>Publish</button>
                  <button type="button" className="chip text-danger" onClick={() => removeDraft(u)}>
                    <Trash2 className="w-4 h-4" /> Delete
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

import React from 'react';
import { MoonStar, Sun, X } from 'lucide-react';

interface AppearanceSettingsModalProps {
  theme: 'dark' | 'light';
  onChangeTheme: (theme: 'dark' | 'light') => void;
  onClose: () => void;
}

export const AppearanceSettingsModal: React.FC<AppearanceSettingsModalProps> = ({
  theme, onChangeTheme, onClose,
}) => (
  <div
    className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 anim-fade"
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
  >
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="appearance-settings-title"
      className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-surface border border-line shadow-2xl p-5 sm:p-6 anim-sheet"
    >
      <div className="flex items-center gap-3 mb-2">
        <div className="flex-1">
          <p className="text-xs uppercase tracking-[0.16em] text-subtle font-semibold">Preferences</p>
          <h2 id="appearance-settings-title" className="text-xl font-semibold text-fg mt-1">Appearance</h2>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings">
          <X className="w-5 h-5" />
        </button>
      </div>
      <p className="text-sm text-muted mb-5">Choose how QUEERSPACE looks on this device.</p>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onChangeTheme('dark')}
          aria-pressed={theme === 'dark'}
          className={`rounded-2xl border p-4 text-left transition-colors ${theme === 'dark' ? 'border-berry bg-raised ring-1 ring-berry' : 'border-line hover:border-line-strong'}`}
        >
          <span className="flex h-16 rounded-xl bg-[#17101d] border border-[#403148] items-center justify-center mb-3">
            <MoonStar className="w-7 h-7 text-[#d7b8f4]" />
          </span>
          <span className="block text-sm font-semibold text-fg">Dark</span>
          <span className="block text-xs text-muted mt-1">Celestial night</span>
        </button>
        <button
          type="button"
          onClick={() => onChangeTheme('light')}
          aria-pressed={theme === 'light'}
          className={`rounded-2xl border p-4 text-left transition-colors ${theme === 'light' ? 'border-berry bg-raised ring-1 ring-berry' : 'border-line hover:border-line-strong'}`}
        >
          <span className="flex h-16 rounded-xl bg-[#fbf8fc] border border-[#e5dce9] items-center justify-center mb-3">
            <Sun className="w-7 h-7 text-[#8f2867]" />
          </span>
          <span className="block text-sm font-semibold text-fg">Light</span>
          <span className="block text-xs text-muted mt-1">Soft lavender</span>
        </button>
      </div>
      <p className="text-xs text-subtle mt-4">Your choice is saved on this device and applies across the app.</p>
    </section>
  </div>
);

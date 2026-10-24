import React, { useEffect, useState } from 'react';
import { MoreHorizontal, Share, X } from 'lucide-react';
import { detectInstallPlatform, InstallPlatform } from '../utils/install-platform.ts';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

// The browser can fire beforeinstallprompt before React mounts, so catch it as soon as this module loads.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    listeners.forEach((fn) => fn());
  });
}

// "Not now" only lasts for this visit: anyone who hasn't installed sees the card again next time.
const DISMISS_KEY = 'qs_install_dismissed';
const SHOW_AFTER_MS = 3000;

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function dismissedThisVisit(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function currentPlatform(): InstallPlatform {
  return detectInstallPlatform(navigator.userAgent, {
    standalone: isStandalone(),
    hasPrompt: Boolean(deferredPrompt),
    maxTouchPoints: navigator.maxTouchPoints,
  });
}

const Steps: React.FC<{ platform: InstallPlatform }> = ({ platform }) => {
  const icon = (Icon: typeof Share) => <Icon className="inline w-4 h-4 -mt-0.5 mx-0.5 text-fg" aria-hidden="true" />;
  switch (platform) {
    case 'ios-safari':
      return (
        <>
          Tap {icon(Share)} <b className="text-fg font-medium">Share</b> (on newer iPhones it's under{' '}
          {icon(MoreHorizontal)}), then{' '}
          <b className="text-fg font-medium">Add to Home Screen</b>.
        </>
      );
    case 'ios-other':
      return (
        <>
          Tap {icon(Share)} <b className="text-fg font-medium">Share</b> in the address bar, then{' '}
          <b className="text-fg font-medium">Add to Home Screen</b>.
        </>
      );
    case 'in-app':
      return (
        <>
          You're in an app's browser. Tap {icon(MoreHorizontal)} and choose{' '}
          <b className="text-fg font-medium">Open in browser</b> to install.
        </>
      );
    case 'android-other':
      return (
        <>
          Open your browser menu {icon(MoreHorizontal)} and tap <b className="text-fg font-medium">Install</b> or{' '}
          <b className="text-fg font-medium">Add to Home screen</b>.
        </>
      );
    default:
      return <>One tap to open, full screen, no app store needed.</>;
  }
};

/** A small card suggesting the home-screen app, with steps that match the visitor's device. */
export const InstallPrompt: React.FC = () => {
  const [platform, setPlatform] = useState<InstallPlatform>(() =>
    typeof window === 'undefined' ? 'none' : currentPlatform()
  );
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const update = () => setPlatform(currentPlatform());
    listeners.add(update);
    const timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => {
      listeners.delete(update);
      clearTimeout(timer);
    };
  }, []);

  if (!visible || platform === 'installed' || platform === 'none' || dismissedThisVisit()) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Storage blocked: the card just closes for now.
    }
    setVisible(false);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (outcome === 'accepted') setVisible(false);
    else dismiss();
  };

  return (
    <div
      role="dialog"
      aria-label="Install QUEERSPACE PH"
      className="fixed z-30 inset-x-3 top-[calc(env(safe-area-inset-top)+var(--header-h)+0.5rem)] sm:top-auto sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[22rem] card !bg-raised/95 backdrop-blur-xl shadow-2xl shadow-black/50 p-4 anim-pop"
    >
      <div className="flex items-start gap-3">
        <img src="/icon-192.png" alt="" className="w-11 h-11 rounded-xl border border-line shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-fg">Get the QUEERSPACE PH app</p>
          <p className="text-[13px] text-muted mt-0.5 leading-relaxed">
            <Steps platform={platform} />
          </p>
        </div>
        <button onClick={dismiss} className="icon-btn w-8 h-8 -mr-1.5 -mt-1.5 shrink-0" aria-label="Not now">
          <X className="w-4 h-4" />
        </button>
      </div>
      {platform === 'prompt' && (
        <div className="flex justify-end gap-2 mt-3">
          <button onClick={dismiss} className="btn btn-ghost btn-sm">
            Not now
          </button>
          <button onClick={install} className="btn btn-primary btn-sm">
            Install
          </button>
        </div>
      )}
    </div>
  );
};

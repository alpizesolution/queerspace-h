import { lazy, Suspense } from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { QuotaNotice } from './components/QuotaNotice.tsx';
import './index.css';
import { hideSplash } from './utils/splash.ts';
import { unlockAudioOnFirstTap } from './utils/sound.ts';
import { installQuotaWatch } from './utils/quotaGuard.ts';

installQuotaWatch();

// The admin page is its own bundle, so regular visitors never download it.
const AdminApp = lazy(() => import('./admin/AdminApp.tsx'));
const isAdminRoute = /^\/admin\/?$/.test(window.location.pathname);

// /admin installs as its own home-screen app ("QS Admin") that opens straight to the dashboard.
if (isAdminRoute) {
  document.querySelectorAll<HTMLLinkElement>('link[rel="manifest"]').forEach((link, i) => {
    if (i === 0) link.href = '/admin.webmanifest';
    else link.remove();
  });
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', 'QS Admin');
  // iPhone home-screen apps get their own storage, so the admin's Google sign-in from Safari
  // doesn't carry over, and signing in inside one can't finish. Without this meta (and with
  // display: minimal-ui, which iOS treats as "browser"), the QS Admin icon opens in Safari and
  // shares its sign-in. Android and desktop still install it as an app window.
  document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.remove();
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    {isAdminRoute ? (
      <Suspense fallback={null}>
        <AdminApp />
      </Suspense>
    ) : (
      <App />
    )}
    <QuotaNotice />
  </ErrorBoundary>
);

// Admins skip the brand moment; everyone else sees it for a beat after the app renders.
requestAnimationFrame(() => hideSplash(isAdminRoute ? 0 : undefined));
unlockAudioOnFirstTap();

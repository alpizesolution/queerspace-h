import { lazy, Suspense } from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';
import { hideSplash } from './utils/splash.ts';
import { unlockAudioOnFirstTap } from './utils/sound.ts';

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
  </ErrorBoundary>
);

// Admins skip the brand moment; everyone else sees it for a beat after the app renders.
requestAnimationFrame(() => hideSplash(isAdminRoute ? 0 : undefined));
unlockAudioOnFirstTap();

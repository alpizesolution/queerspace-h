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

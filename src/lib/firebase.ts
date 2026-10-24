import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, User, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { Analytics, getAnalytics, isSupported as isAnalyticsSupported, logEvent } from 'firebase/analytics';

const getEnvVar = (key: string): string | undefined => {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env[key];
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key];
  }
  return undefined;
};

const firebaseConfig = {
  apiKey: getEnvVar('VITE_FIREBASE_API_KEY'),
  authDomain: getEnvVar('VITE_FIREBASE_AUTH_DOMAIN'),
  databaseURL: getEnvVar('VITE_FIREBASE_DATABASE_URL'),
  projectId: getEnvVar('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: getEnvVar('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: getEnvVar('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: getEnvVar('VITE_FIREBASE_APP_ID'),
  measurementId: getEnvVar('VITE_FIREBASE_MEASUREMENT_ID'),
};


export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.apiKey !== 'your-api-key'
);

const app = isFirebaseConfigured
  ? (getApps().length ? getApp() : initializeApp(firebaseConfig))
  : null;

// App Check proves requests come from this website (not a script), so Firestore can
// reject bots once enforcement is switched on in the Firebase Console.
// Turned on by setting VITE_FIREBASE_APPCHECK_SITE_KEY (a reCAPTCHA Enterprise / Google Cloud
// Fraud Defense website key; classic reCAPTCHA v3 keys are deprecated).
const appCheckSiteKey = getEnvVar('VITE_FIREBASE_APPCHECK_SITE_KEY');
export const isAppCheckEnabled = Boolean(
  app && appCheckSiteKey && typeof window !== 'undefined' && getEnvVar('VITE_USE_FIREBASE_EMULATOR') !== 'true'
);
if (app && isAppCheckEnabled && appCheckSiteKey) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    console.warn('[AppCheck] Could not start:', err);
  }
}

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

// Local development only: VITE_USE_FIREBASE_EMULATOR=true points the app at the Firebase emulators.
if (auth && db && getEnvVar('VITE_USE_FIREBASE_EMULATOR') === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

// Google Analytics (GA4 through Firebase) for visitor counts and realtime views.
// Turned on by setting VITE_FIREBASE_MEASUREMENT_ID; off in emulator mode and on /admin.
let analytics: Analytics | null = null;
const analyticsReady: Promise<Analytics | null> =
  app &&
  firebaseConfig.measurementId &&
  typeof window !== 'undefined' &&
  getEnvVar('VITE_USE_FIREBASE_EMULATOR') !== 'true' &&
  !/^\/admin\/?$/.test(window.location.pathname)
    ? isAnalyticsSupported()
        .then((ok) => (analytics = ok ? getAnalytics(app) : null))
        .catch((err) => {
          console.warn('[Analytics] Could not start:', err);
          return null;
        })
    : Promise.resolve(null);

/** Records a screen in Analytics. The app has no URL routes, so each view counts as a page. */
export function logScreenView(screen: string): void {
  analyticsReady.then((a) => {
    if (!a) return;
    logEvent(a, 'page_view', { page_title: screen, page_location: `${window.location.origin}/#${screen}` });
  });
}

export async function ensureAnonymousAuth(): Promise<User | null> {
  if (!auth) return null;

  try {
    if (typeof auth.authStateReady === 'function') {
      await auth.authStateReady();
    }
    if (auth.currentUser) {
      return auth.currentUser;
    }

    const cred = await signInAnonymously(auth);
    return cred.user;
  } catch (err) {
    console.warn('Firebase Anonymous Sign-In failed or pending setup:', err);
    return null;
  }
}


export function subscribeAuthState(callback: (user: User | null) => void): () => void {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    isAnonymous?: boolean | null;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid || null,
      isAnonymous: auth?.currentUser?.isAnonymous || null,
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

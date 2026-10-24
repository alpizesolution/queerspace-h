import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import {
  ensureAnonymousAuth,
  subscribeAuthState,
  isFirebaseConfigured,
  auth,
} from '../lib/firebase.ts';

export type AuthStatus = 'loading' | 'connected' | 'local_fallback' | 'error';

export interface UseFirebaseAuthResult {
  user: User | null;
  uid: string | null;
  shortUid: string | null;
  isAnonymous: boolean;
  status: AuthStatus;
  authError: string | null;
  retryAuth: () => Promise<User | null>;
}

export function useFirebaseAuth(): UseFirebaseAuthResult {
  const [user, setUser] = useState<User | null>(() => auth?.currentUser || null);
  const [status, setStatus] = useState<AuthStatus>(() => {
    if (!isFirebaseConfigured) return 'local_fallback';
    return auth?.currentUser ? 'connected' : 'loading';
  });
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setStatus('local_fallback');
      return;
    }

    let isMounted = true;

    // First attempt to ensure or restore anonymous auth
    ensureAnonymousAuth()
      .then((currentUser) => {
        if (!isMounted) return;
        if (currentUser) {
          setUser(currentUser);
          setStatus('connected');
          setAuthError(null);
        } else if (!auth?.currentUser) {
          setStatus('local_fallback');
        }
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setAuthError(msg);
        setStatus('local_fallback');
      });

    // Subscribe to Firebase Auth state changes
    const unsubscribe = subscribeAuthState((updatedUser) => {
      if (!isMounted) return;
      if (updatedUser) {
        setUser(updatedUser);
        setStatus('connected');
        setAuthError(null);
      } else {
        setUser(null);
        if (isFirebaseConfigured) {
          setStatus('local_fallback');
        }
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const retryAuth = async (): Promise<User | null> => {
    if (!isFirebaseConfigured) {
      setStatus('local_fallback');
      return null;
    }

    setStatus('loading');
    setAuthError(null);

    try {
      const res = await ensureAnonymousAuth();
      if (res) {
        setUser(res);
        setStatus('connected');
        return res;
      } else {
        setStatus('local_fallback');
        return null;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAuthError(msg);
      setStatus('error');
      return null;
    }
  };

  const uid = user ? user.uid : null;
  const shortUid = uid ? uid.slice(-4) : null;
  const isAnonymous = Boolean(user?.isAnonymous);

  return {
    user,
    uid,
    shortUid,
    isAnonymous,
    status,
    authError,
    retryAuth,
  };
}

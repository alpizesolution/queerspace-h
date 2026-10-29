import { useCallback, useEffect, useState } from 'react';
import { isFirebaseConfigured } from '../lib/firebase.ts';
import { loadPublishedUpdates, loadReadIds, unreadUpdateIds } from '../services/appUpdatesService.ts';

/**
 * Whether the member has published "What's New" updates they have not opened.
 * Checked once on start and again whenever `refresh` is called (after the panel closes).
 * Any failure leaves the indicator off: a missing dot is better than a false one.
 */
export function useUnreadUpdates() {
  const [hasUnread, setHasUnread] = useState(false);

  const refresh = useCallback(() => {
    if (!isFirebaseConfigured) return;
    Promise.all([loadPublishedUpdates(), loadReadIds()])
      .then(([page, read]) => setHasUnread(unreadUpdateIds(page.items, read).length > 0))
      .catch(() => setHasUnread(false));
  }, []);

  useEffect(refresh, [refresh]);

  return { hasUnread, refresh };
}

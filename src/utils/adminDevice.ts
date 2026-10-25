/**
 * Remembers on this device that an admin signed in at /admin, so the main app can show a
 * shortcut to it. Only a convenience: /admin and firestore.rules still check access.
 */
const ADMIN_DEVICE_KEY = 'qs_admin_device';

export function rememberAdminDevice(isAdmin: boolean): void {
  try {
    if (isAdmin) localStorage.setItem(ADMIN_DEVICE_KEY, '1');
    else localStorage.removeItem(ADMIN_DEVICE_KEY);
  } catch {
    // Storage blocked: the shortcut just won't show.
  }
}

export function isAdminDevice(): boolean {
  try {
    return localStorage.getItem(ADMIN_DEVICE_KEY) === '1';
  } catch {
    return false;
  }
}

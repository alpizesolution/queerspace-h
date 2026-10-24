/**
 * Works out how this visitor can install QUEERSPACE PH, so the install card can
 * show the right instructions for their device.
 */
export type InstallPlatform =
  | 'installed' // already running as the installed app
  | 'prompt' // Chrome, Edge, Samsung Internet: the browser gave us a one-tap install prompt
  | 'ios-safari' // iPhone/iPad Safari: Share → Add to Home Screen
  | 'ios-other' // Chrome/Firefox/Edge on iPhone: same steps, from the share icon in the address bar
  | 'in-app' // Facebook, Messenger, Instagram, TikTok… in-app browsers can't install
  | 'android-other' // e.g. Firefox on Android: install from the browser menu
  | 'none'; // desktop browsers without install support, or a prompt that hasn't arrived yet

const IN_APP = /FBAN|FBAV|FB_IAB|Messenger|Instagram|musical_ly|TikTok|Line\/|Twitter|Snapchat|\bwv\)/i;

export function detectInstallPlatform(
  userAgent: string,
  opts: { standalone: boolean; hasPrompt: boolean; maxTouchPoints?: number }
): InstallPlatform {
  if (opts.standalone) return 'installed';
  if (IN_APP.test(userAgent)) return 'in-app';
  if (opts.hasPrompt) return 'prompt';

  // iPadOS reports itself as a Mac, so also check for touch.
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && (opts.maxTouchPoints ?? 0) > 1);
  if (isIOS) {
    return /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//i.test(userAgent) ? 'ios-other' : 'ios-safari';
  }
  // Chromium on Android installs through the prompt; wait for it rather than guessing.
  if (/Android/i.test(userAgent) && /Firefox/i.test(userAgent)) return 'android-other';
  return 'none';
}

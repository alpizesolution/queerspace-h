import { soundEffects } from './sound.ts';

const SOUND_KEY = 'queerspace_admin_sound';

/** Admin notification sound: off unless this admin turned it on, kept on this device only. */
export function adminSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === 'on';
  } catch {
    return false;
  }
}

export function setAdminSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    // Private mode: the choice just doesn't stick.
  }
}

/**
 * One soft chime for a genuinely new submission, only when the admin turned sound on. Browsers only allow sound
 * after a tap, and soundEffects already ignores a blocked or suspended audio context, so this never throws.
 */
export function playAdminChime(enabled: boolean = adminSoundEnabled(), play: () => void = soundEffects.playMessageReceived): boolean {
  if (!enabled) return false;
  try {
    play();
    return true;
  } catch {
    return false;
  }
}

/** What a toast says. It never carries any of the submission's own text. */
export function toastCopy(kind: 'suggestion' | 'report'): { title: string; body: string } {
  return kind === 'suggestion'
    ? { title: 'New Suggestion', body: 'A member submitted a new suggestion.' }
    : { title: 'New Report', body: 'A member submitted a new report requiring attention.' };
}

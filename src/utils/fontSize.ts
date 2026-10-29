export type FontSize = 'tiny' | 'small' | 'medium' | 'large';

export const FONT_SIZE_KEY = 'queerspace_font_size';
/** Set once the person picks a size themselves; until then the size follows the device. */
export const FONT_SIZE_CHOSEN_KEY = 'queerspace_font_size_chosen';
export const DEFAULT_FONT_SIZE: FontSize = 'small';
/** Phones read better a notch smaller; tablets and desktops start at Small. */
export const PHONE_FONT_SIZE: FontSize = 'tiny';

/** Options in display order. The scale itself lives in index.css (`--fs` per `data-fontsize`). */
export const FONT_SIZE_OPTIONS: { id: FontSize; label: string }[] = [
  { id: 'tiny', label: 'Tiny' },
  { id: 'small', label: 'Small' },
  { id: 'medium', label: 'Medium' },
  { id: 'large', label: 'Large' },
];

/** A phone: a touch screen whose shorter side is under 600 CSS px (tablets and desktops are not). */
export function isPhoneDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const shorterSide = Math.min(window.screen?.width ?? Infinity, window.screen?.height ?? Infinity);
  return touch && shorterSide < 600;
}

/**
 * The size to use at start. A size the person picked always wins. Without a pick, Tiny/Medium/Large saved by earlier
 * versions were deliberate and stay; a saved Small was only the old automatic default, so it follows the device.
 * Keep the inline script in index.html in step with this.
 */
export function resolveFontSize(stored: unknown, chosen: boolean, phone: boolean): FontSize {
  const saved = stored === 'tiny' || stored === 'small' || stored === 'medium' || stored === 'large' ? stored : null;
  if (saved && (chosen || saved !== 'small')) return saved;
  return phone ? PHONE_FONT_SIZE : DEFAULT_FONT_SIZE;
}

/** Anything unknown, missing or corrupted falls back to Small. */
export function parseFontSize(value: unknown): FontSize {
  return value === 'tiny' || value === 'small' || value === 'medium' || value === 'large' ? value : DEFAULT_FONT_SIZE;
}

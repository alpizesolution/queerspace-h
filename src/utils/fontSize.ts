export type FontSize = 'small' | 'medium' | 'large';

export const FONT_SIZE_KEY = 'queerspace_font_size';
export const DEFAULT_FONT_SIZE: FontSize = 'small';

/** Options in display order. The scale itself lives in index.css (`--fs` per `data-fontsize`). */
export const FONT_SIZE_OPTIONS: { id: FontSize; label: string }[] = [
  { id: 'small', label: 'Small' },
  { id: 'medium', label: 'Medium' },
  { id: 'large', label: 'Large' },
];

/** Anything unknown, missing or corrupted falls back to Small. */
export function parseFontSize(value: unknown): FontSize {
  return value === 'medium' || value === 'large' || value === 'small' ? value : DEFAULT_FONT_SIZE;
}

/**
 * Profile backgrounds: an animated galaxy (one of eight original presets) or a member's own static image, shown behind the whole profile
 * page. Pure rules shared by the profile page, the Studio where a member customises it, the profile save and the tests.
 *
 * What is stored on the public profile (the only thing; no media ever goes into Firestore):
 *   { kind: 'preset', preset, x, y, dim, animate }   an animated preset (the scene itself is drawn by the app, so nothing is downloaded)
 *   { kind: 'image', image, x, y, dim, animate }     a static image the member uploaded; `image` is an id, the bytes live in R2
 * `x` and `y` (0 to 100) position it, `dim` (0 to 80) is the darkness laid over it, `animate` is the member's own motion switch.
 * No background at all means the default profile look, so every existing profile is unchanged.
 *
 * firestore.rules and api/_background.js list the same preset ids and limits (a test keeps them in step).
 */

export type PresetId =
  | 'nebula-dreams'
  | 'midnight-universe'
  | 'stardust-bloom'
  | 'aurora-galaxy'
  | 'celestial-ocean'
  | 'solar-eclipse'
  | 'cosmic-dust'
  | 'moonlight';

export interface PresetInfo {
  id: PresetId;
  name: string;
  blurb: string;
  /** What the preset does, in a few words, so the gallery says how each one moves and they are not just different colours. */
  motion: string;
  /** Colours for the still thumbnail in the gallery (the animation only runs in the one preview and on the profile). */
  swatch: [string, string, string];
}

export const BACKGROUND_PRESETS: readonly PresetInfo[] = [
  { id: 'nebula-dreams', name: 'Nebula Dreams', blurb: 'Drifting purple and blue nebula', motion: 'Slow clouds drifting through starlight', swatch: ['#1b1146', '#6b3fd1', '#2a6fdb'] },
  { id: 'midnight-universe', name: 'Midnight Universe', blurb: 'Deep navy space with moving stars', motion: 'Stars passing at three depths', swatch: ['#050a1c', '#0f2557', '#7aa7ff'] },
  { id: 'stardust-bloom', name: 'Stardust Bloom', blurb: 'Pink and magenta cosmic clouds', motion: 'Clouds breathing and sparkling', swatch: ['#2a0a2e', '#d6339a', '#ff8ad4'] },
  { id: 'aurora-galaxy', name: 'Aurora Galaxy', blurb: 'Flowing teal and cyan aurora', motion: 'Ribbons of light rippling overhead', swatch: ['#04161f', '#14b8a6', '#22d3ee'] },
  { id: 'celestial-ocean', name: 'Celestial Ocean', blurb: 'Deep blue atmospheric galaxy', motion: 'Currents and light shafts flowing past', swatch: ['#020b24', '#1747a8', '#4aa3ff'] },
  { id: 'solar-eclipse', name: 'Solar Eclipse', blurb: 'Glowing light against dark space', motion: 'A slow-turning corona around a dark sun', swatch: ['#06030a', '#f59e0b', '#fde68a'] },
  { id: 'cosmic-dust', name: 'Cosmic Dust', blurb: 'Colourful floating interstellar particles', motion: 'Glowing particles rising and swaying', swatch: ['#0b0716', '#e879f9', '#38bdf8'] },
  { id: 'moonlight', name: 'Moonlight', blurb: 'Soft silver and violet atmosphere', motion: 'A drifting moon glow and thin cloud', swatch: ['#0f0d1f', '#8b7fc4', '#dfe3f5'] },
];

export const PRESET_IDS: readonly PresetId[] = BACKGROUND_PRESETS.map((p) => p.id);

export const presetInfo = (id: unknown): PresetInfo | null => BACKGROUND_PRESETS.find((p) => p.id === id) ?? null;

export const DIM_MIN = 0;
export const DIM_MAX = 80;
export const DEFAULT_DIM_PRESET = 15;
export const DEFAULT_DIM_IMAGE = 40;

/** An uploaded image's id: 16 lowercase hex characters, made by the server. */
export const IMAGE_ID = /^[a-f0-9]{16}$/;

export interface ProfileBackground {
  kind: 'preset' | 'image';
  preset?: PresetId;
  image?: string;
  /** Position, 0 to 100 (50 is centred). */
  x: number;
  y: number;
  /** Darkness laid over the background, 0 to 80 percent. */
  dim: number;
  /** The member's own switch for motion. Off shows a still frame. */
  animate: boolean;
}

const int = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

/** A new background of a preset, with the usual defaults. */
export const presetBackground = (preset: PresetId, over: Partial<ProfileBackground> = {}): ProfileBackground =>
  ({ kind: 'preset', preset, x: 50, y: 50, dim: DEFAULT_DIM_PRESET, animate: true, ...over });

/** A new background of an uploaded image, with the usual defaults. */
export const imageBackground = (image: string, over: Partial<ProfileBackground> = {}): ProfileBackground =>
  ({ kind: 'image', image, x: 50, y: 50, dim: DEFAULT_DIM_IMAGE, animate: true, ...over });

/**
 * Reads a background from stored data. Anything that is not exactly a valid preset or image, or has an unknown field, gives null (the
 * default profile look), and the numbers are always brought inside their limits, so a bad record can never break a profile.
 */
export function parseBackground(value: unknown): ProfileBackground | null {
  const raw = value as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (Object.keys(raw).some((key) => !['kind', 'preset', 'image', 'x', 'y', 'dim', 'animate'].includes(key))) return null;
  const common = {
    x: int(raw.x, 0, 100, 50),
    y: int(raw.y, 0, 100, 50),
    animate: raw.animate === false ? false : true,
  };
  if (raw.kind === 'preset') {
    if (!presetInfo(raw.preset) || 'image' in raw) return null;
    return { kind: 'preset', preset: raw.preset as PresetId, ...common, dim: int(raw.dim, DIM_MIN, DIM_MAX, DEFAULT_DIM_PRESET) };
  }
  if (raw.kind === 'image') {
    if (typeof raw.image !== 'string' || !IMAGE_ID.test(raw.image) || 'preset' in raw) return null;
    return { kind: 'image', image: raw.image, ...common, dim: int(raw.dim, DIM_MIN, DIM_MAX, DEFAULT_DIM_IMAGE) };
  }
  return null;
}

/** What is saved on the profile: exactly the fields of the right kind, nothing else. */
export function backgroundToStore(background: ProfileBackground | null | undefined): Record<string, unknown> | null {
  const clean = parseBackground(background);
  if (!clean) return null;
  const { kind, x, y, dim, animate } = clean;
  return kind === 'preset' ? { kind, preset: clean.preset, x, y, dim, animate } : { kind, image: clean.image, x, y, dim, animate };
}

/** Whether two settings are the same, for "unsaved changes" and for deciding whether a save changed the background. */
export const sameBackground = (a: ProfileBackground | null | undefined, b: ProfileBackground | null | undefined): boolean =>
  JSON.stringify(backgroundToStore(a)) === JSON.stringify(backgroundToStore(b));

/** The colour laid over the scene to darken it. */
export const dimColor = (dim: number): string => `rgba(7, 3, 14, ${(Math.min(DIM_MAX, Math.max(DIM_MIN, dim)) / 100).toFixed(2)})`;

/** A short description for the editor: "Aurora Galaxy (animated)", "Your image (still)", "Default". */
export function describeBackground(background: ProfileBackground | null | undefined): string {
  if (!background) return 'Default';
  if (background.kind === 'image') return 'Your image (still)';
  return `${presetInfo(background.preset)?.name ?? 'Galaxy'} (${background.animate ? 'animated' : 'still'})`;
}

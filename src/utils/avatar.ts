/**
 * Cute, minimal animal avatars.
 *
 * An avatar is stored as a short code, "animal.fur.bg" (e.g. "cat.1.3"), so it fits
 * on the public profile. Anyone without a saved avatar gets one derived from a seed
 * (their user ID or name), so the same person always shows the same animal.
 */

export const AVATAR_ANIMALS = ['cat', 'bunny', 'bear', 'panda', 'fox', 'dog', 'mouse', 'frog'] as const;
export type AvatarAnimal = (typeof AVATAR_ANIMALS)[number];

/** Soft fur colours per animal; the first is the "classic" look. */
export const AVATAR_FURS: Record<AvatarAnimal, string[]> = {
  cat: ['#f6d9c7', '#d9c2e8', '#f3b6c9', '#9c8aa3'],
  bunny: ['#fbeef3', '#e9d7f0', '#f6d9c7'],
  bear: ['#c99d7f', '#e3bf9b', '#bba6cc'],
  panda: ['#fbf5f8'],
  fox: ['#f2a477', '#f6c39e'],
  dog: ['#e8c9a3', '#f6e2cf', '#c9a27e'],
  mouse: ['#d8cfe0', '#efe6ef'],
  frog: ['#b9e2b1', '#d3eac3'],
};

/** Dark plum backgrounds that sit well on the app's surfaces. */
export const AVATAR_BACKGROUNDS = ['#3b2240', '#4a2a4f', '#2f2140', '#55304d', '#3d2a52', '#5b2e47'];

export interface AvatarSpec {
  animal: AvatarAnimal;
  fur: string;
  bg: string;
}

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function encode(animal: AvatarAnimal, furIndex: number, bgIndex: number): string {
  return `${animal}.${furIndex}.${bgIndex}`;
}

/** Turns a stored code into colours, or null if it isn't a valid code. */
export function parseAvatar(code: unknown): AvatarSpec | null {
  if (typeof code !== 'string') return null;
  const [animal, furRaw, bgRaw] = code.split('.');
  if (!(AVATAR_ANIMALS as readonly string[]).includes(animal)) return null;
  const furs = AVATAR_FURS[animal as AvatarAnimal];
  const fur = Number(furRaw);
  const bg = Number(bgRaw);
  if (!Number.isInteger(fur) || fur < 0 || fur >= furs.length) return null;
  if (!Number.isInteger(bg) || bg < 0 || bg >= AVATAR_BACKGROUNDS.length) return null;
  return { animal: animal as AvatarAnimal, fur: furs[fur], bg: AVATAR_BACKGROUNDS[bg] };
}

export function isValidAvatar(code: unknown): code is string {
  return parseAvatar(code) !== null;
}

/** The same seed always gives the same avatar code. */
export function avatarFromSeed(seed: string): string {
  const h = hashString(seed || 'queerspace');
  const animal = AVATAR_ANIMALS[h % AVATAR_ANIMALS.length];
  const fur = Math.floor(h / AVATAR_ANIMALS.length) % AVATAR_FURS[animal].length;
  const bg = Math.floor(h / 97) % AVATAR_BACKGROUNDS.length;
  return encode(animal, fur, bg);
}

/** A fresh random avatar, never the same as `current`. */
export function randomAvatar(current?: string, random: () => number = Math.random): string {
  for (let i = 0; i < 10; i++) {
    const animal = AVATAR_ANIMALS[Math.floor(random() * AVATAR_ANIMALS.length)];
    const code = encode(
      animal,
      Math.floor(random() * AVATAR_FURS[animal].length),
      Math.floor(random() * AVATAR_BACKGROUNDS.length)
    );
    if (code !== current) return code;
  }
  return avatarFromSeed(`${current}-next`);
}

/** Resolves what to draw: the saved code if valid, otherwise one derived from the seed. */
export function resolveAvatar(code: unknown, seed: string): AvatarSpec {
  return parseAvatar(code) ?? (parseAvatar(avatarFromSeed(seed)) as AvatarSpec);
}

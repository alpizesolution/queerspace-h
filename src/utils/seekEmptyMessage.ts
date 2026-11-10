/** The gentle line shown under "No one's around yet" in Seek. One of these is picked each time that screen appears. */
export const SEEK_EMPTY_MESSAGES = [
  'Your people are still finding their way here.',
  'Somewhere out there, your kind of person is looking too.',
  'The universe is still working its magic. ✨',
] as const;

/** Picks one at random. `random` is injectable so a test can choose; it must return a number in [0, 1). */
export function pickSeekEmptyMessage(random: () => number = Math.random): string {
  const index = Math.min(SEEK_EMPTY_MESSAGES.length - 1, Math.max(0, Math.floor(random() * SEEK_EMPTY_MESSAGES.length)));
  return SEEK_EMPTY_MESSAGES[index];
}

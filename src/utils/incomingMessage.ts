/**
 * True when the newest message is new since `previousLastId` and came from someone else.
 * Compares ids rather than list length, so it still works when the feed is capped (the Public Room
 * keeps only the latest 15) and the length stops growing. `previousLastId` is null until the first load,
 * so opening a conversation never chimes for existing messages.
 */
export function hasNewIncomingMessage(
  previousLastId: string | null,
  messages: ReadonlyArray<{ id: string; isSelf: boolean }>,
): boolean {
  const latest = messages[messages.length - 1];
  return previousLastId !== null && latest !== undefined && latest.id !== previousLastId && !latest.isSelf;
}

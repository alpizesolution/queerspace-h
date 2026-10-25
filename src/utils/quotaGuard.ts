/**
 * Spots Firestore's "quota used up" error (RESOURCE_EXHAUSTED on the free plan) wherever it
 * surfaces and tells the app once, so it can show the resting notice instead of silent failures.
 *
 * Services already log their Firestore failures with console.warn/error, and the SDK logs
 * listener errors the same way, so watching those (plus unhandled rejections) covers every
 * call site without threading a handler through each one.
 */

export const QUOTA_EVENT = 'qs:quota-exhausted';

export function isQuotaError(value: unknown): boolean {
  if (!value) return false;
  if (typeof value === 'string') return /resource[-_ ]exhausted|quota exceeded/i.test(value);
  if (typeof value === 'object') {
    const err = value as { code?: unknown; message?: unknown };
    if (err.code === 'resource-exhausted') return true;
    if (typeof err.message === 'string') return isQuotaError(err.message);
  }
  return false;
}

/** Next quota reset (midnight Pacific time), formatted as Philippine time, e.g. "3:00 PM PHT". */
export function nextResetLabel(now: Date = new Date()): string {
  // Find the next instant whose Los Angeles wall clock reads 00:00, checking each hour ahead.
  const laHour = (d: Date) =>
    Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' }).format(d));
  const start = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000 + 3_600_000);
  let reset = start;
  for (let i = 0; i < 26; i++) {
    const candidate = new Date(start.getTime() + i * 3_600_000);
    if (laHour(candidate) === 0) {
      reset = candidate;
      break;
    }
  }
  const time = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).format(reset);
  return `${time} PHT`;
}

let installed = false;
let announced = false;

function announce() {
  if (announced) return;
  announced = true;
  window.dispatchEvent(new Event(QUOTA_EVENT));
}

export function installQuotaWatch(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      if (args.some(isQuotaError)) announce();
      original(...args);
    };
  }
  window.addEventListener('unhandledrejection', (e) => {
    if (isQuotaError(e.reason)) announce();
  });
}

/** Age helpers for the self-reported birthday gate. Birth dates are stored privately. */
export const MINIMUM_MEMBER_AGE = 18;
export function calculateAge(birthDate: string, now: Date = new Date()): number | null {
  if (!isValidBirthDate(birthDate, now)) return null;
  const [year, month, day] = birthDate.split('-').map(Number);
  let age = now.getUTCFullYear() - year;
  if (now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day)) age--;
  return age;
}
export function isValidBirthDate(value: unknown, now: Date = new Date()): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day && date.getTime() <= now.getTime();
}
export function isAdultBirthDate(value: unknown, now: Date = new Date()): value is string {
  return typeof value === 'string' && isValidBirthDate(value, now) &&
    (calculateAge(value, now) ?? 0) >= MINIMUM_MEMBER_AGE;
}

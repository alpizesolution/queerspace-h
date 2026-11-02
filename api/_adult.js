// Adult check for features that must be limited to adults (18+). It reads the private account settings on the server,
// the same threshold firestore.rules uses (isAgeEligible), and returns only yes or no, so nothing about age is ever
// returned to a client. Underscore-prefixed files in api/ are not deployed as functions.
const EIGHTEEN_YEARS_IN_DAYS = 6575;

/** True when these private settings hold a birthday that makes the member an adult at `nowMs`. */
export function isAdultMember(settings, nowMs = Date.now()) {
  const birth = settings?.birthDate;
  const at = typeof birth?.toMillis === 'function' ? birth.toMillis() : null;
  return at !== null && at <= nowMs - EIGHTEEN_YEARS_IN_DAYS * 24 * 60 * 60 * 1000;
}

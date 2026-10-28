/** NCMH Crisis Hotline numbers (Philippines). Display text is exactly as supplied; `tel` is what a phone dials. */
export interface CrisisContact {
  /** Shown and copied exactly like this. */
  display: string;
  /** Digits for a tel: link (letters on a phone keypad are converted: U=8, S=7, A=2, P=7). */
  tel: string;
}

export const CRISIS_PRIMARY: CrisisContact = { display: '1553', tel: '1553' };

export const CRISIS_OTHER: readonly CrisisContact[] = [
  { display: '1800-1888-1553', tel: '180018881553' },
  { display: '0919-057-1553', tel: '09190571553' },
  { display: '0966-351-4518', tel: '09663514518' },
  { display: '0917-899-8727', tel: '09178998727' },
  { display: '0917-899-USAP', tel: '09178998727' },
];

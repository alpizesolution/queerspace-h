/**
 * The external online tests members can invite each other to (Signals, Tests). This is the ONE place the links live: change a
 * test's address here and nowhere else. The server keeps the ids, names and descriptions (api/_tests.js, a test checks they match);
 * a Test Invitation message carries only the id.
 *
 * QUEERSPACE only sends the invitation. It never embeds these sites, never sees answers, scores or results, and does not claim that
 * any of them diagnoses anything. The "Take Test" action is a plain link that opens the exact address in a new tab.
 */

export interface CatalogTest {
  id: string;
  name: string;
  description: string;
  /** The exact address that opens. Must be https. */
  url: string;
  /** A short emoji used as the test's icon. */
  icon: string;
}

export const TEST_CATALOG: readonly CatalogTest[] = [
  { id: 'bdsm-test', name: 'BDSM Test', description: 'Explore preferences and dynamics.', url: 'https://bdsmtest.org/', icon: '🖤' },
  { id: 'rice-purity-test', name: 'Rice Purity Test', description: 'A personal experience questionnaire.', url: 'https://ricepuritytest.com/', icon: '🍚' },
  { id: 'attachment-style-quiz', name: 'Attachment Style Quiz', description: 'Explore attachment patterns.', url: 'https://www.attachmentproject.com/attachment-style-quiz/', icon: '🔗' },
];

const BY_ID = new Map(TEST_CATALOG.map((test) => [test.id, test]));

export const testById = (id: unknown): CatalogTest | null => (typeof id === 'string' ? BY_ID.get(id) ?? null : null);

/** What a Test Invitation says as its text (previews, quotes). */
export const testInviteText = (test: Pick<CatalogTest, 'name'>): string => `Test invitation: ${test.name}`;

/** What a stored or received test invitation is worth: only an id in the catalog counts. */
export const parseTestInvite = (value: unknown): { id: string } | null => {
  const id = value && typeof value === 'object' ? (value as { id?: unknown }).id : undefined;
  const test = testById(id);
  return test ? { id: test.id } : null;
};

/** The shown wording that goes with every invitation and the Tests section: honest about what QUEERSPACE does and does not do. */
export const TEST_PRIVACY_NOTE = 'Opens an outside website. QUEERSPACE only sends the invitation: it never sees your answers or results, and these are not a diagnosis or a measure of compatibility.';

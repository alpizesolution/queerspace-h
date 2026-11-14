// The catalog of external online tests members can invite each other to (Signals, Tests section). A Test Invitation message carries
// only a test's id; the name and description are read from this list, so nobody can send an invitation with words or a link of their
// own. QUEERSPACE only sends the invitation: it never sees answers, scores or results.
//
// Keep the list in step with src/utils/testCatalog.ts (a test checks that the two are identical; that file also holds the links the
// app opens). Underscore-prefixed files in api/ are not deployed as separate functions.

export const TEST_CATALOG = [
  { id: 'bdsm-test', name: 'BDSM Test', description: 'Explore preferences and dynamics.' },
  { id: 'rice-purity-test', name: 'Rice Purity Test', description: 'A personal experience questionnaire.' },
  { id: 'attachment-style-quiz', name: 'Attachment Style Quiz', description: 'Explore attachment patterns.' },
];

const BY_ID = new Map(TEST_CATALOG.map(test => [test.id, test]));

export const isTestId = value => typeof value === 'string' && BY_ID.has(value);
export const testById = id => (isTestId(id) ? BY_ID.get(id) : null);

/** The one line a Test Invitation uses as its text, in previews and quotes. */
export const testInviteText = test => `Test invitation: ${test.name}`;

/** Reads a stored message's test back: only the id is trusted, the rest comes from this list. */
export function shapeStoredTest(stored) {
  const test = testById(stored?.id);
  return test ? { id: test.id } : null;
}

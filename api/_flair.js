// The "Looking for" flairs and the display title built from a post's structured fields. The same list is repeated in
// firestore.rules (lookingForFlairs) and src/utils/lookingFor.ts; a test keeps all three identical.
// Underscore-prefixed files in api/ are not deployed as separate functions.
export const LOOKING_FOR_FLAIRS = [
  'Masc × Femme', 'Masc × Masc', 'Masc × Any',
  'Femme × Masc', 'Femme × Femme', 'Femme × Any',
  'Andro × Masc', 'Andro × Femme', 'Andro × Any',
  'Trans Femme × Masc', 'Trans Femme × Femme', 'Trans Femme × Any',
  'All WLW',
];

/** "18 [Masc × Femme] Looking for kasama mag-coffee". Posts made before flairs existed show only their title. */
export function displayTitle(post) {
  const title = typeof post?.title === 'string' ? post.title.trim() : '';
  const flair = LOOKING_FOR_FLAIRS.includes(post?.flair) ? post.flair : null;
  return Number.isInteger(post?.age) && flair ? `${post.age} [${flair}] ${title}` : title;
}

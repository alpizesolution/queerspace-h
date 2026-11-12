# Profile backgrounds (animated cosmic profile)

A full-page background behind a member's whole profile: one of eight original animated galaxies, or the member's own still image.

## What is stored
Only a small map on `users/{uid}/public/profile`:

```
background: { kind: 'preset' | 'image', preset?: <id>, image?: <16 hex id>, x: 0-100, y: 0-100, dim: 0-80, animate: boolean }
```

No media is ever stored in Firestore. No background field = the default look, so every existing profile is unchanged.
`firestore.rules` validates the shape; the server (`api/_background.js`, `shapeBackground`) and the app (`parseBackground`) re-validate on read, and anything invalid is the default look.

## Presets (no downloads)
`nebula-dreams`, `midnight-universe`, `stardust-bloom`, `aurora-galaxy`, `celestial-ocean`, `solar-eclipse`, `cosmic-dust`, `moonlight`.
They are original CSS layers (`src/cosmos.css`, generated star/dust tiles in `src/cosmos-tiles.css` from `scripts/gen-cosmos-tiles.mjs`), each with its own layers and motion. Only `transform` and `opacity` are animated, loops are seamless, the slowest/fastest cycles are seconds to minutes (nothing flashes), and only the chosen scene is ever put on the page.
No video is used: there is no licensed footage in the project and no video tooling. A WebM + WebP version of a scene could be added later behind the same `CosmicBackground` component without changing the data model.

Motion stops for: the member's own animation switch (`data-animate=false`), `prefers-reduced-motion`, and a hidden tab (`data-paused`).

## Own image
JPEG, PNG or WebP only, never animated. The app shrinks it (about 1600 px) and sends it to `POST /api/signals {action:'bg-image-set'}`; the server inspects the real bytes, strips metadata and stores it in the existing private R2 bucket under `bg/{uid}/{id}`. It is not visible to anyone until the member saves their profile with that id. Viewers load it through `GET /api/signals?view=background-image&memberId=…` (permission-checked, uniform 404, `no-store`). After a save, `bg-image-prune` deletes every uploaded picture except the one on the profile.

## Files
App: `src/utils/profileBackground.ts`, `src/components/CosmicBackground.tsx`, `src/components/BackgroundStudio.tsx`, `src/components/ProfilePage.tsx`, `src/components/ProfileEditorSheet.tsx`, `src/services/profileBackgroundService.ts`, `src/hooks/useBackgroundImage.ts`.
Server: `api/_background.js`, `api/signals.js`, `api/_profiles.js`, `firestore.rules`.
Tests: `src/utils/profileBackground.test.ts`, `src/components/ProfileBackground.test.tsx`, `test/api/profile-background.integration.test.js` (emulator), `test/firestore-rules.test.ts` (BG-01 to BG-06, emulator).

## Deploying
`firestore.rules` must be republished before members can save a background. Keep the preset list in the rules, `api/_background.js` and `src/utils/profileBackground.ts` in step (a test checks it).

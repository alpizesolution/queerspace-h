# ATLAS: a shared map of memories

> Every place has a story. Every story leaves a mark.

Members pin a memory (title, a few words, a date, an optional photo) to a place. Each memory is a glowing star on a real
interactive map (Leaflet + OpenStreetMap data). It opens into a card, and members can browse community memories or manage their own.

The page is **map-first**: a compact heading (name and tagline together), then the map, which fills all the remaining space on phones
and desktops. There is no search box, filter or list above it; members explore by panning, zooming and tapping stars. The
Community / My memories switch sits on the map itself. **Recent Memories** is a thin strip that is collapsed by default; opened, it
shows the newest (at most three) community memories from the last 24 hours as a shortcut that flies the map to one and opens it. It is
only a preview: every memory stays on the map, and it creates, hides or limits nothing.

ATLAS is the first featured card on Home and the sixth item of the bottom navigation (Home, Seek, Galaxy, Echoes, Cosmos, Atlas; it
replaced Signals there, and Signals is opened from the Inbox icon in the header). It lives at `/atlas` and is loaded lazily, so the map
library is only downloaded when someone opens it.

## How it works

- **One server function:** `api/atlas.js` (rules in `api/_atlas.js`). It is the 10th and last function the Vercel Hobby plan allows, so any
  future endpoint needs to be folded into an existing function (`test/api/function-limit.test.js` enforces the limit).
- **Clients never read or write memories directly.** `atlasMemories` has no client rule in `firestore.rules` (all access denied, tested), so
  every read and write goes through the server, which decides who may see what.
- **Actions** (`POST /api/atlas`): `list` (`scope: 'mine' | 'community' | 'recent'`, optional map `bounds` except for `recent`), `create`, `update`, `delete`,
  `view` and `react` (see "The memory card, views and reactions").
  `GET /api/atlas?view=photo&id=…` returns a photo to someone who may see the memory.

### Data (`atlasMemories/{id}`)

| field | notes |
|---|---|
| `ownerId` | the author. Never returned to other members. |
| `title` (≤ 80), `text` (≤ 1000), `placeLabel` (≤ 80) | trimmed; memories are held to the community word rules. The app no longer asks for a place name: the location is the pin chosen on the map, so `placeLabel` is `''` for new memories (older ones keep theirs, and an edit leaves it alone). The server still validates one if sent. |
| `date` | `YYYY-MM-DD`, a real day, not in the future |
| `lat`, `lng` | **already rounded to a 0.01° (~1 km) grid** |
| `visibility` | always `public` for a new memory (set by the server, never by the app). `private` and `friends` exist only on records saved by an earlier version, which keep their narrower audience. |
| `displayIdentity` | how the author appears: `{ mode: 'profile' }` or `{ mode: 'anonymous' }` (see below). A record from an earlier version (no field, the old `anonymous` flag, an old alias or a typed name) reads as the profile when nothing was recorded, and as anonymous for everything else, so a stored value can never reveal more than the author chose. |
| `anonymousAlias` | only on an anonymous memory: the random cosmic name the server picked for it (one of the 16 in `COSMIC_NAMES`). Never sent by the app, and not tied to the member. |
| `photo` | `{ type, width, height }` when there is one; the bytes are in private R2 at `atlas/{id}` |
| `createdAt`, `updatedAt` | server timestamps |
| `viewCount`, `hugCount`, `heartCount` | totals only (whole numbers, never negative; missing on older records, read as 0). Changed by the server alone, in a transaction with the record that causes the change. |
| `views/{uid}`, `reactions/{uid}` (subcollections) | who has viewed (`{ at }`) and each member's one reaction (`{ kind: 'hug' \| 'heart', at }`). The document id IS the member, so a second one cannot exist. Server-only (no client rule, tested); removed with the memory. Never returned to anyone. |

## The memory card, views and reactions

- **Layout (compact, `AtlasMemoryPanel.tsx`):** the photo (if any), then the date (short form, `Jun 1, 2024`) directly under the words. There is no close button: a tap or click outside the card (or Escape) dismisses it; presses inside it, drags that pan the map, stars, the Recent strip and dialogs do not. The map is its own stacking context, so no map label, marker, control or credit can sit over the card. Stars are small pink-to-purple stars with a slow gradient drift (no ring or halo). Then
  the title and the words, which are the focus. The place name is shown only if the author gave one (the app no longer asks for one, so most cards
  have no location line); nothing says "approximate", and the exact spot is never known (the stored point is already rounded to ~1 km). There is no
  "Shared" label (every new memory is public; an older connections-only record shows a tiny people icon beside its author). No divider lines.
  One slim row at the bottom: **who wrote it** on the left (a small 20 px avatar and name for a profile memory; a small 10 px star beside the cosmic
  name for an anonymous one, which stays visible, never a link) and **views and reactions** on the right. The author's own card adds
  "Shown as ..." in that row (an anonymous memory says its cosmic name; hover shows "Your account stays private"), an audience line only for an older
  narrower record, and Edit and Delete. On a phone the round "New memory" button is hidden while a card is open, because it sat over the
  reaction buttons and Delete.
- **Views:** opening a card sends `view`. The server counts a member's FIRST open as one view (the `views/{uid}` record), so reopening, a second device
  or a loop changes nothing; the author's own opens are not counted. The response is the totals plus that member's own reaction. The card shows an
  eye and a compact count (`1.2k`).
- **Reactions:** a member has ONE reaction at most, a hug (🤗) or a heart (❤️). `react` takes `kind: 'hug' | 'heart' | null` (null takes it back): the
  same kind twice changes nothing, the other kind switches, and the reaction record and the totals change together in one transaction, so a burst of
  taps from one member can never leave two reactions or a wrong total (tested with concurrent requests). The card updates at once and is confirmed or
  put back by the server ("Not saved"); a second tap while one is saving is ignored. The author sees the totals but gets no buttons: **you cannot react
  to your own memory** (`403 own_memory`). Reactions are new: nothing existed for memories before, and Echoes reactions, chat reactions and the Cosmos
  "stardust" are separate and untouched.
- **Who may do it:** exactly the members who may see the memory (the same check as the photo and the list). Everyone else gets the same `404 not_found`,
  including a member who blocked the author, an older private or connections-only record, and a memory that does not exist. Adults only, like all of ATLAS.
  `view` and `react` share one limit of 120 a minute per member.
- **Privacy:** the list and the card carry totals only. Nobody is told who viewed or reacted (no id, name or avatar in any response; tested), and the
  owner id is still never sent. Deleting a memory deletes its view and reaction records. Deleting a member's account does not yet remove their
  reactions from other people's memories (see Known gaps).

## Privacy and safety

- **Location:** the app sends a point; the server rounds it before anything is stored. The exact point is never saved, returned or logged
  (a test checks that no stored or returned value contains it). Nobody's live location is read: the app never asks for geolocation.
- **Every memory is public to members, enforced on the server:** `create` stores `visibility: 'public'` itself, and a request that asks for
  anything else (`private`, `friends`, any other value) is refused with `invalid_visibility`, on create and on edit, so nothing is ever
  quietly published that the sender thought was private. An edit has no way to change who can see a memory. Any adult member can see it,
  and a block in either direction, or a suspended author, hides it. Records saved by an earlier version as `private` or `friends` keep
  their old, narrower audience (read rules unchanged); nothing widens them.
- **Not found, not forbidden:** editing, deleting or fetching the photo of someone else's memory answers exactly like a memory that does not
  exist, so a private memory's existence is never confirmed.
- **Author identity (chosen per memory, enforced on the server):** exactly two choices, and the app never sends a name.
  - *Use my pseudonym* (the default): the member's own QUEERSPACE display name, read from their profile when the memory is shown, with
    the avatar and pronouns their profile shares and a link to their profile (the profile page applies its own visibility rules).
  - *Anonymous*: the memory is shown under a **random cosmic name** (Stardust, Star, Little Comet, Moonbeam, Nebula, Shooting Star, Supernova,
    Cosmic Dust, Galaxy, Aurora, Meteor, Luna, Celestial, Polaris, Eclipse or Nova). The server picks it when the memory is published and stores
    it on that memory (`anonymousAlias`); it is never read from a request and never tied to the member, so each of a member's anonymous
    memories gets its own name (a different one while the list allows, so nothing links them). Other members receive only that name: no
    `author` object, no id, no profile fields, no link. The response, the star's card and the details all carry the same name.
  - Editing an anonymous memory keeps its name. Switching a pseudonym memory to Anonymous picks a new one; switching back to the pseudonym
    shows the real name again and drops the cosmic name (choosing Anonymous later picks another). A record saved before names were stored
    gets a stable one worked out from its own id, so every screen agrees.
  - The real account id always stays in `ownerId` (private) for ownership, edits, deletion, reporting and moderation. Anonymous changes only
    what other members are shown. An author's own list also returns their saved choice so an edit can start from it.
  - Because no name is ever accepted from the request (`displayIdentity` must be exactly `{ mode }`), nobody can write another member's
    name or the team's.
- **Moderation:** an administrator (a Google sign-in with an `admins/{uid}` document) can delete any memory and its photo through the same
  `delete` action. Each such removal is recorded in `atlasModerationLog` (server-only) with the real owner id and the admin's id.
- **Photos:** JPEG, PNG or WebP only (checked from the real bytes, not the label), shrunk on the device, camera details removed on the server,
  stored privately, delivered only through the permission-checked request. No public URL exists.
- **Adults only, like the rest of the community:** a member needs a saved birthday that makes them 18+, and a suspended account cannot use it.
- Rate limits: 20 new memories an hour, 240 photo views a minute.

## Map tiles (configuration, no secrets)

Set these in Vercel (Settings → Environment Variables). They are build-time and visible in the browser, so use only domain-restricted
**public** keys, never a private key.

| variable | purpose |
|---|---|
| `VITE_ATLAS_TILE_URL` | **Required for production.** An OSM-based tile provider's URL template with `{z}/{x}/{y}` (https). |
| `VITE_ATLAS_TILE_ATTRIBUTION` | Extra credit the provider requires (OpenStreetMap's credit is always shown). |
| `VITE_ATLAS_TILE_TONE` | `dark` if the tiles are already dark; otherwise they are darkened in CSS to fit the app. |
| `VITE_ATLAS_LABELS_URL` | Optional second template for a labels-only layer drawn above the base tiles and brightened in the app (`.atlas-labels` in `index.css`), so street and town names are easy to read on a dark map. |

- **Recommended dark setup (CARTO, chosen after comparing Dark Matter, Voyager and Positron):** the base without labels and the labels on their own
  layer, both with `{r}` so phones get sharp `@2x` tiles (same number of requests):
  - `VITE_ATLAS_TILE_URL=https://basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}{r}.png?key=<key>`
  - `VITE_ATLAS_LABELS_URL=https://basemaps.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}{r}.png?key=<key>`
  - `VITE_ATLAS_TILE_TONE=dark`, and `VITE_ATLAS_TILE_ATTRIBUTION=&copy; CARTO` (the OpenStreetMap credit is always added by the app).
  - Why: the plain Dark Matter style draws its labels in dim grey, which is hard to read. Roads and buildings stay exactly as CARTO draws
    them (no CSS filter on the base); only the label layer is brightened. **Cost:** two tile requests per tile instead of one, so the
    free CARTO allowance (about 1 million tile requests a month) covers about half as many map views.
  - A transparent layer shows the previous zoom level's labels, scaled up, until the new tiles arrive (normal Leaflet behaviour); on a slow
    connection that can look like a brief blurry double image after zooming.
- **Sea labels (only with CARTO's `dark_only_labels` tiles; `src/utils/atlasSeaLabel.ts`).** CARTO draws OpenStreetMap's sea names as pixels in the
  label tiles, so they cannot be switched off by a setting. What was measured on the real tiles (zoom 2-18):

  | Label | Where | Size (1x) | Notes |
  |---|---|---|---|
  | "South China Sea" stamp (南海 Biển Đông / South China Sea) | 15.0°N 115.0°E, zoom 5-18 | 72 x 56 px | Never clipped; nothing else within 64 px of it |
  | CARTO's "West Philippine Sea" | 119.0°E 16.0°N, zoom 7-18 | 72 x 40 px | Absent at zoom 5-6. **Clipped by a tile edge at zoom 12 (47 px wide) and 13 (58 px wide)** |

  - **The stamp is erased** (an 80 x 64 px window around its anchor) at zoom 5 and up. `MaskedTileLayer` draws only the tiles that touch the window to a
    canvas and clears the window, so the hole is transparent and nothing has to match the map colour underneath. Every other tile is the ordinary image.
    Measured against CARTO's unmodified tiles, the only pixels that change are inside that window.
  - **CARTO's own West Philippine Sea label is kept** wherever it is whole (zoom 7-11 and 14-18), pixel for pixel. Where it is missing (zoom 5-6) or
    clipped (zoom 12-13, erased first so there is never a second copy) the map shows **our own label**: real text in its own pane (above the
    tiles, below the circles and stars, never interactive), at the same point CARTO anchors its own, sized and coloured to match (about 70 x 38 px).
  - **Hand-over without duplicates or flashes:** Leaflet keeps the previous zoom's tiles on screen until the new ones have loaded, so the label is
    switched when the *new tiles have loaded* (`createSeaLabelGate`), not when the zoom ends: zooming in to a level where CARTO draws the label, ours
    leaves as CARTO's tiles arrive; zooming out to a level where it is missing, ours appears only after the old tiles are gone (250 ms). Rapid zooms
    cancel earlier plans, and a dead tile server never leaves it in the wrong state (1.5 s limit). Measured: at most a 440 ms crossfade overlap and a
    400 ms moment with neither label.
  - **Cross-origin and fallbacks:** tile images are loaded without CORS and only *drawn* (nothing is read back, so a "tainted" canvas is fine and the
    CSP needs nothing beyond the existing `img-src` for the tile host). `@2x` tiles work: the window is scaled to the image's real size. No canvas
    support: plain tiles (CARTO's stamp stays) and our label is shown at zoom 5-6 only, never over CARTO's clipped label. A tile that fails to load
    raises the usual `tileerror`. Masked tiles get the same `mix-blend-mode` as image tiles (`index.css`), or their text would look different.
  - **Limits:** the windows are CARTO-specific and measured, not derived: if CARTO re-renders its labels they may need re-measuring (the geometry and
    the zoom rules are unit-tested; the real tiles are checked in a browser run). Not covered: the OpenStreetMap-only development fallback (its
    labels are baked into the base tiles), zoom 4 and below (CARTO shows no sea label there; the map does not add one), and no other sea name is
    added or changed. Our font is the app's, matched in size and colour, not CARTO's Montserrat. `MaskedTileLayer` calls Leaflet's `_pruneTiles` after
    loading, because Leaflet otherwise leaves the old zoom's tiles under masked tiles (two sets of labels) when all tiles finish together.
- Without `VITE_ATLAS_TILE_URL`, a **production** build shows "The map isn't available right now" instead of quietly using
  `tile.openstreetmap.org`, which is not a production tile service. Local development falls back to it.
  Move to a provider with proper terms before heavy use.

## Release checklist

1. **Vercel environment variables** (Settings → Environment Variables, Production):
   - `VITE_ATLAS_TILE_URL` (**required**, build-time): an OSM-based tile provider's https template with `{z}/{x}/{y}`, using a
     key in the URL. Without it production shows "map isn't available". The chosen provider is **CARTO Dark Matter**:
     `https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=<your CARTO basemaps key>` with `VITE_ATLAS_TILE_TONE=dark`.
     The key is visible in the browser's tile requests (that is normal for tile keys); keep it out of git and logs. The production
     Content-Security-Policy (`img-src` in `vercel.json`) already allows `basemaps.cartocdn.com`; any other provider needs its host added there,
     or the browser blocks every tile.
   - `VITE_ATLAS_TILE_ATTRIBUTION` (CARTO asks for `&copy; CARTO`; the OpenStreetMap credit is always shown on top of it) and `VITE_ATLAS_TILE_TONE` (`dark` for dark tiles).
   - Server-side, for memory photos (the same bucket Signals photos use): `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`,
     `R2_SECRET_ACCESS_KEY`. Without them a memory can be saved only without a picture (the app says so).
   - Nothing else is new. The existing Firebase variables, `FIREBASE_SERVICE_ACCOUNT_JSON` and the Vercel function count (10 of 10) are unchanged.
2. **Firebase, before the app** (`npm run deploy:firebase -- --project <id>`, then `npm run check:firebase -- --project <id>`):
   - Rules: deny all client access to `atlasMemories` and `atlasModerationLog`; and `users/{uid}/private/settings` updates may stamp a missing
     `createdAt` once (older records), never change one.
   - Three composite indexes on `atlasMemories`: `(ownerId, createdAt desc)`, `(visibility, lat)`, `(visibility, createdAt desc)`. Wait until
     they report "Enabled"; until then listing returns errors.
3. **Cloudflare R2**: keep the bucket **private** (no public access, no public domain, no CORS needed). Photos are stored as `atlas/{memoryId}`
   and served only through `/api/atlas?view=photo`, which applies the same permission checks as the memory. Give the access key
   object read, write and delete on that bucket (deleting a memory or an admin removal deletes its photo).
4. Then deploy the app. Smoke test: open `/atlas`, pin a memory (tap the map), open it as another member, and try Anonymous.

## Known gaps (not in this change)

- No member reporting flow or admin screen for memories yet: administrators can remove a memory through the API (logged), and shared
  memories get the word filter, but there is no in-app report button or moderation list.
- Deleting a member's account does not yet remove their memories; orphaned photos have no scheduled sweep.
- Views are per member, not per visit, and a deleted account's views and reactions stay in the totals of other people's memories (and the record that names it).
- Dependencies were added with npm (`--no-package-lock`); `bun.lock` needs refreshing with `bun install`.

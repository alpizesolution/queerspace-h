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
- **Actions** (`POST /api/atlas`): `list` (`scope: 'mine' | 'community' | 'recent'`, optional map `bounds` except for `recent`), `create`, `update`, `delete`.
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
- Dependencies were added with npm (`--no-package-lock`); `bun.lock` needs refreshing with `bun install`.

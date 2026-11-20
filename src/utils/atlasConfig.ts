/**
 * Where ATLAS gets its map tiles. Nothing here is a secret and nothing is hardcoded for production:
 *
 *  - VITE_ATLAS_TILE_URL: an OpenStreetMap-based tile provider's URL template, with {z}, {x}, {y} (and optionally {s}, {r}). Pick a
 *    provider whose terms allow your traffic (for example a hosted OSM tile service with a domain-restricted public key in the URL,
 *    or your own tile server). The public tile.openstreetmap.org servers are NOT a production tile service, so they are only used
 *    while developing locally; a production build without this setting shows "map unavailable" instead of quietly using them.
 *  - VITE_ATLAS_TILE_ATTRIBUTION: extra credit the provider requires, shown next to the OpenStreetMap credit (which is always shown).
 *  - VITE_ATLAS_TILE_TONE: "dark" if the tiles are already a dark style; anything else (the default) darkens them to fit the app.
 *  - VITE_ATLAS_LABELS_URL (optional): a second template for a transparent LABELS-ONLY layer drawn above the base tiles. A dark style's own
 *    labels are dim; serving the base without labels and the labels separately lets the labels be brightened (see .atlas-labels in
 *    index.css) without touching roads or buildings. With CARTO: base `dark_nolabels`, labels `dark_only_labels`. Add `{r}` to both templates
 *    for sharp text on high-density phone screens (Leaflet fills it with "@2x" there; the number of requests does not change).
 */
export interface TileConfig {
  url: string;
  attribution: string;
  maxZoom: number;
  tone: 'dark' | 'light';
  /** A labels-only layer drawn over the base tiles, or null when the base style carries its own labels. */
  labelsUrl: string | null;
}

type Env = Record<string, string | undefined>;

export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';
const DEV_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** A usable template: https, with the three tile placeholders. */
export function isTileTemplate(value: string | undefined): value is string {
  return typeof value === 'string' && /^https:\/\//.test(value) && ['{z}', '{x}', '{y}'].every((part) => value.includes(part));
}

/** The tile settings for this build, or null when there is no provider configured for production. */
export function resolveTileConfig(env: Env, dev: boolean): TileConfig | null {
  const configured = env.VITE_ATLAS_TILE_URL?.trim();
  const url = isTileTemplate(configured) ? configured : dev ? DEV_TILE_URL : null;
  if (!url) return null;
  const extra = env.VITE_ATLAS_TILE_ATTRIBUTION?.trim();
  return {
    url,
    attribution: extra ? `${OSM_ATTRIBUTION} · ${extra}` : OSM_ATTRIBUTION,
    maxZoom: 18,
    tone: env.VITE_ATLAS_TILE_TONE === 'dark' ? 'dark' : 'light',
    labelsUrl: isTileTemplate(env.VITE_ATLAS_LABELS_URL?.trim()) ? env.VITE_ATLAS_LABELS_URL!.trim() : null,
  };
}

const runtimeEnv = (): Env => ((import.meta as unknown as { env?: Env }).env ?? {});
const isDev = (): boolean => Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);

export const tileConfig = (): TileConfig | null => resolveTileConfig(runtimeEnv(), isDev());

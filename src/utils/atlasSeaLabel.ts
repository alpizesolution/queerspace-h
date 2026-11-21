/**
 * Sea labels on the ATLAS map (CARTO `dark_only_labels` tiles). Pure geometry and rules only; the Leaflet parts live in
 * maskedTileLayer.ts and atlasSeaLabelLayer.ts.
 *
 * Why: CARTO draws OpenStreetMap's sea names as pixels in a transparent PNG. Measured on the real tiles:
 *  - A "South China Sea" stamp (南海 Biển Đông / South China Sea, 72x56px) sits at 15.0N 115.0E from zoom 5 up. It is never clipped.
 *  - CARTO's own "West Philippine Sea" label (72x40px) sits at 119.0E 16.0N from zoom 7 to 16 and is absent at zoom 5-6. At zoom 12
 *    and 13 a tile edge cuts it (47px and 58px wide instead of 72), because CARTO draws the text only in the tile that owns its anchor.
 * So: the stamp is erased, CARTO's label is kept wherever it is whole (zoom 7-11 and 14-16), and our own label stands in where CARTO's is
 * missing (zoom 5-6) or clipped (zoom 12-13, where CARTO's label is erased first so there is never a second copy).
 * The rectangles below were measured on those tiles with a few pixels to spare; the label sprites are a fixed pixel size at every zoom.
 */

export const TILE_SIZE = 256;

export interface MaskWindow {
  /** What is erased. */
  id: 'scs-stamp' | 'wps-clipped';
  lat: number;
  lng: number;
  /** Pixels (at 1x) around the anchor point that are cleared. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Inclusive zoom range in which the tiles carry this label. */
  minZoom: number;
  maxZoom: number;
}

/** The unwanted "South China Sea" stamp: measured x -36..+36, y -30..+26 from its anchor. Nothing else is within 64px of it. */
export const SCS_STAMP: MaskWindow = { id: 'scs-stamp', lat: 15.0, lng: 115.0, left: 40, right: 40, top: 34, bottom: 30, minZoom: 5, maxZoom: 18 };

/** CARTO's own West Philippine Sea label, erased only where a tile edge clips it: measured x -36..+36, y -21..+19 from its anchor. */
export const WPS_CLIPPED: MaskWindow = { id: 'wps-clipped', lat: 16.0, lng: 119.0, left: 40, right: 40, top: 25, bottom: 23, minZoom: 12, maxZoom: 13 };

/** Where our own West Philippine Sea label is drawn: the same point CARTO's label is anchored at, so it does not jump between zoom 6 and 7. */
export const WPS_LABEL_ANCHOR = { lat: 16.0, lng: 119.0 } as const;

/** Zoom levels with no (zoom 5-6) or a clipped (zoom 12-13) CARTO West Philippine Sea label. */
export const WPS_CUSTOM_ZOOMS = [5, 6, 12, 13] as const;
const WPS_CLIPPED_ZOOMS = [12, 13];

/** True only for the CARTO dark labels-only template: every measurement above belongs to those tiles. */
export function isCartoDarkLabels(url: string | null | undefined): boolean {
  return typeof url === 'string' && /^https:\/\/([a-z0-9-]+\.)?basemaps\.cartocdn\.com\/rastertiles\/dark_only_labels\//i.test(url);
}

/** The rectangles to erase from tiles of this zoom. */
export function maskWindowsForZoom(zoom: number): MaskWindow[] {
  return [SCS_STAMP, WPS_CLIPPED].filter((w) => zoom >= w.minZoom && zoom <= w.maxZoom);
}

/** Whether our own label should be on screen at this map zoom. `replaceClipped` is false when tiles cannot be masked (no canvas): then
 *  CARTO's clipped label stays, so ours must not be drawn on top of it. */
export function customWpsVisible(zoom: number, replaceClipped = true): boolean {
  const z = Math.round(zoom);
  if (z === 5 || z === 6) return true;
  return replaceClipped && WPS_CLIPPED_ZOOMS.includes(z);
}

/** Web-Mercator world pixel of a point at a zoom (the same maths as Leaflet's EPSG:3857 with 256px tiles). */
export function worldPixel(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** zoom;
  const sin = Math.sin((Math.max(Math.min(lat, 85.0511287798), -85.0511287798) * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
}

export interface TileRect { x: number; y: number; w: number; h: number }

/**
 * The parts of one tile to erase, in the tile's own CSS pixels (0..256). Windows are laid out in world pixels, so a label that straddles
 * two tiles is cut correctly in each. `coords.x` may lie outside 0..2^z (Leaflet's repeated world copies); the window moves with it.
 */
export function tileMaskRects(coords: { x: number; y: number; z: number }, windows: MaskWindow[] = maskWindowsForZoom(coords.z)): TileRect[] {
  const tiles = 2 ** coords.z;
  const copy = Math.floor(coords.x / tiles);
  const tx = coords.x * TILE_SIZE;
  const ty = coords.y * TILE_SIZE;
  const out: TileRect[] = [];
  for (const w of windows) {
    const p = worldPixel(w.lat, w.lng, coords.z);
    const ax = p.x + copy * TILE_SIZE * tiles - tx;
    const ay = p.y - ty;
    const x0 = Math.max(0, Math.floor(ax - w.left));
    const x1 = Math.min(TILE_SIZE, Math.ceil(ax + w.right));
    const y0 = Math.max(0, Math.floor(ay - w.top));
    const y1 = Math.min(TILE_SIZE, Math.ceil(ay + w.bottom));
    if (x1 > x0 && y1 > y0) out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  return out;
}

export interface SeaLabelGateEnv {
  /** Should our label be showing at this zoom? */
  wanted: (zoom: number) => boolean;
  show: () => void;
  hide: () => void;
  /** Is the tile layer still loading tiles? */
  isLoading: () => boolean;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** After tiles arrive, how long to wait before SHOWING ours, so the previous zoom's tiles (and CARTO's own label on them) are gone first. */
  settleMs?: number;
  /** Never wait longer than this for tiles (a dead tile server must not leave the label in the wrong state). */
  maxWaitMs?: number;
}

/**
 * Decides when our label is shown or hidden around a zoom change so the two labels never overlap and the label never flickers.
 * Leaflet keeps the previous zoom's tiles (scaled) on screen until the new ones have loaded, so the change is made when the new tiles
 * have loaded, not when the zoom ends: zooming in to a level CARTO draws the label at (6 to 7), ours leaves as CARTO's tiles arrive;
 * zooming out to a level where it is missing (7 to 6), ours appears only after the old tiles are gone. Rapid zooms cancel earlier plans.
 */
export function createSeaLabelGate(env: SeaLabelGateEnv) {
  const settleMs = env.settleMs ?? 250;
  const maxWaitMs = env.maxWaitMs ?? 1500;
  let visible = false;
  let pending: { want: boolean; timer: unknown; waitingForTiles: boolean } | null = null;
  const clear = () => { if (pending) { env.clearTimer(pending.timer); pending = null; } };
  const apply = (want: boolean) => {
    clear();
    if (want === visible) return;
    visible = want;
    if (want) env.show(); else env.hide();
  };
  const finish = (want: boolean) => {
    clear();
    if (want === visible) return;
    if (want && settleMs > 0) pending = { want, timer: env.setTimer(() => apply(true), settleMs), waitingForTiles: false };
    else apply(want);
  };
  return {
    /** The map's first zoom: no tiles are being replaced, so no waiting. */
    init(zoom: number) { apply(env.wanted(zoom)); },
    /** The map finished a zoom change. */
    zoomed(zoom: number) {
      const want = env.wanted(zoom);
      if (want === visible) { clear(); return; }
      clear();
      if (!env.isLoading()) finish(want);
      else pending = { want, timer: env.setTimer(() => finish(want), maxWaitMs), waitingForTiles: true };
    },
    /** The tile layer finished loading. */
    loaded() { if (pending?.waitingForTiles) finish(pending.want); },
    isVisible: () => visible,
    dispose() { clear(); },
  };
}

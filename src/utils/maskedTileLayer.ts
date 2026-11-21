import L from 'leaflet';
import { tileMaskRects } from './atlasSeaLabel.ts';

/** Can this browser draw to a canvas? Without it the labels layer is a plain tile layer and nothing is erased. */
export function canvasSupported(): boolean {
  try {
    return typeof document !== 'undefined' && Boolean(document.createElement('canvas').getContext?.('2d'));
  } catch {
    return false;
  }
}

/**
 * A tile layer for the transparent labels-only tiles that erases a few known rectangles (see atlasSeaLabel.ts).
 *
 * Only the tiles that touch a rectangle are drawn to a canvas (a handful at any zoom); every other tile is the ordinary image, so
 * there is no extra work for the rest of the map. The rectangle is cleared after the image is drawn, which leaves a transparent hole:
 * nothing has to match the colour of the map underneath.
 *
 * Cross-origin: the tile image is loaded without CORS and only DRAWN. Nothing is ever read back (no getImageData / toDataURL), so a
 * canvas "tainted" by a cross-origin image still displays normally and the production CSP needs nothing beyond the `img-src` that
 * already allows the tile host. `{r}` (@2x) tiles are twice as many pixels: the rectangles are scaled to the image's real size.
 *
 * Failure is graceful: no canvas support gives the ordinary image; a tile that fails to load reports the usual `tileerror` (so the
 * tile-health check still counts it); a failure while erasing leaves the tile as CARTO drew it.
 */
export class MaskedTileLayer extends L.TileLayer {
  constructor(urlTemplate: string, options?: L.TileLayerOptions) {
    super(urlTemplate, options);
    // Leaflet removes the previous zoom's tiles (kept under the new ones while those load) from inside its fade-in loop, and only if tiles
    // finish at different times. When they don't, the old zoom stays on screen and a transparent labels layer shows two sets of labels.
    // Pruning once loading is done (after the 200ms fade) is what Leaflet itself does when fading is off.
    this.on('load', () => {
      window.setTimeout(() => {
        const layer = this as unknown as { _map?: unknown; _pruneTiles?: () => void };
        if (layer._map) layer._pruneTiles?.();
      }, 350);
    });
  }

  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const rects = tileMaskRects(coords);
    if (rects.length === 0) return super.createTile(coords, done);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return super.createTile(coords, done);
    const tileSize = this.getTileSize().x || 256;
    const image = new Image();
    image.alt = '';
    image.onload = () => {
      try {
        const width = image.naturalWidth || tileSize;
        const height = image.naturalHeight || tileSize;
        canvas.width = width;
        canvas.height = height;
        context.drawImage(image, 0, 0);
        const scale = width / tileSize;
        for (const rect of rects) context.clearRect(rect.x * scale, rect.y * scale, rect.w * scale, rect.h * scale);
      } catch {
        // an unmasked tile is still a correct tile
      }
      done(undefined, canvas);
    };
    image.onerror = () => done(new Error('tile failed to load'), canvas);
    image.src = this.getTileUrl(coords);
    return canvas;
  }
}

import '../../test/dom-setup.ts';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import L from 'leaflet';
import { MaskedTileLayer, canvasSupported } from '../utils/maskedTileLayer.ts';
import { attachWpsLabel, SEA_LABEL_PANE } from '../utils/atlasSeaLabelLayer.ts';
import { tileMaskRects, worldPixel, SCS_STAMP } from '../utils/atlasSeaLabel.ts';

/** The real Leaflet (in jsdom, which has no layout and no canvas) with the canvas and image loading stood in for, so the erase can be checked
 *  call by call. The real map and the real tiles are checked in the browser run. */
class FakeImage {
  static all: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 256;
  naturalHeight = 256;
  alt = '';
  src = '';
  constructor() { FakeImage.all.push(this); }
}
interface Call { op: string; args: number[] }
let calls: Call[] = [];
let ctxMode: 'ok' | 'none' | 'drawThrows' = 'ok';
const HTMLCanvas = (window as unknown as { HTMLCanvasElement: { prototype: { getContext: unknown } } }).HTMLCanvasElement;
const realGetContext = HTMLCanvas.prototype.getContext;

beforeEach(() => {
  FakeImage.all = []; calls = []; ctxMode = 'ok';
  (globalThis as unknown as { Image: unknown }).Image = FakeImage;
  HTMLCanvas.prototype.getContext = function () {
    if (ctxMode === 'none') return null;
    return {
      drawImage: (...a: number[]) => { if (ctxMode === 'drawThrows') throw new Error('broken image'); calls.push({ op: 'draw', args: a.slice(1) }); },
      clearRect: (...a: number[]) => calls.push({ op: 'clear', args: a }),
    };
  };
});
afterEach(() => { HTMLCanvas.prototype.getContext = realGetContext; });

const URL_ = 'https://basemaps.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}{r}.png?key=pub';
const stampTile = (z: number) => { const p = worldPixel(SCS_STAMP.lat, SCS_STAMP.lng, z); return { x: Math.floor(p.x / 256), y: Math.floor(p.y / 256), z }; };
const newLayer = () => { const layer = new MaskedTileLayer(URL_, { maxZoom: 18, zIndex: 2, className: 'atlas-labels' }); layer.getTileUrl = () => 'https://tiles.test/label.png'; return layer; };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const newMap = (zoom: number) => { const el = document.createElement('div'); document.body.appendChild(el); const map = L.map(el, { zoomAnimation: false, fadeAnimation: false }); map.setView([14.6, 121], zoom, { animate: false }); return { map, el }; };

test('a tile away from the stamp is the ordinary image, untouched (no canvas, no extra work)', () => {
  const tile = newLayer().createTile({ x: 1, y: 1, z: 5 } as L.Coords, () => {});
  assert.equal(tile.tagName, 'IMG');
  assert.equal(FakeImage.all.length, 0, 'the plain path does not use the canvas image loader');
});

test('a tile with the stamp is drawn to a canvas, the stamp rectangle is cleared after it, and Leaflet is told when it is ready', () => {
  const coords = stampTile(5);
  let done: { err?: Error; tile?: HTMLElement } | null = null;
  const tile = newLayer().createTile(coords as L.Coords, (err, el) => { done = { err, tile: el }; });
  assert.equal(tile.tagName, 'CANVAS');
  assert.equal(done, null, 'not ready until the image has loaded (nothing is shown half-drawn)');
  FakeImage.all[0].onload!();
  assert.deepEqual(calls.map((c) => c.op), ['draw', 'clear'], 'draw first, then clear: the hole is transparent');
  const [rect] = tileMaskRects(coords);
  assert.deepEqual(calls[1].args, [rect.x, rect.y, rect.w, rect.h]);
  assert.ok(done && !(done as { err?: Error }).err && (done as { tile?: HTMLElement }).tile === tile);
  assert.equal((tile as HTMLCanvasElement).width, 256);
});

test('@2x tiles (twice the pixels, same tile size) erase the same area: the rectangle is scaled to the real image', () => {
  const coords = stampTile(7);
  const layer = newLayer();
  const tile = layer.createTile(coords as L.Coords, () => {}) as HTMLCanvasElement;
  FakeImage.all[0].naturalWidth = 512; FakeImage.all[0].naturalHeight = 512;
  FakeImage.all[0].onload!();
  const [rect] = tileMaskRects(coords);
  assert.equal(tile.width, 512);
  assert.equal(tile.height, 512);
  assert.deepEqual(calls[1].args, [rect.x * 2, rect.y * 2, rect.w * 2, rect.h * 2]);
});

test('graceful fallback: no canvas gives the ordinary image; a failed tile still raises tileerror; a failed draw never throws', () => {
  ctxMode = 'none';
  assert.equal(canvasSupported(), false);
  assert.equal(newLayer().createTile(stampTile(6) as L.Coords, () => {}).tagName, 'IMG', 'the stamp stays (as CARTO draws it) rather than the tile going missing');
  ctxMode = 'ok';
  assert.equal(canvasSupported(), true);
  let error: Error | undefined;
  newLayer().createTile(stampTile(6) as L.Coords, (err) => { error = err; });
  FakeImage.all[FakeImage.all.length - 1].onerror!();
  assert.ok(error instanceof Error, 'Leaflet is given the error, so its tileerror event (and the tile-health check) still fire');
  ctxMode = 'drawThrows';
  let finished = false;
  newLayer().createTile(stampTile(6) as L.Coords, (err) => { finished = !err; });
  assert.doesNotThrow(() => FakeImage.all[FakeImage.all.length - 1].onload!());
  assert.equal(finished, true, 'the tile still completes, so the map never waits on it');
});

test('the West Philippine Sea label: a quiet text marker in its own pane, on at zoom 5-6, handed to CARTO at 7, back at 12-13', async () => {
  const { map, el } = newMap(5);
  const layer = newLayer().addTo(map);
  const detach = attachWpsLabel(map, layer, true);
  const pane = map.getPane(SEA_LABEL_PANE)!;
  assert.equal(pane.style.zIndex, '250');
  assert.equal(pane.style.pointerEvents, 'none');
  const marker = pane.querySelector('.atlas-sealabel') as HTMLElement;
  assert.ok(marker, 'the label exists');
  assert.equal(marker.textContent, 'WestPhilippineSea', 'three lines of real text');
  assert.equal(marker.classList.contains('leaflet-interactive'), false, 'not interactive: it can never take a tap');
  assert.equal(marker.classList.contains('is-on'), true, 'on at zoom 5');
  const at = map.latLngToLayerPoint([16, 119]);
  const pos = L.DomUtil.getPosition(marker);
  assert.ok(Math.abs(pos.x - at.x) <= 1 && Math.abs(pos.y - at.y) <= 1, 'placed at 119E 16N, the point CARTO anchors its own label at');
  assert.equal(marker.style.marginLeft, '-40px', 'and centred on it (an 80 x 44 box, anchored at 40, 23)');
  assert.equal(marker.style.marginTop, '-23px');

  map.setZoom(6, { animate: false }); await sleep(30);
  assert.equal(marker.classList.contains('is-on'), true, '5 to 6: stays on');
  map.setZoom(7, { animate: false }); await sleep(30);
  assert.equal(marker.classList.contains('is-on'), false, 'zoom 7: CARTO draws its own, ours is off');
  for (const z of [8, 11]) { map.setZoom(z, { animate: false }); await sleep(30); assert.equal(marker.classList.contains('is-on'), false, `zoom ${z}`); }
  map.setZoom(12, { animate: false });
  await sleep(60);
  assert.equal(marker.classList.contains('is-on'), false, 'zoom 12: waits for the old tiles to go before appearing (no overlap)');
  await sleep(300);
  assert.equal(marker.classList.contains('is-on'), true, 'zoom 12: CARTO\'s clipped label is erased, so ours is shown');
  map.setZoom(13, { animate: false }); await sleep(30);
  assert.equal(marker.classList.contains('is-on'), true);
  map.setZoom(14, { animate: false }); await sleep(30);
  assert.equal(marker.classList.contains('is-on'), false, 'zoom 14: CARTO\'s whole label again');

  detach();
  assert.equal(el.querySelector('.atlas-sealabel'), null, 'the label is removed on cleanup');
  // attaching again (React runs effects twice in development) works: the label is back, in a pane that is still on the page
  const again = attachWpsLabel(map, layer, true);
  map.setZoom(13, { animate: false }); await sleep(400);
  const second = el.querySelector('.atlas-sealabel') as HTMLElement;
  assert.ok(second && el.contains(second), 'the label is back');
  assert.equal(second.classList.contains('is-on'), true);
  again();
  map.remove();
});

test('with no canvas (CARTO\'s clipped label cannot be erased) our label is never drawn over it at zoom 12-13', async () => {
  const { map } = newMap(12);
  const layer = newLayer().addTo(map);
  const detach = attachWpsLabel(map, layer, false);
  const marker = map.getPane(SEA_LABEL_PANE)!.querySelector('.atlas-sealabel') as HTMLElement;
  await sleep(300);
  assert.equal(marker.classList.contains('is-on'), false, 'zoom 12 without masking: off');
  map.setZoom(5, { animate: false }); await sleep(300);
  assert.equal(marker.classList.contains('is-on'), true, 'zoom 5 still gets it (there is no CARTO label there to overlap)');
  detach(); map.remove();
});

test("after loading, the masked layer prunes the previous zoom's tiles (Leaflet leaves them under masked tiles, so two sets of labels would show)", async () => {
  const { map } = newMap(11);
  const layer = newLayer().addTo(map);
  let pruned = 0;
  (layer as unknown as { _pruneTiles: () => void })._pruneTiles = () => { pruned++; };
  layer.fire('load');
  assert.equal(pruned, 0, 'not until the 200ms fade is over');
  await sleep(450);
  assert.equal(pruned, 1);
  layer.remove();
  layer.fire('load');
  await sleep(450);
  assert.equal(pruned, 1, 'a layer that has left the map is left alone');
  map.remove();
});

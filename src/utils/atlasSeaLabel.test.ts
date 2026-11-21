import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createSeaLabelGate, customWpsVisible, isCartoDarkLabels, maskWindowsForZoom, SCS_STAMP, tileMaskRects, WPS_CLIPPED, WPS_LABEL_ANCHOR, worldPixel,
} from './atlasSeaLabel.ts';

// an independent Web-Mercator, to check worldPixel against (tile fractions, as used by every slippy-map library)
const tileFraction = (lat: number, lng: number, z: number) => {
  const n = 2 ** z;
  return { x: ((lng + 180) / 360) * n, y: ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n };
};

test('worldPixel is Web-Mercator with 256px tiles', () => {
  assert.deepEqual(worldPixel(0, 0, 0), { x: 128, y: 128 });
  for (const z of [5, 9, 13]) {
    const f = tileFraction(15, 115, z);
    const p = worldPixel(15, 115, z);
    assert.ok(Math.abs(p.x - f.x * 256) < 1e-6 && Math.abs(p.y - f.y * 256) < 1e-6, `zoom ${z}`);
  }
  // the CARTO tile that holds the stamp at zoom 5 (measured on the real tiles): x 26, y 14, with the anchor 56px across and 166px down
  const p = worldPixel(15, 115, 5);
  assert.equal(Math.floor(p.x / 256), 26);
  assert.equal(Math.floor(p.y / 256), 14);
  assert.ok(Math.abs((p.x % 256) - 56) < 2 && Math.abs((p.y % 256) - 166) < 2);
});

test("the stamp is erased from zoom 5 up, CARTO's own West Philippine Sea label only where a tile edge clips it (zoom 12-13)", () => {
  const ids = (z: number) => maskWindowsForZoom(z).map((w) => w.id);
  for (const z of [0, 1, 2, 3, 4]) assert.deepEqual(ids(z), [], `zoom ${z}: the stamp is not drawn yet`);
  for (const z of [5, 6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18]) assert.deepEqual(ids(z), ['scs-stamp'], `zoom ${z}: only the stamp`);
  for (const z of [12, 13]) assert.deepEqual(ids(z), ['scs-stamp', 'wps-clipped'], `zoom ${z}`);
});

test('the erase rectangles cover the measured labels with a margin and nothing near them', () => {
  // measured on the real tiles: stamp x -36..+36, y -30..+26; clipped label x -36..+36, y -21..+19 (anchor-relative, 1x pixels)
  assert.ok(SCS_STAMP.left >= 36 + 3 && SCS_STAMP.right >= 36 + 3 && SCS_STAMP.top >= 30 + 3 && SCS_STAMP.bottom >= 26 + 3);
  assert.ok(WPS_CLIPPED.left >= 36 + 3 && WPS_CLIPPED.right >= 36 + 3 && WPS_CLIPPED.top >= 21 + 3 && WPS_CLIPPED.bottom >= 19 + 3);
  // the nearest other label to the stamp is 64px away (zoom 5): the rectangle must stay inside that gap
  assert.ok(Math.max(SCS_STAMP.left, SCS_STAMP.right, SCS_STAMP.top, SCS_STAMP.bottom) < 36 + 64);
});

test('a tile gets the part of the rectangle inside it, in tile pixels; neighbours get the rest, so an edge never leaves a sliver', () => {
  for (const z of [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
    const a = worldPixel(SCS_STAMP.lat, SCS_STAMP.lng, z);
    const tx = Math.floor(a.x / 256), ty = Math.floor(a.y / 256);
    let area = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const r of tileMaskRects({ x: tx + dx, y: ty + dy, z }, [SCS_STAMP])) {
        assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 256 && r.y + r.h <= 256 && r.w > 0 && r.h > 0, `inside its tile at zoom ${z}`);
        area += r.w * r.h;
      }
    }
    // the whole window (80 x 64, plus at most a pixel rounded out on each side) is covered across the tiles
    assert.ok(area >= 80 * 64 && area <= 82 * 66, `zoom ${z}: erased area ${area}`);
  }
  // two horizontally adjacent tiles meet exactly at the edge (the label straddles it)
  let straddled = false;
  for (const z of [12, 13]) {
    const w = worldPixel(WPS_CLIPPED.lat, WPS_CLIPPED.lng, z);
    const ty = Math.floor(w.y / 256);
    for (let tx = Math.floor(w.x / 256) - 1; tx <= Math.floor(w.x / 256) + 1; tx++) {
      const left = tileMaskRects({ x: tx, y: ty, z }, [WPS_CLIPPED])[0];
      const right = tileMaskRects({ x: tx + 1, y: ty, z }, [WPS_CLIPPED])[0];
      if (left && right) { straddled = true; assert.equal(left.x + left.w, 256); assert.equal(right.x, 0); }
    }
  }
  assert.equal(straddled, true, 'at zoom 12-13 the clipped label straddles a tile edge, which is exactly why CARTO clips it');
});

test('tiles away from the labels are untouched (so they stay plain images), and a repeated world copy erases the same place', () => {
  assert.deepEqual(tileMaskRects({ x: 0, y: 0, z: 8 }), []);
  assert.deepEqual(tileMaskRects({ x: 1, y: 1, z: 5 }), []);
  // CARTO's native West Philippine Sea tile at zoom 9 is not touched at all (only the stamp window exists there, hundreds of km away)
  const w9 = worldPixel(WPS_CLIPPED.lat, WPS_CLIPPED.lng, 9);
  assert.deepEqual(tileMaskRects({ x: Math.floor(w9.x / 256), y: Math.floor(w9.y / 256), z: 9 }), []);
  const p = worldPixel(SCS_STAMP.lat, SCS_STAMP.lng, 6);
  const base = { x: Math.floor(p.x / 256), y: Math.floor(p.y / 256), z: 6 };
  assert.deepEqual(tileMaskRects({ ...base, x: base.x + 64 }), tileMaskRects(base), 'one world to the east');
  assert.deepEqual(tileMaskRects({ ...base, x: base.x - 64 }), tileMaskRects(base), 'one world to the west');
  assert.ok(tileMaskRects(base).length === 1);
});

test("our label shows exactly where CARTO's is missing (zoom 5-6) or erased as clipped (12-13), never beside a whole one", () => {
  for (const z of [5, 6, 12, 13]) assert.equal(customWpsVisible(z), true, `zoom ${z}`);
  for (const z of [0, 1, 2, 3, 4, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18]) assert.equal(customWpsVisible(z), false, `zoom ${z}`);
  assert.equal(customWpsVisible(6.4), true);
  assert.equal(customWpsVisible(6.6), false, "6.6 loads zoom 7 tiles, where CARTO's own label is");
  // when tiles cannot be erased (no canvas), CARTO's clipped label stays, so ours must not be drawn over it
  assert.equal(customWpsVisible(12, false), false);
  assert.equal(customWpsVisible(13, false), false);
  assert.equal(customWpsVisible(5, false), true);
  // the no-duplicate invariant, for every zoom: ours is on only where CARTO's native label is absent (< 7) or erased
  for (let z = 0; z <= 18; z++) {
    if (!customWpsVisible(z)) continue;
    const nativeAbsent = z < 7;
    const nativeErased = maskWindowsForZoom(z).some((w) => w.id === 'wps-clipped');
    assert.ok(nativeAbsent || nativeErased, `zoom ${z}: would show two West Philippine Sea labels`);
  }
  // and it is drawn where CARTO anchors its own label
  assert.deepEqual(WPS_LABEL_ANCHOR, { lat: WPS_CLIPPED.lat, lng: WPS_CLIPPED.lng });
});

test("provider gating: only CARTO's dark labels-only tiles are touched", () => {
  const carto = 'https://basemaps.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}{r}.png?key=pub';
  assert.equal(isCartoDarkLabels(carto), true);
  assert.equal(isCartoDarkLabels('https://a.basemaps.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}.png'), true);
  for (const other of [
    'https://basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}.png',
    'https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png',
    'https://basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png',
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    'https://tiles.example.test/rastertiles/dark_only_labels/{z}/{x}/{y}.png',
    'https://basemaps.cartocdn.com.evil.test/rastertiles/dark_only_labels/{z}/{x}/{y}.png',
    'http://basemaps.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}.png',
    '', null, undefined,
  ]) assert.equal(isCartoDarkLabels(other as string), false, String(other));
});

/** A hand-run clock and tile layer, to drive the label gate step by step. */
function rig(settleMs = 250, maxWaitMs = 1500, replaceClipped = true) {
  let now = 0; let loading = false; let handle = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const log: string[] = [];
  const gate = createSeaLabelGate({
    wanted: (z) => customWpsVisible(z, replaceClipped),
    show: () => log.push(`show@${now}`),
    hide: () => log.push(`hide@${now}`),
    isLoading: () => loading,
    setTimer: (fn, ms) => { timers.set(++handle, { at: now + ms, fn }); return handle; },
    clearTimer: (h) => { timers.delete(h as number); },
    settleMs, maxWaitMs,
  });
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); now = next[1].at; next[1].fn();
    }
    now = end;
  };
  return { gate, log, advance, setLoading: (v: boolean) => { loading = v; }, loaded: () => { loading = false; gate.loaded(); } };
}

test('zooming out 7 to 6: our label appears only after the new tiles have loaded and the old ones had time to go (no overlap)', () => {
  const r = rig(); r.gate.init(7);
  assert.equal(r.gate.isVisible(), false);
  r.setLoading(true); r.gate.zoomed(6);
  assert.deepEqual(r.log, [], "still waiting for the zoom 6 tiles: CARTO's zoom 7 label is still on screen");
  r.advance(600); assert.deepEqual(r.log, []);
  r.loaded(); assert.deepEqual(r.log, [], 'tiles in; waiting for the old ones to fade');
  r.advance(249); assert.deepEqual(r.log, []);
  r.advance(2); assert.equal(r.log.length, 1); assert.match(r.log[0], /^show@/);
});

test("zooming in 6 to 7: our label leaves as CARTO's tiles arrive (never both, never neither for long)", () => {
  const r = rig(); r.gate.init(6);
  assert.deepEqual(r.log, ['show@0']);
  r.setLoading(true); r.gate.zoomed(7);
  assert.deepEqual(r.log, ['show@0'], "ours stays until CARTO's label is there");
  r.advance(400);
  r.loaded();
  assert.deepEqual(r.log, ['show@0', 'hide@400'], 'hidden the moment the zoom 7 tiles are in');
});

test('12 to 13 and 5 to 6 keep the label up without a blink; 13 to 14 hands over to CARTO', () => {
  const r = rig(); r.gate.init(12);
  r.setLoading(true); r.gate.zoomed(13); r.loaded();
  r.setLoading(true); r.gate.zoomed(14);
  assert.deepEqual(r.log, ['show@0']);
  r.loaded();
  assert.deepEqual(r.log, ['show@0', 'hide@0']);
  const q = rig(); q.gate.init(5); q.setLoading(true); q.gate.zoomed(6); q.loaded();
  assert.deepEqual(q.log, ['show@0'], 'no hide-and-show between zoom 5 and 6');
});

test('rapid zooming cancels earlier plans; a dead tile server never leaves the label in the wrong state', () => {
  const r = rig(); r.gate.init(5);
  r.setLoading(true); r.gate.zoomed(7); r.gate.zoomed(8); r.gate.zoomed(6);
  r.loaded(); r.advance(2000);
  assert.deepEqual(r.log, ['show@0'], 'ended where it wanted to be: still shown');
  const s = rig(); s.gate.init(6); s.setLoading(true); s.gate.zoomed(9);
  s.advance(1499); assert.deepEqual(s.log, ['show@0']);
  s.advance(2); assert.deepEqual(s.log, ['show@0', 'hide@1500'], 'no tiles ever arrive: it still changes after the wait');
  // a zoom back before the settle delay finishes cancels the pending show
  const t = rig(); t.gate.init(8); t.setLoading(true); t.gate.zoomed(6); t.loaded(); t.advance(100); t.gate.zoomed(8); t.advance(1000);
  assert.deepEqual(t.log, [], 'never shown');
  t.gate.dispose();
});

test('when tiles are already in (cached) the change happens without waiting for a load event', () => {
  const r = rig(); r.gate.init(7);
  r.setLoading(false); r.gate.zoomed(6);
  assert.deepEqual(r.log, []);
  r.advance(251);
  assert.equal(r.log.length, 1);
  assert.match(r.log[0], /^show@/);
  const s = rig(); s.gate.init(6); s.gate.zoomed(7);
  assert.deepEqual(s.log, ['show@0', 'hide@0']);
});

test('source guards: nothing is read back from a tile canvas, the layer is gated, and the pane and blend CSS are present', () => {
  const layer = fs.readFileSync('src/utils/maskedTileLayer.ts', 'utf8');
  const code = layer.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /getImageData|toDataURL|toBlob|crossOrigin/, 'tiles are only drawn, never read: no CORS needed, no tainted-canvas error possible');
  assert.match(code, /clearRect/);
  assert.match(code, /image\.onerror = \(\) => done\(new Error/, 'a failed tile still reports tileerror');
  assert.match(code, /if \(!context\) return super\.createTile/, 'no canvas gives the ordinary image');
  const map = fs.readFileSync('src/components/AtlasMap.tsx', 'utf8').replace(/\r\n/g, '\n');
  assert.match(map, /const carto = isCartoDarkLabels\(url\);\s*const canMask = carto && canvasSupported\(\);/);
  assert.match(map, /canMask \? new MaskedTileLayer\(url, options\) : L\.tileLayer\(url, options\)/, 'a plain layer otherwise');
  assert.match(map, /carto \? attachWpsLabel\(map, layer, canMask\)/, "our label only with CARTO's tiles; at zoom 12-13 only when the clipped label can be erased");
  const css = fs.readFileSync('src/index.css', 'utf8').replace(/\r\n/g, '\n');
  assert.match(css, /\.atlas-map canvas\.leaflet-tile \{ mix-blend-mode: plus-lighter; \}/, 'canvas tiles blend like the image tiles beside them');
  assert.match(css, /\.atlas-sealabel \{[^}]*pointer-events: none;[^}]*opacity: 0;/);
  assert.match(css, /\.atlas-sealabel\.is-on \{ opacity: 1; \}/);
  const label = fs.readFileSync('src/utils/atlasSeaLabelLayer.ts', 'utf8').replace(/\r\n/g, '\n');
  assert.match(label, /interactive: false,\s*keyboard: false,\s*pane: SEA_LABEL_PANE/, 'the label can never take a tap from the map or a star');
  assert.match(label, /pane\.style\.zIndex = '250'/, 'above the tiles, below the circles (400) and stars (600)');
  const docs = fs.readFileSync('docs/atlas.md', 'utf8');
  assert.match(docs, /Sea labels \(only with CARTO's `dark_only_labels` tiles/);
  assert.match(docs, /Clipped by a tile edge at zoom 12 \(47 px wide\) and 13 \(58 px wide\)/);
  assert.match(docs, /MaskedTileLayer/);
});

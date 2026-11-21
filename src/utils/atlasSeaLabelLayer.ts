import L from 'leaflet';
import { createSeaLabelGate, customWpsVisible, WPS_LABEL_ANCHOR } from './atlasSeaLabel.ts';

export const SEA_LABEL_PANE = 'atlasSeaLabels';
const LABEL_HTML = '<span>West<br>Philippine<br>Sea</span>';

/**
 * Our own "West Philippine Sea" label, for the zoom levels where CARTO's is missing (5-6) or clipped by a tile edge (12-13; the clipped
 * one is erased by MaskedTileLayer). It is a real text marker in its own pane (above the tiles, below the stars and circles), not
 * interactive, drawn at the same point CARTO anchors its own label at, so nothing jumps when the zoom moves between the two.
 *
 * It follows the labels layer, not just the zoom: see createSeaLabelGate. Returns a cleanup function.
 *
 * @param replaceClipped false when tiles cannot be masked: CARTO's clipped label then stays, so ours is not drawn over it at zoom 12-13.
 */
export function attachWpsLabel(map: L.Map, labels: L.TileLayer, replaceClipped: boolean): () => void {
  // The pane lives as long as the map: Leaflet keeps a removed pane in its registry, so removing it on cleanup would hand a detached pane
  // to the next attach (React runs effects twice in development) and the label would never show.
  const pane = map.getPane(SEA_LABEL_PANE) ?? map.createPane(SEA_LABEL_PANE);
  pane.style.zIndex = '250';
  pane.style.pointerEvents = 'none';
  const marker = L.marker([WPS_LABEL_ANCHOR.lat, WPS_LABEL_ANCHOR.lng], {
    icon: L.divIcon({ className: 'atlas-sealabel', html: LABEL_HTML, iconSize: [80, 44], iconAnchor: [40, 23] }),
    interactive: false,
    keyboard: false,
    pane: SEA_LABEL_PANE,
  }).addTo(map);
  const setOn = (on: boolean) => marker.getElement()?.classList.toggle('is-on', on);

  let loading = false;
  const gate = createSeaLabelGate({
    wanted: (zoom) => customWpsVisible(zoom, replaceClipped),
    show: () => setOn(true),
    hide: () => setOn(false),
    isLoading: () => loading,
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
  });
  const onLoading = () => { loading = true; };
  const onLoad = () => { loading = false; gate.loaded(); };
  let lastZoom = Math.round(map.getZoom());
  // moveend comes after the tile layer has reacted to the zoom (it registered first), so `loading` is already right here
  const onMoveEnd = () => {
    const zoom = Math.round(map.getZoom());
    if (zoom === lastZoom) return;
    lastZoom = zoom;
    gate.zoomed(zoom);
  };
  labels.on('loading', onLoading);
  labels.on('load', onLoad);
  map.on('moveend', onMoveEnd);
  gate.init(lastZoom);

  return () => {
    gate.dispose();
    labels.off('loading', onLoading);
    labels.off('load', onLoad);
    map.off('moveend', onMoveEnd);
    marker.remove();
  };
}

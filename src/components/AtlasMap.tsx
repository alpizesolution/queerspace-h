import React, { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AttributionControl, Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { MapBounds, PlaceGroup } from '../utils/atlas.ts';
import type { TileConfig } from '../utils/atlasConfig.ts';
import { wrapLongitude, type PickedPlace } from '../utils/atlasPick.ts';

/** A memory as a small glowing golden star with a thin dark outline (so it reads on the dark map). Only a count is ever written into the markup, never member text. */
const iconCache = new Map<string, L.DivIcon>();
export function starIcon(count: number, state: 'idle' | 'selected' | 'mine' = 'idle'): L.DivIcon {
  const key = `${count}|${state}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const badge = count > 1 ? `<span class="atlas-star__count">${count > 9 ? '9+' : count}</span>` : '';
  const icon = L.divIcon({
    className: `atlas-star atlas-star--${state}`,
    html: `<span class="atlas-star__halo"></span><span class="atlas-star__edge"></span><span class="atlas-star__core"></span>${badge}`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
  iconCache.set(key, icon);
  return icon;
}

/** The temporary marker for the place being chosen. Its own class keeps it tappable while the saved stars are not (see .atlas-picking). */
const pickIcon = L.divIcon({ className: 'atlas-star atlas-star--selected atlas-pick', html: '<span class="atlas-star__halo"></span><span class="atlas-star__edge"></span><span class="atlas-star__core"></span>', iconSize: [36, 36], iconAnchor: [18, 18] });

/** Choosing a place on THIS map: a tap anywhere sets the spot, and the marker (with the ~1 km area it will be saved within) can be dragged. */
const PickLayer: React.FC<{ place: PickedPlace | null; onPick: (lat: number, lng: number) => void }> = ({ place, onPick }) => {
  useMapEvents({ click: (event) => onPick(event.latlng.lat, wrapLongitude(event.latlng.lng)) });
  if (!place) return null;
  return (
    <>
      <Circle center={[place.lat, place.lng]} radius={600} interactive={false} pathOptions={{ color: '#c8b5e6', weight: 1.5, dashArray: '4 4', fillColor: '#c8b5e6', fillOpacity: 0.14 }} />
      <Marker
        position={[place.lat, place.lng]}
        icon={pickIcon}
        draggable
        zIndexOffset={1000}
        title="Chosen spot. Drag to adjust."
        eventHandlers={{ dragend: (event) => { const p = event.target.getLatLng(); onPick(p.lat, wrapLongitude(p.lng)); } }}
      />
    </>
  );
};

/** Counts failed tiles so a dead or blocked tile provider is reported instead of leaving a silent grey map. */
const TileHealth: React.FC<{ onFailing: () => void }> = ({ onFailing }) => {
  const failed = useRef(0);
  useMapEvents({});
  const map = useMap();
  useEffect(() => {
    const onError = () => {
      failed.current += 1;
      if (failed.current === 6) onFailing();
    };
    const layers: L.TileLayer[] = [];
    map.eachLayer((layer) => { if (layer instanceof L.TileLayer) { layers.push(layer); layer.on('tileerror', onError); } });
    return () => layers.forEach((layer) => layer.off('tileerror', onError));
  }, [map, onFailing]);
  return null;
};

const ViewReporter: React.FC<{ onViewChange?: (bounds: MapBounds) => void }> = ({ onViewChange }) => {
  const map = useMap();
  const report = () => {
    const b = map.getBounds();
    onViewChange?.({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
  };
  useMapEvents({ moveend: report });
  useEffect(() => { report(); /* the first view */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};

const FlyTo: React.FC<{ target: { lat: number; lng: number; zoom?: number; at: number } | null }> = ({ target }) => {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], target.zoom ?? Math.max(map.getZoom(), 11), { duration: 0.8 });
  }, [map, target]);
  return null;
};

/** Leaflet measures its box once; this keeps it right when the layout around it changes (side panel, phone rotation). */
const KeepSize: React.FC = () => {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(el);
    return () => observer.disconnect();
  }, [map]);
  return null;
};

interface AtlasMapProps {
  groups: PlaceGroup[];
  selectedKey: string | null;
  tiles: TileConfig;
  onSelect: (group: PlaceGroup) => void;
  onViewChange?: (bounds: MapBounds) => void;
  onTilesFailing?: () => void;
  flyTo?: { lat: number; lng: number; zoom?: number; at: number } | null;
  center?: [number, number];
  zoom?: number;
  /** Present while a memory's place is being chosen: taps on the map set it. Absent otherwise. */
  pick?: { place: PickedPlace | null; onPick: (lat: number, lng: number) => void } | null;
}

export const AtlasMap: React.FC<AtlasMapProps> = ({ groups, selectedKey, tiles, onSelect, onViewChange, onTilesFailing, flyTo = null, center = [14.6, 121.0], zoom = 5, pick = null }) => {
  const maxBounds = useMemo(() => L.latLngBounds([-85, -200], [85, 200]), []);
  return (
    // MapContainer ignores extra props, so the tone and test id live on this wrapper (the CSS reads data-atlas-tone).
    <div className={`h-full w-full ${pick ? 'atlas-picking' : ''}`} data-atlas-tone={tiles.tone} data-testid="atlas-map" data-picking={pick ? 'true' : undefined}>
    <MapContainer
      center={center}
      zoom={zoom}
      minZoom={2}
      maxZoom={tiles.maxZoom}
      maxBounds={maxBounds}
      maxBoundsViscosity={0.8}
      worldCopyJump
      zoomControl
      attributionControl={false}
      className="atlas-map h-full w-full"
    >
      {/* The credit control stays on (the OpenStreetMap and provider credits are required); only Leaflet's own "Leaflet" prefix and flag are dropped. */}
      <AttributionControl position="bottomright" prefix={false} />
      <TileLayer url={tiles.url} attribution={tiles.attribution} maxZoom={tiles.maxZoom} />
      {/* Street and town names on their own transparent layer, so they can be made brighter without recolouring the roads under them. */}
      {tiles.labelsUrl && <TileLayer url={tiles.labelsUrl} maxZoom={tiles.maxZoom} zIndex={2} className="atlas-labels" />}
      <KeepSize />
      <ViewReporter onViewChange={onViewChange} />
      <FlyTo target={flyTo} />
      {onTilesFailing && <TileHealth onFailing={onTilesFailing} />}
      {pick && <PickLayer place={pick.place} onPick={pick.onPick} />}
      {groups.map((group) => {
        const anyMine = group.memories.some((m) => m.mine);
        const state = group.key === selectedKey ? 'selected' : anyMine ? 'mine' : 'idle';
        return (
          <Marker
            key={group.key}
            position={[group.lat, group.lng]}
            icon={starIcon(group.memories.length, state)}
            title={group.memories.length > 1 ? `${group.memories.length} memories here` : group.memories[0]?.title}
            keyboard
            eventHandlers={{ click: () => onSelect(group) }}
          />
        );
      })}
    </MapContainer>
    </div>
  );
};

export default AtlasMap;

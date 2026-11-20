/** The spot chosen on the ATLAS map for a new memory (or a moved one). Only the point: it is the pin on the map, nothing is typed. */
export interface PickedPlace { lat: number; lng: number }

/** A point the server will accept: finite and on the globe. (The server still rounds it to a ~1 km grid and decides everything else.) */
export const isValidPick = (place: PickedPlace | null): place is PickedPlace =>
  Boolean(place) && Number.isFinite(place!.lat) && Number.isFinite(place!.lng) && Math.abs(place!.lat) <= 90 && Math.abs(place!.lng) <= 180;

/** Longitude as Leaflet reports it can run past 180 after panning around the world; bring it back to the real range. */
export const wrapLongitude = (lng: number): number => (lng >= -180 && lng <= 180 ? lng : ((((lng + 180) % 360) + 360) % 360) - 180);

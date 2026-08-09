// Map-linked day planning: haversine distance.
//
// PURE, framework-free, dependency-free — no React, no maplibre-gl, no network.
// The map is an INPUT to day planning: a user
// assigns a map pin (an "anchor") to a trip day.: that anchor is the day's BASE
// POINT — the origin of the per-stop distance label — and no longer re-orders anything;
// every surface, the map included, sorts by TIME (`lib/sort-items-by-time.ts`).
// NO routing/geocoding API is used — distance is this arithmetic
// and nothing more. Nothing here persists: the anchor id is stored locally (dayAnchorStore,
// gateway key 22) and the assigned pin rides the existing itinerary CRUD (addItem).

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * The HTML5 drag-and-drop MIME type carrying a dragged map pin's marker id, shared by the
 * drag SOURCE (the marker popup handle, trip-map.tsx) and the drop TARGET (the day strip,
 * map-section.tsx). Lowercase per the DnD spec. Pointer-drag is a desktop convenience — the
 * keyboard/touch path is the popup's day `<select>` + Assign button, so this is never the
 * only way to assign (touch DnD is not fired by browsers).
 */
export const MAP_PIN_DND_TYPE = 'application/x-njp-marker-id';

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance in kilometres between two WGS84 coordinates (haversine).
 * Symmetric, 0 for identical points, and antimeridian-correct: two points either side
 * of the 180° line are measured across the short arc, not the long way round the globe
 * (the trig operates on absolute positions, so a raw longitude delta of ~360° collapses
 * to the true small separation). No projection, no external tiles — pure arithmetic.
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// / — `orderByProximity` lived here and was deleted, not left inert. The
// decision was time order on every surface including the map, made knowing it costs the day
// anchor its walking-route purpose. Both of its production call sites (in
// components/map-section.tsx) went with that decision, so the function had none left. Do NOT
// "restore" nearest-first ordering as a bug fix — see note.
// `haversineKm` above STAYS: the anchor is now the day's BASE POINT, and the day panel still
// labels each stop with its distance from it.

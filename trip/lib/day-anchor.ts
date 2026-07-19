// Map-linked day planning: haversine distance + proximity ordering.
//
// PURE, framework-free, dependency-free — no React, no maplibre-gl, no network.
// The map becomes an INPUT to day planning:
// a user assigns a map pin (an "anchor") to a trip day, and that day's stops re-order
// by client-side great-circle distance from the anchor. NO routing/geocoding API is
// used — ordering is this arithmetic and nothing more.
//
// The reorder is a pure, derived VIEW: given the day's stops + the day's anchor coord,
// `orderByProximity` returns a re-sorted copy. Nothing here persists — the anchor id is
// stored locally (dayAnchorStore, gateway key 22) and the assigned pin rides the existing
// itinerary CRUD (addItem). See map-section.tsx.

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

/** A coordinate that MAY be missing (a stop with no lat/lng match). */
type MaybeLatLng = { lat?: number; lng?: number };

function hasCoords(v: MaybeLatLng): v is LatLng {
  return typeof v.lat === 'number' && typeof v.lng === 'number';
}

/**
 * Re-order `items` by ascending haversine distance from `anchor`, returning a NEW array
 * (never mutates the input). Guarantees:
 * - Items WITHOUT coordinates keep their original relative order and sink to the END
 * (never crash, never sort NaN into the middle).
 * - The sort is STABLE: equal-distance items (incl. the anchor itself at distance 0)
 * preserve their input order.
 * - Empty / single-item lists are returned as a plain copy.
 * `getCoord` extracts the comparable coordinate from each item, so this works over
 * `DayStop` (via `s.marker`), a raw `MapMarker`, or any `{lat,lng}` record.
 */
export function orderByProximity<T>(
  items: readonly T[],
  anchor: LatLng,
  getCoord: (item: T) => MaybeLatLng,
): T[] {
  // Decorate-sort-undecorate with a stable tiebreak on the original index, so equal
  // distances (and the coord-less bucket) never depend on the engine's sort stability.
  return items
    .map((item, index) => {
      const coord = getCoord(item);
      const distance = hasCoords(coord) ? haversineKm(anchor, coord) : Infinity;
      return { item, index, distance };
    })
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map((d) => d.item);
}

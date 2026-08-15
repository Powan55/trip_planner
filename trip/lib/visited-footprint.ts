/**
 * The visited footprint (issue #31) — the shape the map fills in, derived from data the app
 * already has and NOT from a country dataset.
 *
 * ── WHY THERE IS NO POLYGON FILE HERE, AND WHY THIS IS NOT A COUNTRY BORDER ────────────────
 * The basemap is a RASTER source (CARTO dark-matter, `lib/map-style.ts`), so it carries no
 * vector country geometry to recolour. The only country-shaped data the repo holds is the pair
 * of leg bounding boxes in `core/places/model.ts` — rectangles used to decide which leg an
 * imported pin belongs to. Filling those rectangles and calling them Nepal and Japan would
 * paint the Korean peninsula and most of the Sea of Japan as "visited", which is the D-271
 * defect class (a surface asserting something untrue) rendered at 2,000 km across.
 *
 * The honest alternative would be real admin-0 polygons, and that is a new dataset on a route
 * that has to work offline on a Kathmandu street. It was not added: nothing in the repo could
 * source them, and typing an outline from memory is a fabricated border, which is worse than
 * no fill at all.
 *
 * So the fill is the GROUND YOUR VISITS COVER: the convex hull of the cities the visit record
 * confirms, padded outward, one shape per country. It is derived, it is true by construction,
 * and it costs ZERO new bytes of geometry — every coordinate comes from `lib/city-coords.ts`,
 * the table the app already ships. It must be LABELLED as a footprint everywhere it renders
 * (`components/map-section.tsx` does), never as a border.
 *
 * ── WHAT IT READS ──────────────────────────────────────────────────────────────────────────
 * Two existing producers and nothing else:
 * - `getVisited()` / `hasVisitedCity()` — issue #29's lifetime visit set (D-314), written by
 *   #30's autocount. Membership goes through `hasVisitedCity` rather than a local compare so
 *   the trim/case-fold rule stays in the one module that owns it.
 * - `allTripPlaces()` — issue #30's `lib/visit-autocount.ts`, the one place that pairs a trip
 *   city with its day's country LABEL. The lifetime set is two flat lists and cannot say which
 *   country a city belongs to; this is where that link already lives.
 *
 * PURE apart from the storage read inside `getVisited()`, which is itself total (SSR, disabled
 * storage and a corrupt slot all read as an empty set), so every function here degrades to an
 * empty array rather than throwing.
 */

import { cityCoord } from '@/lib/city-coords';
import { allTripPlaces, type VisitPlace } from '@/lib/visit-autocount';
import { hasVisitedCity } from '@/core/places/visited';

/** `[lng, lat]`, GeoJSON order. */
export type Point = [number, number];

export interface CountryFootprint {
  /** The country LABEL from the trip's own day labels — 'Nepal', 'Japan', 'USA'. */
  country: string;
  /** The visited cities this shape was built from, in first-visit order. */
  cities: string[];
  /** A closed, counter-clockwise linear ring (first point repeated last). */
  ring: Point[];
}

/**
 * How far outward each visited city is padded before the hull is taken, in DEGREES.
 *
 * 0.6° is ~66 km north–south and ~59 km east–west at Kathmandu's latitude — about the radius
 * `CITY_MATCH_KM` (75 km) already treats as "plausibly in this city", so the wash covers the
 * same ground the visit was credited for rather than a shape chosen to look good.
 *
 * KNOWN CEILING: a fixed DEGREE pad, so the wash is a little wider in km near the equator than
 * at Yuzawa. A geodesic buffer is the upgrade if a trip ever spans a big latitude range; for a
 * decorative fill on two mid-latitude countries the difference is invisible.
 */
export const FOOTPRINT_PAD_DEG = 0.6;

/** 2D cross product of OA × OB — positive when O→A→B turns counter-clockwise. */
function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/**
 * Andrew's monotone-chain convex hull, counter-clockwise, WITHOUT the closing point.
 *
 * Collinear points are dropped (`<= 0`), duplicates are removed first, and fewer than three
 * distinct points come back as-is — a caller that pads its input (as `visitedCountryFootprints`
 * does) can never hit that case, but a direct caller can.
 */
export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const uniq: Point[] = [];
  for (const p of sorted) {
    if (uniq.length > 0) {
      const last = uniq[uniq.length - 1];
      if (last[0] === p[0] && last[1] === p[1]) continue; // sorted, so duplicates are adjacent
    }
    uniq.push(p);
  }
  if (uniq.length < 3) return uniq;

  const lower: Point[] = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * The trip's own places that the lifetime visit record confirms, in itinerary order.
 *
 * Trip-scoped on purpose. The lifetime set may hold cities from a different trip or a different
 * decade; this is the intersection, which is what a stat sitting beside "8 cities on this trip"
 * has to mean. A country the record holds with no trip city (and so no coordinate) contributes
 * nothing — it cannot be drawn, and it is not counted as covered ground either.
 */
export function visitedTripPlaces(): VisitPlace[] {
  return allTripPlaces().filter((place) => hasVisitedCity(place.city));
}

/** Confirmed-versus-total, with BOTH sides counted the same way. */
export interface VisitedTally {
  /** Trip cities the visit record confirms. */
  cities: number;
  /** Distinct country LABELS among those confirmed places. */
  countries: number;
  /** Trip cities in total. */
  tripCities: number;
  /** Distinct country LABELS across the whole trip. */
  tripCountries: number;
}

/**
 * The confirmed counts and the totals they are measured against, from ONE producer.
 *
 * 🔴 THE VOCABULARY IS WHY THIS EXISTS. `tripShape().countries` (`lib/home-stats.ts`) counts
 * distinct LEG IDS — 2 for the default pack. This counts distinct country LABELS, which is 3,
 * because the Dec-9 departure day is labelled USA while its leg id stays 'nepal' (D-315,
 * `lib/leg-label.ts`). The visited side can only ever be labels, so pairing it with the leg
 * count would make "every country on the itinerary" true the moment you had been to USA and
 * Nepal — a milestone claiming a country you have not reached. Both sides come from
 * `allTripPlaces()` here so they cannot drift apart again.
 */
export function visitedTally(): VisitedTally {
  const all = allTripPlaces();
  const visited = visitedTripPlaces();
  const labels = (places: readonly VisitPlace[]) =>
    new Set(places.map((place) => place.country).filter(Boolean)).size;
  return {
    cities: visited.length,
    countries: labels(visited),
    tripCities: all.length,
    tripCountries: labels(all),
  };
}

/**
 * One padded, hulled footprint per visited country, in first-visit order.
 *
 * A place is skipped when its country label is blank (a single-leg custom trip has none — see
 * `lib/leg-label.ts` rule 2, and a nameless shape on a map says nothing) or when
 * `lib/city-coords.ts` does not know the city (a custom trip may name any city; that table is
 * honestly partial).
 */
export function visitedCountryFootprints(): CountryFootprint[] {
  const groups = new Map<string, { cities: string[]; corners: Point[] }>();
  for (const place of visitedTripPlaces()) {
    const coord = cityCoord(place.city);
    if (!coord || !place.country) continue;
    let group = groups.get(place.country);
    if (!group) {
      group = { cities: [], corners: [] };
      groups.set(place.country, group);
    }
    group.cities.push(place.city);
    // Four corners of a padded square around the city. Padding BEFORE the hull is what makes
    // one code path cover one city (a square), two (a capsule-ish quad) and eight alike.
    for (const dLng of [-FOOTPRINT_PAD_DEG, FOOTPRINT_PAD_DEG]) {
      for (const dLat of [-FOOTPRINT_PAD_DEG, FOOTPRINT_PAD_DEG]) {
        group.corners.push([coord.longitude + dLng, coord.latitude + dLat]);
      }
    }
  }

  const footprints: CountryFootprint[] = [];
  for (const [country, group] of groups) {
    const hull = convexHull(group.corners);
    if (hull.length < 3) continue; // unreachable with padded input; never emit a degenerate ring
    footprints.push({ country, cities: group.cities, ring: [...hull, hull[0]] });
  }
  return footprints;
}

/** The footprints as a GeoJSON FeatureCollection for the map's fill layer. */
export function footprintsToGeoJSON(footprints: readonly CountryFootprint[]) {
  return {
    type: 'FeatureCollection' as const,
    features: footprints.map((fp) => ({
      type: 'Feature' as const,
      geometry: { type: 'Polygon' as const, coordinates: [fp.ring] },
      properties: { country: fp.country, cities: fp.cities.length },
    })),
  };
}

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The visited footprint (issue #31) — the shape the map fills in.
 *
 * Three claims, and the first is the one that would let a lie onto the map:
 *
 *  1. **Nothing is drawn that was not visited.** The footprint is the INTERSECTION of the
 *     lifetime visit set (#29) with the trip's own places (#30's `allTripPlaces`), so a city
 *     the record has never seen contributes no geometry, and an empty record draws nothing.
 *  2. **Every drawn city is inside its own shape**, with the padding around it. That is the
 *     honesty property: a hull that failed to contain one of its inputs would be a shape
 *     claiming ground the visits do not support (and, worse, excluding ground they do).
 *  3. **The ring is a well-formed GeoJSON polygon** — closed, counter-clockwise, at least
 *     three distinct points — including the degenerate one-city case, which is what a traveller
 *     on day one of the trip actually has.
 *
 * Like `visit-autocount.test.ts`, every case seeds storage FIRST and then re-imports on a fresh
 * module graph: `core/dates` / `lib/leg-label` capture the active trip at module load, and the
 * clock is driven through the `?today=` override so no assertion here changes meaning when
 * December 2026 arrives.
 */

const VISITS_KEY = 'tripPlannerLifetimeVisits';
const TODAY_KEY = 'tripPlannerTodayOverride';

/** Seed the lifetime visit set, then load a fresh module graph on top of it. */
async function load(visited: { cities?: string[]; countries?: string[] }) {
  window.localStorage.setItem(
    VISITS_KEY,
    JSON.stringify({ cities: visited.cities ?? [], countries: visited.countries ?? [] }),
  );
  // Any date after the trip: `allTripPlaces()` is the whole trip regardless, and a fixed
  // override keeps the real calendar out of the run.
  window.sessionStorage.setItem(TODAY_KEY, '2027-06-01');
  vi.resetModules();
  return import('@/lib/visited-footprint');
}

/** Shoelace signed area — positive is counter-clockwise, the GeoJSON right-hand rule. */
function signedArea(ring: readonly [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum / 2;
}

/** Ray-casting point-in-polygon against a closed ring. */
function contains(ring: readonly [number, number][], point: readonly [number, number]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const straddles = yi > point[1] !== yj > point[1];
    if (straddles && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('visitedTripPlaces — the intersection, never the whole lifetime set', () => {
  it('an empty visit record covers no trip places and draws nothing', async () => {
    const { visitedTripPlaces, visitedCountryFootprints } = await load({});
    expect(visitedTripPlaces()).toEqual([]);
    expect(visitedCountryFootprints()).toEqual([]);
  });

  it('counts only trip cities the record confirms, in itinerary order', async () => {
    const { visitedTripPlaces } = await load({ cities: ['Osaka', 'Kathmandu'] });
    // Kathmandu is Dec 10, Osaka is Dec 19 — the order is the itinerary's, not the record's.
    expect(visitedTripPlaces()).toEqual([
      { city: 'Kathmandu', country: 'Nepal' },
      { city: 'Osaka', country: 'Japan' },
    ]);
  });

  it('ignores a lifetime city the trip never names — the stat sits beside a trip count', async () => {
    const { visitedTripPlaces } = await load({ cities: ['Reykjavik', 'Kathmandu'] });
    expect(visitedTripPlaces().map((p) => p.city)).toEqual(['Kathmandu']);
  });

  it('matches through the visit set’s own fold rule — case and whitespace insensitive', async () => {
    const { visitedTripPlaces } = await load({ cities: ['  kathmandu '] });
    expect(visitedTripPlaces().map((p) => p.city)).toEqual(['Kathmandu']);
  });
});

describe('visitedCountryFootprints — one honest shape per visited country', () => {
  it('groups by the country label the trip itself uses, in first-visit order', async () => {
    const { visitedCountryFootprints } = await load({
      cities: ['Tokyo', 'Kathmandu', 'New York', 'Kyoto'],
    });
    const fills = visitedCountryFootprints();
    expect(fills.map((f) => f.country)).toEqual(['USA', 'Nepal', 'Japan']);
    expect(fills.find((f) => f.country === 'Japan')?.cities).toEqual(['Kyoto', 'Tokyo']);
  });

  it('CONTAINS every city it was built from, and each one is padded, not merely touched', async () => {
    const { visitedCountryFootprints, FOOTPRINT_PAD_DEG } = await load({
      cities: ['Kathmandu', 'Lalitpur', 'Nagarkot', 'Bhaktapur', 'Tokyo', 'Kyoto', 'Osaka'],
    });
    // The coordinates are the app's own table (lib/city-coords.ts) — the point of the check is
    // containment, so they are restated here only as the probe points.
    const probes: Record<string, [number, number] | undefined> = {
      Nepal: [85.324, 27.7172], // Kathmandu
      Japan: [135.5023, 34.6937], // Osaka, the far corner of the Japan hull
    };
    for (const fill of visitedCountryFootprints()) {
      const probe = probes[fill.country];
      if (!probe) continue;
      expect(contains(fill.ring, probe), `${fill.country} excludes its own city`).toBe(true);
      // And the pad is real: a point most of the way out to the pad radius is still inside.
      const nudged: [number, number] = [probe[0], probe[1] + FOOTPRINT_PAD_DEG * 0.8];
      expect(contains(fill.ring, nudged), `${fill.country} is not padded`).toBe(true);
    }
  });

  it('a single visited city still yields a closed, counter-clockwise ring', async () => {
    const { visitedCountryFootprints } = await load({ cities: ['Kathmandu'] });
    const [nepal] = visitedCountryFootprints();
    expect(nepal.country).toBe('Nepal');
    expect(nepal.ring.length).toBeGreaterThanOrEqual(4); // >= 3 distinct + the closing point
    expect(nepal.ring[0]).toEqual(nepal.ring[nepal.ring.length - 1]); // closed
    expect(signedArea(nepal.ring)).toBeGreaterThan(0); // right-hand rule
  });

  it('emits GeoJSON polygons the fill layer can take as-is', async () => {
    const { visitedCountryFootprints, footprintsToGeoJSON } = await load({
      cities: ['Kathmandu', 'Tokyo'],
    });
    const collection = footprintsToGeoJSON(visitedCountryFootprints());
    expect(collection.type).toBe('FeatureCollection');
    expect(collection.features).toHaveLength(2);
    for (const feature of collection.features) {
      expect(feature.geometry.type).toBe('Polygon');
      expect(feature.geometry.coordinates).toHaveLength(1); // exterior ring only, no holes
      expect(typeof feature.properties.country).toBe('string');
    }
  });
});

describe('visitedTally — both sides of every comparison in ONE vocabulary', () => {
  it('counts trip countries as LABELS, not leg ids, so the visited side can match it', async () => {
    const { visitedTally } = await load({});
    const { tripCities, tripCountries } = visitedTally();
    // 8 cities, and 3 country labels: USA (the Dec-9 departure day, D-315), Nepal, Japan. The
    // leg count is 2 — `tripShape().countries` — and pairing THAT with a label-counted visited
    // side would call "every country" done after USA + Nepal, with Japan never reached.
    expect(tripCities).toBe(8);
    expect(tripCountries).toBe(3);
  });

  it('the confirmed side is a subset, and reaches the totals only when everything is visited', async () => {
    const empty = await load({});
    expect(empty.visitedTally().cities).toBe(0);
    expect(empty.visitedTally().countries).toBe(0);

    const partial = await load({ cities: ['New York', 'Kathmandu'] });
    expect(partial.visitedTally()).toEqual({
      cities: 2,
      countries: 2,
      tripCities: 8,
      tripCountries: 3,
    });

    const all = await load({
      cities: ['New York', 'Kathmandu', 'Lalitpur', 'Nagarkot', 'Bhaktapur', 'Osaka', 'Kyoto', 'Tokyo'],
    });
    const tally = all.visitedTally();
    expect(tally.cities).toBe(tally.tripCities);
    expect(tally.countries).toBe(tally.tripCountries);
  });
});

describe('convexHull — the one piece of geometry in the app', () => {
  it('drops interior and collinear points and keeps the corners, counter-clockwise', async () => {
    const { convexHull } = await load({});
    const square: [number, number][] = [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [1, 1], // interior
      [1, 0], // collinear on the bottom edge
      [2, 0], // duplicate
    ];
    const hull = convexHull(square);
    expect(hull).toHaveLength(4);
    expect(new Set(hull.map((p) => p.join(',')))).toEqual(
      new Set(['0,0', '2,0', '2,2', '0,2']),
    );
    expect(signedArea([...hull, hull[0]])).toBeGreaterThan(0);
  });

  it('returns fewer than three points unchanged rather than inventing a shape', async () => {
    const { convexHull } = await load({});
    const none: [number, number][] = [];
    const one: [number, number][] = [[1, 1]];
    const twice: [number, number][] = [[1, 1], [1, 1]];
    expect(convexHull(none)).toEqual([]);
    expect(convexHull(one)).toEqual([[1, 1]]);
    expect(convexHull(twice)).toEqual([[1, 1]]);
  });
});

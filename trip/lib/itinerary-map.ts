// Itinerary → map-coordinate join.
//
// PURE data/helper module — no maplibre-gl, no React — so BOTH map consumers
// build their coordinate stops here and hand the result to <TripMap> as the
// `routeStops` prop:
// • /map (MapSection) → when "My itinerary" is on: the SELECTED day's stops (issue #1,
//   via `stopsForDay`), or the whole trip's when no day is selected.
// • /plan → a single day's stops, re-derived on reorder.
// TripMap only RENDERS the stops it's given; the plan→coordinate matching lives
// here so the join stays testable and shared. Lifted verbatim from the prior
// map-section.tsx engine.

import { MAP_MARKERS, type MapMarker, type MarkerCategory } from '@/lib/map-data';
import type { DayPlan, ItineraryItem, ItineraryCategory } from '@/lib/trip-data';
import { cityCoord } from '@/lib/city-coords';
import { sortItemsByTime } from '@/lib/sort-items-by-time';
import { offsetForCountry, TRIP_DATES } from '@/core/dates';
import { legLabel } from '@/lib/leg-label';
import { haversineKm } from '@/lib/day-anchor';

// Planned items match a curated marker by (a) sourceId when present (card-created
// items,), else (b) a name match against the marker vocabulary so the rich
// SAMPLE_ITINERARY (which predates sourceId) still plots. Items with no coordinate
// match (custom/transport/food-at-a-non-marker) are simply skipped — never crash.
export const MARKER_BY_ID = new Map(MAP_MARKERS.map((mk) => [mk.id, mk]));

// The city that CONTAINS a marker, read off its own `area` — but only when the area
// actually names a "District, City" pair. A single-segment area ("Nagarkot (~32 km)",
// "Hakone", "Bhaktapur") names the locality itself, not a container, so it yields null.
function containingCity(mk: MapMarker): string | null {
  if (!mk.area.includes(',')) return null;
  return mk.area.split(',').pop()!.trim().toLowerCase();
}

// An alias matches on WORD BOUNDARIES, never as a bare substring. `hay.includes(k)` let a short
// alias match INSIDE another word: "Asan Bazaar" strips to `asan`, which clears the
// discriminating-alias guard below (4 chars, and not its own city "kathmandu") and is a substring
// of "Basantapur" — the `location` on Kathmandu Durbar Square, a different site ~450 m away. It
// produced no wrong pin only because np-durbar-ktm precedes np-asan in MAP_MARKERS and the first
// hit wins, i.e. it was masked by array order: reordering the markers, or an item whose text says
// only "Basantapur", flips it silently. `tusa` (Restaurant TUSA) inside "Tusal, Boudha" is the
// same shape. Measured over the seed items + curated cards + marker names — the basis is
// 180 seed items + 95 registry cards + one row per marker, 348 haystacks today (the "423" this
// comment used to quote matched no basis `matchMarker` is ever called on; re-counted 2026-09-01,
// when it stood at 349 with the duplicate Newa Lahana row still in): NOT ONE resolved pin
// changes — the only alias/haystack pairs that stop matching are those two, which array order
// was already hiding.
//
// The boundary wraps the WHOLE alias — aliases are multi-word ("kathmandu durbar", "asan bazaar")
// — and is applied per side only when that side's own edge character is a word character. Two
// aliases end in punctuation, "le sherpa & farmers'" and "kinkaku-ji (golden pavilion)", and a
// trailing `\b` after `'` or `)` demands a FOLLOWING word character, so those would never match at
// end of string. After a letter `\b` is the behaviour we want next to an apostrophe: `asan` still
// matches "Asan's". Metacharacters are escaped — marker names carry `(`, `)`, `&`, `.` and `'`.
function aliasPattern(alias: string): RegExp {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lead = /^\w/.test(alias) ? '\\b' : '';
  const tail = /\w$/.test(alias) ? '\\b' : '';
  return new RegExp(`${lead}${escaped}${tail}`, 'i');
}

// Precompute lowercased key fragments per marker, each compiled ONCE into its matcher: the
// per-item loop below runs for every itinerary item on every render.
export const NAME_INDEX = MAP_MARKERS.map((mk) => {
  // A short, distinctive key: the primary proper-noun of the place name.
  const keys = [mk.name.toLowerCase()];
  // Add a few well-known short aliases so sample titles like "Sunset at
  // Boudhanath Stupa" or "Dawn at Fushimi Inari" resolve.
  const primary = mk.name
    .toLowerCase()
    .replace(/\(.*?\)/g, '') // drop parentheticals
    .replace(/\b(temple|stupa|square|taisha|shrine|market|crossing|grove|park|viewpoint|bazaar|castle|monastery|hotel|restaurant)\b/g, '')
    .trim();
  // the alias must still be DISCRIMINATING, not merely short. Stripping the
  // place-type word off "Osaka Castle" left "osaka" — the name of the city the marker
  // sits in — so every item that merely mentioned Osaka (a flight, a hotel checkout,
  // Universal Studios) was plotted at the castle: 19 wrong pins on the curated seed,
  // and a wrong pin looks exactly like a right pin. An alias that equals the marker's
  // own containing city cannot identify the marker, so it is dropped. Locality-level
  // aliases ("thamel", "shibuya", "fushimi inari") are unaffected — they name the
  // place, not its container. RE-MEASURED after the Japan leg rebuild, on the 261-item seed and
  // the longest-alias-wins matcher below: re-admitting city-name aliases puts 21 items back on a
  // container's pin (all 21 are Osaka: j1-3b, j1-4, j1-6, j2-3, j2-4, j2-5, j2-7, j2-8, j3-1..4,
  // j3-6, j4-1, j4-4, j4-5, j4-7, j5-8, j5-9, j6-1, j6-2 → jp-osaka-castle), and loses 0 correct
  // ones. It was 19 on the 180-item seed; the guard carries more weight now, not less.
  if (primary && primary.length >= 4 && primary !== containingCity(mk)) keys.push(primary);
  const aliases = keys.filter(Boolean);
  return { marker: mk, keys: aliases, patterns: aliases.map(aliasPattern) };
});

// Every alias of every marker in ONE flat list, LONGEST ALIAS FIRST — the order `matchMarker`
// scans, so the first hit is the MOST SPECIFIC hit rather than the earliest row in MAP_MARKERS.
//
// It used to be first-hit-in-array-order, and that is the same defect class the word-boundary
// fix above describes: position, not specificity, decided the winner. Concretely — np-thamel
// ('Thamel Bazaar', `area: 'Thamel, Kathmandu'`, alias `thamel`) sits at MAP_MARKERS index 4,
// and `containingCity` returns null for a SINGLE-SEGMENT area, so the discriminating-alias
// guard could never drop `thamel`: it names the locality, not a container. Every venue IN
// Thamel carries "Thamel" in its `location`, so "Breakfast at Pumpernickel Bakery / Thamel"
// (np-pumpernickel, index 42), "Chikusa Cafe, Jyatha / Jyatha, Thamel" (index 41) and "Museum
// of Nepali Art / Thamel, Kathmandu" (index 28) all resolved to Thamel Bazaar — three
// researched venues plotted at the district they sit in, and a wrong pin looks exactly like a
// right pin. `pumpernickel bakery` (19 chars) now beats `thamel` (6). Specificity, not position.
//
// Sorted ONCE at module scope, not per item: the per-item loop is the same single pass it
// always was. `sort` is stable in V8, so aliases of equal length keep MAP_MARKERS order and
// the result stays deterministic.
export const ALIAS_INDEX: Array<{ marker: MapMarker; alias: string; re: RegExp }> = NAME_INDEX.flatMap(
  ({ marker, keys, patterns }) => patterns.map((re, i) => ({ marker, alias: keys[i], re })),
).sort((a, b) => b.alias.length - a.alias.length);

export function matchMarker(item: ItineraryItem): MapMarker | null {
  // 1) Exact sourceId join (curated map-card items).
  if (item.sourceId && MARKER_BY_ID.has(item.sourceId)) {
    return MARKER_BY_ID.get(item.sourceId)!;
  }
  // 2) Name match against the marker vocabulary (sample items), word-bounded — see
  // `aliasPattern` — most specific first, see `ALIAS_INDEX`.
  const hay = `${item.title} ${item.location ?? ''}`.toLowerCase();
  for (const { marker, re } of ALIAS_INDEX) {
    if (re.test(hay)) return marker;
  }
  return null;
}

// ──: "approximate" is the RESOLVER'S RETURN VALUE, never a stored flag ──────────
// `kind` is produced by the SAME call that produced the coordinate, from the same inputs, on
// every render. There is no `isApproximate` field on ItineraryItem, nothing persisted and
// nothing to migrate — so no future edit path can strip the label off the position it
// describes (a stored boolean would be exactly this repo's signature defect).
export type Placement =
  | {
      kind: 'exact';
      lat: number;
      lng: number;
      marker: MapMarker;
      via: 'pin' | 'source' | 'name';
    }
  | {
      kind: 'approximate';
      lat: number;
      lng: number;
      marker: MapMarker;
      via: 'area' | 'city';
      /**
       * — the VERBATIM text the coordinate came from (the matched marker `area`
       * string, or the day's `city`). The popup renders THIS string, not invented prose,
       * so the user can check the claim.
       */
      derivedFrom: string;
    }
  | { kind: 'none' };

/** A placement that actually has a coordinate — i.e. anything that can be a map pin. */
export type PlacedPlacement = Extract<Placement, { kind: 'exact' | 'approximate' }>;

/**
 * PURE. Straight-line ("as the crow flies") km between two consecutive stops in a day's
 * rendered order — issue #224. This is a different number from the per-stop anchor-distance
 * label already on `/map`: that one measures each stop from the day's fixed anchor pin, so a
 * backtrack (Asakusa → Shibuya → Asakusa) reads as two small, unremarkable numbers. Segment
 * distance measures stop-to-stop, so the return trip shows up.
 *
 * Free-tier constraint (no routing API): this is haversine, nothing more — never a walking-time
 * or route-distance estimate. Returns `null`, never `NaN` or a fabricated `0`, when either
 * placement has no coordinate (`kind: 'none'`) — same convention the anchor-distance label uses.
 */
export function segmentKm(prev: Placement, curr: Placement): number | null {
  if (prev.kind === 'none' || curr.kind === 'none') return null;
  return haversineKm({ lat: prev.lat, lng: prev.lng }, { lat: curr.lat, lng: curr.lng });
}

export interface DayStop {
  /**
   * The TRIP day this stop belongs to: 1 for the trip's first date, 2 for the second, …
   * Resolved from `date` by `tripDayNumber`, NEVER from a position in the `DayPlan[]` the
   * caller happened to pass. See that function for the defect this shape fixes.
   */
  day: number;
  date: string;
  /**
   * 1-based position of this PIN within its own day, in the order the day is planned —
   * the number drawn on the map ("stop 1, stop 2, stop 3"). Contiguous per day: it is
   * assigned AFTER the per-coordinate dedupe, so several plans sharing one point are one
   * pin carrying one number, and the sequence never skips.
   *
   * 🔴 D-281: this is ITINERARY order (time order on `/map`, the user's stored manual order
   * on `/plan` and `/travel` — whichever `buildRows` was asked for), and it is never
   * nearest-first. `orderByProximity` was deleted on purpose; do not reintroduce a distance
   * sort here or anywhere upstream of it.
   */
  seq: number;
  marker: MapMarker;
  title: string;
  /**: the item this stop came from (the first one, when several share a point). */
  item: ItineraryItem;
  /** How that coordinate was resolved. Never `none` — a `none` row produces no stop. */
  placement: PlacedPlacement;
  /**
   * — pin dedupe is PER-COORDINATE, not per-marker: every item keeps a row, and
   * items landing on the same point render as ONE pin listing all of them. `items[0]` is
   * always `item`.
   */
  items: ItineraryItem[];
}

/**
 * One row per itinerary item — including the items that resolve to NOTHING, which
 * is the whole reason this exists: the map's day list must show every plan, and say honestly
 * how each one got its position.
 */
export interface PlacementRow {
  /** The TRIP day number of `date` — see `DayStop.day` / `tripDayNumber`. */
  day: number;
  date: string;
  item: ItineraryItem;
  placement: Placement;
}

// Manual pin-drop: maps an itinerary category to the closest curated marker
// category, so a synthesized pin gets a sensible icon/color in TripMap. Categories with
// no clean analog (transportation, free, nightlife) fall back to 'Attraction' below.
const PIN_CATEGORY: Partial<Record<ItineraryCategory, MarkerCategory>> = {
  sightseeing: 'Attraction',
  food: 'Restaurant',
  photography: 'Photo Spot',
  shopping: 'Shopping',
  nature: 'Day Trip',
  cultural: 'Cultural',
  hotel: 'Hotel',
};

// Synthesize a MapMarker from an item's manual pin. Only called when BOTH lat/lng are
// defined (see stopMarkerFor). `x`/`y` are the legacy 0-100% mock-panel fields — harmless
// zeros, same as every real curated marker post- (nothing renders them anymore).
function pinMarker(item: ItineraryItem, country: string): MapMarker {
  return {
    id: item.id,
    name: item.title,
    category: PIN_CATEGORY[item.category] ?? 'Attraction',
    country,
    area: item.location || 'Pinned location',
    description: item.notes || 'A custom stop pinned from your itinerary.',
    lng: item.lng!,
    lat: item.lat!,
    x: 0,
    y: 0,
  };
}

// Resolve the map marker a plan item plots at: a manual pin (lat/lng BOTH set)
// BEATS the curated name/sourceId match — an explicit pin is unambiguous intent, so it
// wins even if the title also happens to contain a curated marker's name. An un-pinned
// item falls back to the existing `matchMarker` join, byte-identical to pre-
// behavior. `country` comes from the item's own day (DayPlan.country), the correct
// source of truth for a synthesized marker's cosmetic country styling.
export function stopMarkerFor(item: ItineraryItem, country: string): MapMarker | null {
  if (typeof item.lat === 'number' && typeof item.lng === 'number') {
    return pinMarker(item, country);
  }
  return matchMarker(item);
}

// ── The placement ladder ──────────────────────────────────────────────
// ONE pure function is the single answer to "where does this item sit on the map", so there
// is never a second join to drift. Precedence, highest first:
// 1 explicit pin → exact, via 'pin' (the user asserted this point)
// 2 sourceId join → exact, via 'source' (a curated marker, by id)
// 3 name join → exact, via 'name' (a curated marker, by its full name/alias)
// 4 area join → APPROXIMATE, via 'area' (the item's own `location` names a curated area)
// 5 day city → APPROXIMATE, via 'city' (the day's city centroid)
// — otherwise none
//
// 🔴 — RUNGS 4 AND 5 ARE A RUNTIME PROJECTION ONLY. Nothing here writes a derived
// coordinate into `item.lat`/`item.lng`, into the Vault, or into Firestore. `resolvePlacement`
// takes a readonly item and returns a new object; it never mutates its argument. If a derived
// centroid were persisted it would (a) become indistinguishable from a real pin, making
// honesty rule unenforceable one write later, (b) ride rev/hlc and sync to every other
// traveller as a deliberate edit, and (c) turn a CONTENT edit to the city table into a
// USER-DATA rewrite, against hard invariant.

// Rung 4's index — NO new table: built at module scope from the `area` strings the
// 156 curated markers already carry. First marker wins where two share an area (Thamel,
// Shinjuku). Normalisation is case + whitespace only, deliberately: the three areas carrying a
// parenthetical ("Nagarkot (~32 km)", "Nara (~45 min from Kyoto)", "Hakone (~85 min from
// Tokyo)") are each named by their own marker too, so an item saying "Hakone" is already taken
// by rung 3 — a parenthetical-stripping normaliser here was measured to be unreachable, and
// unreachable code is a lie about what the ladder does.
function normalizeArea(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export const AREA_INDEX: Map<string, MapMarker> = (() => {
  const index = new Map<string, MapMarker>();
  for (const mk of MAP_MARKERS) {
    const key = normalizeArea(mk.area);
    if (key && !index.has(key)) index.set(key, mk);
  }
  return index;
})();

// A DERIVED marker for rungs 4/5: deliberately NOT the curated marker whose area/city supplied
// the coordinate — an approximate pin must not present itself as that place. It carries the
// item's own name and the verbatim text the coordinate came from, so the popup can quote it.
function derivedMarker(
  item: ItineraryItem,
  country: string,
  derivedFrom: string,
  lat: number,
  lng: number,
): MapMarker {
  return {
    id: `approx-${item.id}`,
    name: item.title,
    category: PIN_CATEGORY[item.category] ?? 'Attraction',
    country,
    area: derivedFrom,
    description: item.notes || '',
    lng,
    lat,
    x: 0,
    y: 0,
  };
}

/**
 * — resolve where an item sits, and how confident that is. PURE: reads `item` and
 * `day`, writes nothing anywhere. `day` supplies the city (rung 5) and the
 * country used for a synthesized marker's cosmetic styling.
 */
export function resolvePlacement(item: ItineraryItem, day: DayPlan): Placement {
  const country = legLabel(day.country);

  // 1 — an explicit pin is unambiguous intent and beats every curated match.
  if (typeof item.lat === 'number' && typeof item.lng === 'number') {
    const marker = pinMarker(item, country);
    return { kind: 'exact', lat: marker.lat, lng: marker.lng, marker, via: 'pin' };
  }
  // 2 — sourceId join.
  if (item.sourceId && MARKER_BY_ID.has(item.sourceId)) {
    const marker = MARKER_BY_ID.get(item.sourceId)!;
    return { kind: 'exact', lat: marker.lat, lng: marker.lng, marker, via: 'source' };
  }
  // 3 — name join against the curated vocabulary (-tightened: an alias that merely names
  // the marker's own city is dropped, so "Check out of Osaka hotel" no longer claims a pin
  // at Osaka Castle).
  const named = matchMarker(item);
  if (named) return { kind: 'exact', lat: named.lat, lng: named.lng, marker: named, via: 'name' };

  // 4 — the item's own `location` names a curated AREA. Approximate: it says the district,
  // not the doorway.
  const area = item.location ? AREA_INDEX.get(normalizeArea(item.location)) : undefined;
  if (area) {
    return {
      kind: 'approximate',
      lat: area.lat,
      lng: area.lng,
      marker: derivedMarker(item, country, area.area, area.lat, area.lng),
      via: 'area',
      derivedFrom: area.area,
    };
  }

  // 5 — the day's city. Total over the DEFAULT pack by a build-time invariant:
  // content-validation's "every itinerary city is weather-known" fails if any day's city
  // is missing from the one city table.
  const coord = cityCoord(day.city);
  if (coord) {
    return {
      kind: 'approximate',
      lat: coord.latitude,
      lng: coord.longitude,
      marker: derivedMarker(item, country, day.city, coord.latitude, coord.longitude),
      via: 'city',
      derivedFrom: day.city,
    };
  }

  // Reachable on a CUSTOM trip, whose `city` is free text. The UI renders a
  // "no location yet" affordance for these rows — it never silently drops them.
  return { kind: 'none' };
}

/**
 * The trip-day number a DATE carries: 1 for the trip's first date, 2 for the second, … or
 * `null` for a date the active trip pack does not contain.
 *
 * 🔴 ISSUE #1 — THE WRONG-DAY ROOT CAUSE. `buildRows` used to number a day `idx + 1`, its
 * INDEX IN THE `DayPlan[]` IT WAS HANDED. That array is only ever "one entry per trip date"
 * for a device still holding the untouched seed: `upsertDay` (core/itinerary/crud.ts) appends
 * a day only when something is planned on it, and a cleared vault (D-018: key present + empty
 * ⇒ no reseed) starts from `[]`. So one item planned on Dec 20 produced a one-element array
 * and a stop labelled "Day 1", and EVERY day after a gap was off by the size of the gap. The
 * two single-day surfaces were worse still: `/plan` and `/travel` pass `[dayPlan]`, so every
 * stop they ever drew claimed to be Day 1 (the old `itinerary-map.test.ts` pinned exactly
 * that — a Dec 12 stop asserting `day === 1`).
 *
 * The date is the identity; the array position never was. Lexicographic `indexOf` over
 * `TRIP_DATES` is TZ-independent for the same reason `getCountryForDate` is (B-01): no
 * `new Date(dateStr)` parse happens anywhere on this path.
 */
export function tripDayNumber(date: string): number | null {
  const i = TRIP_DATES.indexOf(date);
  return i === -1 ? null : i + 1;
}

// Flatten plans → one row PER ITEM, numbered by trip day. `chrono` picks the ordering:
// • true — the day's rows are sorted by TIME, using `sortItemsByTime`. Since #94
// deleted the timeline island this is that function's only production consumer.
// • false (/plan, /travel) — the STORED order, which on those surfaces is the user's own
// manually dragged order; re-sorting it there would silently override the drag.
function buildRows(plans: DayPlan[], chrono: boolean): PlacementRow[] {
  const sorted = [...plans].sort((a, b) => a.date.localeCompare(b.date));
  const rows: PlacementRow[] = [];
  sorted.forEach((plan, idx) => {
    // A date outside the active pack (a custom trip's stray day) has no trip-day number, so
    // it falls back to its position — the old behaviour, kept only where nothing better
    // exists. Never 0/-1: a day number is 1-based everywhere it is rendered.
    const dayNo = tripDayNumber(plan.date) ?? idx + 1;
    const items = plan.items ?? [];
    const ordered = chrono
      ? sortItemsByTime(items, plan.date, offsetForCountry(plan.country))
      : items;
    for (const item of ordered) {
      rows.push({ day: dayNo, date: plan.date, item, placement: resolvePlacement(item, plan) });
    }
  });
  return rows;
}

/**
 * EVERY item of every day, in time order, each with its resolved placement (including
 * `kind:'none'`). The /map day list renders these rows 1:1 — that is what "every plan is on
 * the map" means, and the `kind` is what keeps it honest.
 */
export function buildItineraryPlacements(plans: DayPlan[]): PlacementRow[] {
  return buildRows(plans, true);
}

/**
 * Rows → map pins, deduped within a day. Several items landing on the same point
 * become ONE stop whose `items` lists them all, so a day with six unmatched Kathmandu plans
 * draws one honest "around Kathmandu" pin instead of six stacked ones.
 *
 * The dedupe key differs by kind, deliberately:
 * • an APPROXIMATE placement has no identity beyond its point, so it dedupes by COORDINATE;
 * • an EXACT placement dedupes by its MARKER, because an asserted place keeps its identity
 * even when it shares a point with another. 🔴 Measured, not assumed: coordinate-deduping
 * the exact path silently merged a user's own dropped pin into the curated marker it
 * happened to land on (the /plan picker's "use centre" lands on the fitted marker), and
 * /plan's "N of M stops shown" then under-reported a plan that WAS plotting —
 * e2e/pin-drop.spec.ts caught it on a real run.
 * `kind` is part of both keys, so an exact pin is never merged into an approximate one.
 */
export function placementStops(rows: PlacementRow[]): DayStop[] {
  const stops: DayStop[] = [];
  const byPoint = new Map<string, DayStop>();
  // Issue #1 — the drawn number. One counter PER DATE, bumped only when a new pin is
  // created, so each day's pins read 1, 2, 3 … with no gaps and no restart mid-day. Rows
  // arrive in itinerary order (see `buildRows`), so the counter inherits that order and
  // nothing here re-sorts anything (D-281).
  const seqByDate = new Map<string, number>();
  for (const row of rows) {
    if (row.placement.kind === 'none') continue;
    const p = row.placement;
    const key =
      p.kind === 'exact'
        ? `${row.date}|exact|${p.marker.id}`
        : `${row.date}|approximate|${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
    const existing = byPoint.get(key);
    if (existing) {
      existing.items.push(row.item);
      continue;
    }
    const seq = (seqByDate.get(row.date) ?? 0) + 1;
    seqByDate.set(row.date, seq);
    const stop: DayStop = {
      day: row.day,
      date: row.date,
      seq,
      marker: p.marker,
      title: row.item.title,
      item: row.item,
      placement: p,
      items: [row.item],
    };
    byPoint.set(key, stop);
    stops.push(stop);
  }
  return stops;
}

/**
 * Issue #1 — the stops of ONE day, or every stop when no day is chosen.
 *
 * The whole "show only the selected day" rule, in one place, keyed on the DATE (the identity
 * that cannot be off by one — see `tripDayNumber`). A day with nothing planned returns `[]`,
 * which is what CLEARS the map rather than leaving the previous day's pins sitting there:
 * `TripMap`'s route effect writes an empty FeatureCollection for an empty stop list. That
 * emptiness is the feature, so callers must pass the filtered array straight through rather
 * than falling back to the unfiltered one when it comes back empty.
 */
export function stopsForDay(stops: DayStop[], date: string | null): DayStop[] {
  if (!date) return stops;
  return stops.filter((s) => s.date === date);
}

/**
 * The EXACT-only stops (ladder rungs 1–3), in stored order — byte-equivalent to the join this
 * function has always performed (same per-marker dedupe), now carrying the resolved
 * `placement` and every `item` that shares each pin. Used by the day maps on /plan and /travel.
 *
 * 🔴 The approximate rungs are deliberately NOT applied here: those surfaces render one day's
 * items as BOTH browse markers and the route line, and they report an honest "N of M stops
 * shown". Feeding them city centroids would stack every unplaceable item on one point and make
 * that ratio N === M — the exact vacuous-counter defect exists to prevent. Extending
 * the ladder to them needs their counters re-pointed at exact-vs-total in the same change.
 */
export function buildItineraryStops(plans: DayPlan[]): DayStop[] {
  return placementStops(buildRows(plans, false).filter((r) => r.placement.kind === 'exact'));
}

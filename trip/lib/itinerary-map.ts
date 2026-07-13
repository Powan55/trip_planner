// Itinerary → map-coordinate join.
//
// PURE data/helper module — no maplibre-gl, no React — so BOTH map consumers
// build their coordinate stops here and hand the result to <TripMap> as the
// `routeStops` prop:
//   • /map (MapSection)  → the whole trip's stops when "My itinerary" is on.
//   • /plan               → a single day's stops, re-derived on reorder.
// TripMap only RENDERS the stops it's given; the plan→coordinate matching lives
// here so the join stays testable and shared. Lifted verbatim from the prior
// map-section.tsx engine.

import { MAP_MARKERS, type MapMarker, type MarkerCategory } from '@/lib/map-data';
import type { DayPlan, ItineraryItem, ItineraryCategory } from '@/lib/trip-data';

// Planned items match a curated marker by (a) sourceId when present (card-created
// items), else (b) a name match against the marker vocabulary so the rich
// SAMPLE_ITINERARY (which predates sourceId) still plots. Items with no coordinate
// match (custom/transport/food-at-a-non-marker) are simply skipped — never crash.
export const MARKER_BY_ID = new Map(MAP_MARKERS.map((mk) => [mk.id, mk]));

// Precompute lowercased key fragments per marker for cheap contains-matching.
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
  if (primary && primary.length >= 4) keys.push(primary);
  return { marker: mk, keys };
});

export function matchMarker(item: ItineraryItem): MapMarker | null {
  // 1) Exact sourceId join (curated map-card items).
  if (item.sourceId && MARKER_BY_ID.has(item.sourceId)) {
    return MARKER_BY_ID.get(item.sourceId)!;
  }
  // 2) Name contains-match against the marker vocabulary (sample items).
  const hay = `${item.title} ${item.location ?? ''}`.toLowerCase();
  for (const { marker, keys } of NAME_INDEX) {
    for (const k of keys) {
      if (k && hay.includes(k)) return marker;
    }
  }
  return null;
}

export interface DayStop {
  day: number; // 1-based day index within the trip
  date: string;
  marker: MapMarker;
  title: string;
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
// zeros, same as every real curated marker now that the mock panel is gone (nothing
// renders them anymore).
function pinMarker(item: ItineraryItem, country: 'Nepal' | 'Japan'): MapMarker {
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
// item falls back to the existing `matchMarker` join, byte-identical to prior
// behavior. `country` comes from the item's own day (DayPlan.country), the correct
// source of truth for a synthesized marker's cosmetic country styling.
export function stopMarkerFor(item: ItineraryItem, country: 'Nepal' | 'Japan'): MapMarker | null {
  if (typeof item.lat === 'number' && typeof item.lng === 'number') {
    return pinMarker(item, country);
  }
  return matchMarker(item);
}

// Flatten plans → an ordered list of coordinate stops, numbered by trip day.
// One stop per marker-per-day (first match wins) so a day's route reads cleanly.
export function buildItineraryStops(plans: DayPlan[]): DayStop[] {
  const sorted = [...plans].sort((a, b) => a.date.localeCompare(b.date));
  const stops: DayStop[] = [];
  sorted.forEach((plan, idx) => {
    const seen = new Set<string>();
    const country: 'Nepal' | 'Japan' = plan.country === 'nepal' ? 'Nepal' : 'Japan';
    for (const item of plan.items ?? []) {
      const marker = stopMarkerFor(item, country);
      if (!marker || seen.has(marker.id)) continue;
      seen.add(marker.id);
      stops.push({ day: idx + 1, date: plan.date, marker, title: item.title });
    }
  });
  return stops;
}

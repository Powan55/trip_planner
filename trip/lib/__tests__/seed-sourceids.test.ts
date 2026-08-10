// Guard test for S257 — every `sourceId` annotated onto a seed itinerary item in
// `core/content/itinerary.ts` (D-135 authoring source) must resolve to a REAL place id
// in one of the five sourceId vocabularies (D-027a): recommendation ids verbatim
// (NEPAL/JAPAN attractions + food), photo ids verbatim, map ids verbatim, `featured-*`
// via `featuredSourceId(name)`, and `nightlife-*` via `nightlifeSourceId(id)`. This
// catches typos and future place-data renames that would silently break the "Added"
// badge for a hardcoded plan item (findPlacements is pure sourceId equality — no
// fuzzy matching). It does NOT assert completeness of seed coverage (D-142 stored
// order / item set is unrelated and untouched by this slice).
import { describe, it, expect } from 'vitest';
import { TRIP_ITINERARY } from '@/core/content/itinerary';
import { NEPAL_ATTRACTIONS, NEPAL_FOOD } from '@/lib/nepal-data';
import { JAPAN_ATTRACTIONS, JAPAN_FOOD } from '@/lib/japan-data';
import { PHOTO_SPOTS } from '@/lib/photography-data';
import { MAP_MARKERS } from '@/lib/map-data';
import { NIGHTLIFE_VENUES } from '@/lib/nightlife-data';
import { FEATURED_DESTINATIONS } from '@/lib/travel-tips-data';
import { featuredSourceId, nightlifeSourceId } from '@/lib/itinerary-adapter';

describe('seed itinerary sourceIds resolve to real places (S257)', () => {
  const recIds = new Set([...NEPAL_ATTRACTIONS, ...NEPAL_FOOD, ...JAPAN_ATTRACTIONS, ...JAPAN_FOOD].map((r) => r.id));
  const photoIds = new Set(PHOTO_SPOTS.map((p) => p.id));
  const mapIds = new Set(MAP_MARKERS.map((m) => m.id));
  const featuredIds = new Set(FEATURED_DESTINATIONS.map((f) => featuredSourceId(f.name)));
  const nightlifeIds = new Set(NIGHTLIFE_VENUES.map((n) => nightlifeSourceId(n.id)));

  const seedSourceIds = TRIP_ITINERARY.flatMap((day) => day.items)
    .map((item) => item.sourceId)
    .filter((id): id is string => Boolean(id));

  it('the seed itinerary actually has sourceId-annotated items (sanity, not a completeness assertion)', () => {
    expect(seedSourceIds.length).toBeGreaterThan(0);
  });

  it.each(seedSourceIds)('sourceId "%s" resolves to a real recommendation/photo/map/featured/nightlife id', (id) => {
    const resolves = recIds.has(id) || photoIds.has(id) || mapIds.has(id) || featuredIds.has(id) || nightlifeIds.has(id);
    expect(resolves).toBe(true);
  });
});

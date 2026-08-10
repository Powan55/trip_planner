// Unit tests for `lib/itinerary-adapter.ts` — S138 (D-146). Covers the new
// `nightlifeSourceId` helper: its exact namespaced shape, and the no-false-positive
// guarantee that a nightlife-derived sourceId can NEVER collide with a
// recommendation/photo/map/`featured-*` sourceId produced by `toItineraryDraft` for any
// real record in the app's curated data. This is the pure-function proof behind the
// "a nightlife add does not flip any curated card to Added" behavioral requirement
// (also covered end-to-end in e2e/nightlife-gate.spec.ts).
import { describe, it, expect } from 'vitest';
import { nightlifeSourceId, featuredSourceId, toItineraryDraft, formatPlacementSummary } from '@/lib/itinerary-adapter';
import { NIGHTLIFE_VENUES } from '@/lib/nightlife-data';
import { NEPAL_ATTRACTIONS, NEPAL_FOOD } from '@/lib/nepal-data';
import { JAPAN_ATTRACTIONS, JAPAN_FOOD } from '@/lib/japan-data';
import { PHOTO_SPOTS } from '@/lib/photography-data';
import { MAP_MARKERS } from '@/lib/map-data';
import { FEATURED_DESTINATIONS } from '@/lib/travel-tips-data';

describe('formatPlacementSummary (S248)', () => {
  it('returns "" for no placements', () => {
    expect(formatPlacementSummary([])).toBe('');
  });

  it('returns "On <Mon Day>" for a single placement, weekday stripped', () => {
    expect(formatPlacementSummary([{ date: '2026-12-12' }])).toBe('On Dec 12');
  });

  it('returns "On N days" for several placements', () => {
    expect(formatPlacementSummary([{ date: '2026-12-12' }, { date: '2026-12-15' }])).toBe('On 2 days');
  });
});

describe('nightlifeSourceId (D-146)', () => {
  it('namespaces the raw venue id with a "nightlife-" prefix', () => {
    expect(nightlifeSourceId('nl1')).toBe('nightlife-nl1');
    expect(nightlifeSourceId('nl16')).toBe('nightlife-nl16');
  });

  it('is derived identically for the same id (pure / stable)', () => {
    expect(nightlifeSourceId('nl7')).toBe(nightlifeSourceId('nl7'));
  });
});

describe('nightlife sourceId cannot collide with any curated card sourceId (D-146 anti-false-positive)', () => {
  const nightlifeIds = NIGHTLIFE_VENUES.map((v) => nightlifeSourceId(v.id));

  const recommendationIds = [...NEPAL_ATTRACTIONS, ...NEPAL_FOOD, ...JAPAN_ATTRACTIONS, ...JAPAN_FOOD].map(
    (rec) => toItineraryDraft(rec, 'recommendation').sourceId,
  );
  const photoIds = PHOTO_SPOTS.map((spot) => toItineraryDraft(spot, 'photo').sourceId);
  const mapIds = MAP_MARKERS.map((marker) => toItineraryDraft(marker, 'map').sourceId);
  const featuredIds = FEATURED_DESTINATIONS.map((dest) => featuredSourceId(dest.name));

  it('every nightlife-derived sourceId is absent from the recommendation sourceId set', () => {
    const collisions = nightlifeIds.filter((id) => recommendationIds.includes(id));
    expect(collisions).toEqual([]);
  });

  it('every nightlife-derived sourceId is absent from the photo sourceId set', () => {
    const collisions = nightlifeIds.filter((id) => photoIds.includes(id));
    expect(collisions).toEqual([]);
  });

  it('every nightlife-derived sourceId is absent from the map sourceId set', () => {
    const collisions = nightlifeIds.filter((id) => mapIds.includes(id));
    expect(collisions).toEqual([]);
  });

  it('every nightlife-derived sourceId is absent from the featured sourceId set', () => {
    const collisions = nightlifeIds.filter((id) => featuredIds.includes(id));
    expect(collisions).toEqual([]);
  });

  it('the "nightlife-" prefix is not produced by any other source-family adapter (structural guarantee)', () => {
    // Even if a future data edit reused a raw id string across families, the
    // "nightlife-" prefix is unique to this helper — recommendation/photo/map
    // sourceIds are raw record ids (no prefix), and featuredSourceId always prefixes
    // "featured-". So no other branch can ever produce a "nightlife-…" string.
    const allOtherIds = [...recommendationIds, ...photoIds, ...mapIds, ...featuredIds];
    expect(allOtherIds.some((id) => id.startsWith('nightlife-'))).toBe(false);
  });
});

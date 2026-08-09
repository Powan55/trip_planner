import { describe, it, expect } from 'vitest';
import {
  resolvePlacement,
  buildItineraryPlacements,
  buildItineraryStops,
  placementStops,
  AREA_INDEX,
  MARKER_BY_ID,
} from '@/lib/itinerary-map';
import { SAMPLE_ITINERARY } from '@/lib/sample-itinerary';
import { CITY_COORDS } from '@/lib/city-coords';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';

/**
 * S381 — the five-rung placement ladder (D-278) and the approximate-pin honesty rule (D-279).
 *
 * The load-bearing cases, in the order they can hurt:
 *  1. Each rung fires at its own precedence, and only rungs 4–5 are `approximate`.
 *  2. `derivedFrom` is the VERBATIM text the coordinate came from (D-279) — the popup
 *     quotes it, so the user can check the claim.
 *  3. 🔴 A DERIVED COORDINATE IS NEVER PERSISTED (D-278): resolving the WHOLE trip must
 *     leave every stored `lat`/`lng` — and every `rev` — byte-identical.
 *  4. Every item gets a row, including the ones that used to vanish; the default pack has
 *     ZERO `kind:'none'`, and a custom trip's unknown city reaches `none` and is handled.
 *  5. Pins dedupe per COORDINATE, not per marker, and no item is dropped doing it.
 */

const NEPAL_DAY: DayPlan = {
  date: '2026-12-11',
  city: 'Kathmandu',
  country: 'nepal',
  items: [],
};

function withItems(day: DayPlan, items: ItineraryItem[]): DayPlan {
  return { ...day, items };
}

describe('S381 · D-278 — the ladder resolves at the right rung', () => {
  it('rung 1: an explicit pin wins, is exact, and plots at its own coordinate', () => {
    const item: ItineraryItem = {
      id: 'p',
      // The title ALSO names a curated marker — the pin must still win (S137).
      title: 'Boudhanath Stupa, but actually the cafe across the road',
      category: 'food',
      lat: 27.6,
      lng: 85.1,
    };
    const p = resolvePlacement(item, withItems(NEPAL_DAY, [item]));
    expect(p.kind).toBe('exact');
    if (p.kind === 'none') throw new Error('unreachable');
    expect(p.via).toBe('pin');
    expect([p.lat, p.lng]).toEqual([27.6, 85.1]);
  });

  it('rung 2: a sourceId join is exact and lands on that curated marker', () => {
    const item: ItineraryItem = {
      id: 's',
      title: 'Anything at all',
      category: 'sightseeing',
      sourceId: 'np-boudhanath',
    };
    const p = resolvePlacement(item, withItems(NEPAL_DAY, [item]));
    if (p.kind !== 'exact') throw new Error('expected exact');
    expect(p.via).toBe('source');
    expect(p.marker.id).toBe('np-boudhanath');
  });

  it('rung 3: a full curated name in the title is exact', () => {
    const item: ItineraryItem = { id: 'n', title: 'Dawn at Fushimi Inari', category: 'photography' };
    const day: DayPlan = { date: '2026-12-28', city: 'Kyoto', country: 'japan', items: [item] };
    const p = resolvePlacement(item, day);
    if (p.kind !== 'exact') throw new Error('expected exact');
    expect(p.via).toBe('name');
    expect(p.marker.id).toBe('jp-fushimi');
  });

  it('rung 4: a location naming a curated AREA is APPROXIMATE, at that area, quoting it', () => {
    const item: ItineraryItem = {
      id: 'a',
      title: 'Ramen somewhere around here',
      category: 'food',
      location: 'Shinjuku, Tokyo',
    };
    const day: DayPlan = { date: '2026-12-20', city: 'Tokyo', country: 'japan', items: [item] };
    const p = resolvePlacement(item, day);
    if (p.kind !== 'approximate') throw new Error('expected approximate');
    expect(p.via).toBe('area');
    expect(p.derivedFrom).toBe('Shinjuku, Tokyo');
    // It sits at the curated Shinjuku marker's point — but NOT presented as that place.
    const shinjuku = AREA_INDEX.get('shinjuku, tokyo')!;
    expect([p.lat, p.lng]).toEqual([shinjuku.lat, shinjuku.lng]);
    expect(p.marker.id).not.toBe(shinjuku.id);
    expect(p.marker.name).toBe(item.title);
  });

  it('rung 4 is case/whitespace tolerant, and quotes the area VERBATIM (D-279)', () => {
    const item: ItineraryItem = {
      id: 'a2',
      title: 'Wander the arcades',
      category: 'shopping',
      location: '  akihabara,   TOKYO ',
    };
    const day: DayPlan = { date: '2026-12-21', city: 'Tokyo', country: 'japan', items: [item] };
    const p = resolvePlacement(item, day);
    if (p.kind !== 'approximate') throw new Error('expected approximate');
    expect(p.via).toBe('area');
    // The note quotes the marker's own string, not the user's — an invented paraphrase
    // would be uncheckable, which is the whole point of `derivedFrom`.
    expect(p.derivedFrom).toBe('Akihabara, Tokyo');
  });

  it('rung 3 still wins over rung 4 when the location names a curated PLACE, not a district', () => {
    // "Hakone" is both a marker area ("Hakone (~85 min from Tokyo)") and part of that
    // marker's own name, so the exact name join takes it first. This is why rung 4 needs no
    // parenthetical normalisation: the three parenthetical areas are all shadowed here.
    const item: ItineraryItem = { id: 'h', title: 'Onsen soak', category: 'free', location: 'Hakone' };
    const day: DayPlan = { date: '2026-12-24', city: 'Hakone', country: 'japan', items: [item] };
    const p = resolvePlacement(item, day);
    if (p.kind !== 'exact') throw new Error('expected exact');
    expect(p.via).toBe('name');
  });

  it('rung 5: nothing else matches → the DAY CITY, approximate, quoting the city', () => {
    const item: ItineraryItem = {
      id: 'c',
      title: 'Fly Delhi (DEL) → Kathmandu (KTM)',
      category: 'transportation',
      location: 'Delhi (DEL T3) → Kathmandu Tribhuvan Intl (KTM)',
    };
    const p = resolvePlacement(item, withItems(NEPAL_DAY, [item]));
    if (p.kind !== 'approximate') throw new Error('expected approximate');
    expect(p.via).toBe('city');
    expect(p.derivedFrom).toBe('Kathmandu');
    expect([p.lat, p.lng]).toEqual([
      CITY_COORDS.Kathmandu.latitude,
      CITY_COORDS.Kathmandu.longitude,
    ]);
  });

  it('kind:"none" is REACHABLE — a custom trip may name any city (D-278)', () => {
    const item: ItineraryItem = { id: 'x', title: 'Coffee', category: 'food' };
    const day: DayPlan = { date: '2027-03-01', city: 'Reykjavík', country: 'main', items: [item] };
    expect(resolvePlacement(item, day)).toEqual({ kind: 'none' });
  });
});

describe('S381 · D-278 — a derived position is NEVER persisted', () => {
  it('resolving the WHOLE trip mutates no item: lat/lng/rev are byte-identical after', () => {
    // A deep snapshot BEFORE, taken from the same objects the resolver will be handed.
    const before = JSON.stringify(SAMPLE_ITINERARY);
    const coordsBefore = SAMPLE_ITINERARY.flatMap((p) =>
      (p.items ?? []).map((i) => `${i.id}:${i.lat ?? '-'}:${i.lng ?? '-'}:${i.rev ?? '-'}`),
    );

    // Resolve every item of every day through the ladder, twice, and build the map's pins.
    const rows = buildItineraryPlacements(SAMPLE_ITINERARY);
    placementStops(rows);
    buildItineraryPlacements(SAMPLE_ITINERARY);

    // A meaningful number of those rows are DERIVED — if this were 0 the assertions below
    // would pass vacuously, because nothing would have had a derived coordinate to leak.
    const derived = rows.filter((r) => r.placement.kind === 'approximate');
    expect(derived.length).toBeGreaterThan(50);

    const coordsAfter = SAMPLE_ITINERARY.flatMap((p) =>
      (p.items ?? []).map((i) => `${i.id}:${i.lat ?? '-'}:${i.lng ?? '-'}:${i.rev ?? '-'}`),
    );
    expect(coordsAfter).toEqual(coordsBefore);
    expect(JSON.stringify(SAMPLE_ITINERARY)).toBe(before);

    // …and specifically: not one item ended up carrying the coordinate we derived for it.
    for (const row of derived) {
      expect(row.item.lat, `${row.item.id} had a derived lat written back`).toBeUndefined();
      expect(row.item.lng, `${row.item.id} had a derived lng written back`).toBeUndefined();
    }
  });

  it('the resolver does not mutate the item it is given, even under repeated calls', () => {
    const item: ItineraryItem = { id: 'm', title: 'Wander', category: 'free', rev: 3 };
    const day = withItems(NEPAL_DAY, [item]);
    resolvePlacement(item, day);
    resolvePlacement(item, day);
    expect(item).toEqual({ id: 'm', title: 'Wander', category: 'free', rev: 3 });
  });
});

describe('S381 · D-278 — every plan gets a row, and pins dedupe per coordinate', () => {
  it('the default pack: one row per item, ZERO of them kind:"none"', () => {
    const items = SAMPLE_ITINERARY.reduce((n, p) => n + (p.items?.length ?? 0), 0);
    const rows = buildItineraryPlacements(SAMPLE_ITINERARY);
    expect(rows).toHaveLength(items);
    expect(rows.filter((r) => r.placement.kind === 'none')).toHaveLength(0);
  });

  it('a day whose items ALL resolve only by city still renders a row for each of them', () => {
    // Day 1 of the curated seed: three transport legs, none of which names a curated place.
    // Before S381 this day produced NO rows at all — the plans existed and the map denied it.
    const day1 = SAMPLE_ITINERARY[0];
    const rows = buildItineraryPlacements([day1]);
    expect(rows).toHaveLength(day1.items.length);
    expect(rows.every((r) => r.placement.kind === 'approximate')).toBe(true);
    // …but they collapse to ONE pin, because they share one coordinate.
    expect(placementStops(rows)).toHaveLength(1);
    expect(placementStops(rows)[0].items).toHaveLength(day1.items.length);
  });

  it('no item is lost to the per-coordinate dedupe: pins account for every placed row', () => {
    const rows = buildItineraryPlacements(SAMPLE_ITINERARY);
    const stops = placementStops(rows);
    const placed = rows.filter((r) => r.placement.kind !== 'none');
    expect(stops.reduce((n, s) => n + s.items.length, 0)).toBe(placed.length);
    expect(stops.length).toBeLessThan(placed.length); // dedupe actually did something
  });

  it('an EXACT stop keeps its own pin at a point an approximate stop also occupies', () => {
    const pinned: ItineraryItem = {
      id: 'pin-at-city',
      title: 'Pinned exactly on the city centre',
      category: 'sightseeing',
      lat: CITY_COORDS.Kathmandu.latitude,
      lng: CITY_COORDS.Kathmandu.longitude,
    };
    const vague: ItineraryItem = { id: 'vague', title: 'Something in town', category: 'free' };
    const stops = placementStops(buildItineraryPlacements([withItems(NEPAL_DAY, [pinned, vague])]));
    expect(stops).toHaveLength(2);
    expect(stops.map((s) => s.placement.kind).sort()).toEqual(['approximate', 'exact']);
  });

  it('two DIFFERENT asserted places at one point keep two pins (exact dedupes by marker)', () => {
    // A user's dropped pin that happens to land on a curated marker is still their own
    // assertion about a different plan — merging them would make /plan's honest
    // "N of M stops shown" under-report an item that IS plotting (caught by pin-drop.spec).
    const curated: ItineraryItem = {
      id: 'curated',
      title: 'Boudhanath Stupa',
      category: 'sightseeing',
      sourceId: 'np-boudhanath',
    };
    const marker = MARKER_BY_ID.get('np-boudhanath')!;
    const pinned: ItineraryItem = {
      id: 'pinned',
      title: 'Meet Ram at the tea shop',
      category: 'food',
      lat: marker.lat,
      lng: marker.lng,
    };
    const stops = buildItineraryStops([withItems(NEPAL_DAY, [curated, pinned])]);
    expect(stops.map((s) => s.item.id)).toEqual(['curated', 'pinned']);
  });

  it('D-281: the day list is in TIME order, not stored order', () => {
    const late: ItineraryItem = { id: 'late', title: 'Dinner', category: 'food', startMinutes: 19 * 60 };
    const early: ItineraryItem = { id: 'early', title: 'Breakfast', category: 'food', startMinutes: 8 * 60 };
    const untimed: ItineraryItem = { id: 'untimed', title: 'Wander', category: 'free' };
    const rows = buildItineraryPlacements([withItems(NEPAL_DAY, [late, untimed, early])]);
    expect(rows.map((r) => r.item.id)).toEqual(['early', 'late', 'untimed']);
  });
});

describe('S381 · the exact-only join (/plan, /travel) is unchanged in meaning', () => {
  it('buildItineraryStops still yields ONLY exact placements, in STORED order', () => {
    const stops = buildItineraryStops(SAMPLE_ITINERARY);
    expect(stops.length).toBeGreaterThan(0);
    expect(stops.every((s) => s.placement.kind === 'exact')).toBe(true);
  });

  it('…and it keeps the user’s manual order rather than re-sorting by time (D-018)', () => {
    const late: ItineraryItem = {
      id: 'late',
      title: 'Boudhanath Stupa',
      category: 'sightseeing',
      startMinutes: 19 * 60,
    };
    const early: ItineraryItem = {
      id: 'early',
      title: 'Swayambhunath',
      category: 'sightseeing',
      startMinutes: 8 * 60,
    };
    const stops = buildItineraryStops([withItems(NEPAL_DAY, [late, early])]);
    expect(stops.map((s) => s.item.id)).toEqual(['late', 'early']);
  });
});

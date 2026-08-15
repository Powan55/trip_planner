import { describe, it, expect } from 'vitest';
import {
  buildItineraryPlacements,
  buildItineraryStops,
  placementStops,
  stopsForDay,
  tripDayNumber,
} from '@/lib/itinerary-map';
import { SAMPLE_ITINERARY } from '@/lib/sample-itinerary';
import { CITY_COORDS } from '@/lib/city-coords';
import { TRIP_DATES } from '@/core/dates';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';

/**
 * Issue #1 — "Map: show only the selected day, numbered in order".
 *
 * Three defects, in the order they can hurt:
 *
 *  1. THE WRONG DAY. `buildRows` numbered a day by its INDEX in the `DayPlan[]` it was
 *     handed, not by its date. That array holds only the days something is planned on
 *     (`upsertDay` appends on demand; a cleared vault starts from `[]`), and the two
 *     single-day surfaces pass exactly one day — so /plan and /travel labelled every stop
 *     "Day 1" forever, and /map was off by the size of any gap. `tripDayNumber` resolves it
 *     from the date instead.
 *  2. THE NUMBER ON THE PIN. It was that day index, so a day's whole route drew as a row of
 *     identical numbers. It is now `seq`: 1, 2, 3 … within the day, itinerary order, no
 *     gaps — assigned after the per-coordinate dedupe so it counts PINS, not rows.
 *  3. THE SCOPE. Picking a day changed only the panel; the canvas kept all 32 days drawn.
 *     `stopsForDay` is the filter, keyed on the DATE, and an empty day returns `[]` —
 *     which is what CLEARS the map instead of leaving the previous day's pins behind.
 *
 * D-281 is the invariant underneath all three: the order is the itinerary's, never
 * nearest-first. The adversarial case below fails if a distance sort ever comes back.
 */

const KATHMANDU = CITY_COORDS.Kathmandu;

function day(date: string, items: ItineraryItem[], city = 'Kathmandu'): DayPlan {
  return { date, city, country: 'nepal', items };
}

/** A pinned item — rung 1, so it is `exact` and plots exactly where it says. */
function pinned(id: string, lat: number, lng: number, startMinutes?: number): ItineraryItem {
  return { id, title: `Stop ${id}`, category: 'sightseeing', lat, lng, startMinutes };
}

describe('issue #1 · tripDayNumber — the day comes from the DATE, not the array position', () => {
  it('maps each trip date to its 1-based day number', () => {
    expect(tripDayNumber(TRIP_DATES[0])).toBe(1);
    expect(tripDayNumber('2026-12-09')).toBe(1);
    expect(tripDayNumber('2026-12-12')).toBe(4);
    expect(tripDayNumber(TRIP_DATES[TRIP_DATES.length - 1])).toBe(TRIP_DATES.length);
  });

  it('returns null for a date the trip does not contain (never 0, never -1)', () => {
    expect(tripDayNumber('2025-01-01')).toBeNull();
    expect(tripDayNumber('')).toBeNull();
  });

  it('a ONE-DAY plans array is numbered by its date — the /plan and /travel defect', () => {
    // Both single-day surfaces call the join with `[dayPlan]`. Every stop they drew used to
    // say Day 1, whichever day it was.
    const rows = buildItineraryPlacements([day('2026-12-12', [pinned('a', 27.7, 85.3)])]);
    expect(rows.map((r) => r.day)).toEqual([4]);
    expect(buildItineraryStops([day('2026-12-20', [pinned('b', 27.7, 85.3)])])[0].day).toBe(12);
  });

  it('a GAPPED plans array keeps every day on its real number', () => {
    // The shape a real device reaches by clearing the itinerary (D-018) and planning two
    // days: positions 1 and 2, trip days 2 and 12.
    const rows = buildItineraryPlacements([
      day('2026-12-20', [pinned('late', 27.7, 85.3)]),
      day('2026-12-10', [pinned('early', 27.7, 85.3)]),
    ]);
    expect(rows.map((r) => [r.date, r.day])).toEqual([
      ['2026-12-10', 2],
      ['2026-12-20', 12],
    ]);
  });

  it('a date outside the trip falls back to its position rather than yielding 0', () => {
    const rows = buildItineraryPlacements([day('2030-05-05', [pinned('x', 27.7, 85.3)])]);
    expect(rows[0].day).toBe(1);
  });

  it('the whole seed still numbers 1…N, so the fix is not a shift', () => {
    const rows = buildItineraryPlacements(SAMPLE_ITINERARY);
    const byDate = new Map(rows.map((r) => [r.date, r.day]));
    expect(byDate.get('2026-12-09')).toBe(1);
    expect(byDate.get('2026-12-10')).toBe(2);
    expect(byDate.get(TRIP_DATES[TRIP_DATES.length - 1])).toBe(TRIP_DATES.length);
  });
});

describe('issue #1 · seq — the pins are numbered 1, 2, 3 in itinerary order', () => {
  it('numbers a day 1..n in time order, restarting on the next day', () => {
    const stops = placementStops(
      buildItineraryPlacements([
        day('2026-12-11', [
          pinned('c', 27.72, 85.32, 15 * 60),
          pinned('a', 27.70, 85.30, 8 * 60),
          pinned('b', 27.71, 85.31, 11 * 60),
        ]),
        day('2026-12-12', [pinned('d', 27.73, 85.33, 9 * 60), pinned('e', 27.74, 85.34, 10 * 60)]),
      ]),
    );
    expect(stops.map((s) => [s.date, s.item.id, s.seq])).toEqual([
      ['2026-12-11', 'a', 1],
      ['2026-12-11', 'b', 2],
      ['2026-12-11', 'c', 3],
      ['2026-12-12', 'd', 1],
      ['2026-12-12', 'e', 2],
    ]);
  });

  it('D-281: the sequence is TIME order even when nearest-first would differ', () => {
    // Adversarial on purpose. From the 08:00 stop, the NEAREST other stop is the 19:00 one
    // (a few hundred metres away); the 11:00 stop is ~5,000 km away in Tokyo. A proximity
    // sort — the behaviour D-281 deleted — would produce 1,3,2 here. Time order gives 1,2,3.
    const stops = placementStops(
      buildItineraryPlacements([
        day('2026-12-11', [
          pinned('morning', 27.7172, 85.324, 8 * 60),
          pinned('midday-far', 35.6762, 139.6503, 11 * 60),
          pinned('evening-near', 27.7182, 85.325, 19 * 60),
        ]),
      ]),
    );
    expect(stops.map((s) => `${s.seq}:${s.item.id}`)).toEqual([
      '1:morning',
      '2:midday-far',
      '3:evening-near',
    ]);
  });

  it('counts PINS, not plans: plans sharing a coordinate share one number, and none is skipped', () => {
    // Three untimed plans with no coordinate of their own collapse onto the day's city
    // centroid (rung 5) — one pin. The next distinct place must be 2, not 4.
    const stops = placementStops(
      buildItineraryPlacements([
        day('2026-12-11', [
          { id: 'v1', title: 'Errand', category: 'free' },
          { id: 'v2', title: 'Another errand', category: 'free' },
          { id: 'v3', title: 'A third errand', category: 'free' },
          pinned('real', 27.9, 85.9),
        ]),
      ]),
    );
    expect(stops).toHaveLength(2);
    expect(stops[0].seq).toBe(1);
    expect(stops[0].items.map((i) => i.id)).toEqual(['v1', 'v2', 'v3']);
    expect(stops[1].seq).toBe(2);
  });

  it('/plan and /travel number the STORED order (their drag is the itinerary order there)', () => {
    const stops = buildItineraryStops([
      day('2026-12-11', [
        pinned('late', 27.72, 85.32, 19 * 60),
        pinned('early', 27.70, 85.30, 8 * 60),
      ]),
    ]);
    expect(stops.map((s) => `${s.seq}:${s.item.id}`)).toEqual(['1:late', '2:early']);
  });

  it('every day of the seed is numbered 1..n with no gap and no repeat', () => {
    const stops = placementStops(buildItineraryPlacements(SAMPLE_ITINERARY));
    const byDate = new Map<string, number[]>();
    for (const s of stops) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s.seq]);
    expect(byDate.size).toBeGreaterThan(0);
    for (const [date, seqs] of byDate) {
      expect(seqs, `${date} is not numbered 1..${seqs.length}`).toEqual(
        seqs.map((_, i) => i + 1),
      );
    }
  });
});

describe('issue #1 · stopsForDay — only the selected day is drawn', () => {
  const all = placementStops(buildItineraryPlacements(SAMPLE_ITINERARY));

  it('Dec 9 draws Dec 9 — not the Kathmandu plan', () => {
    // The ticket's exact symptom. Day 1 is spent in Syracuse/JFK/the air (D-315), so its
    // stops sit at New York; the Kathmandu plans belong to Dec 10 onwards.
    const dayOne = stopsForDay(all, '2026-12-09');
    expect(dayOne.length).toBeGreaterThan(0);
    expect(dayOne.length).toBeLessThan(all.length);
    expect(dayOne.every((s) => s.date === '2026-12-09')).toBe(true);
    expect(dayOne.every((s) => s.day === 1)).toBe(true);
    for (const s of dayOne) {
      expect(
        Math.abs(s.marker.lat - KATHMANDU.latitude) > 1 ||
          Math.abs(s.marker.lng - KATHMANDU.longitude) > 1,
        `a Dec 9 pin is sitting on Kathmandu: ${s.marker.id}`,
      ).toBe(true);
    }
  });

  it('a day with nothing planned CLEARS the route — an empty array, not the last day', () => {
    // The rule that stops the previous day's pins sitting there. TripMap writes an empty
    // FeatureCollection for an empty stop list, so `[]` is literally the cleared map.
    const stops = placementStops(
      buildItineraryPlacements([day('2026-12-10', [pinned('a', 27.7, 85.3)])]),
    );
    expect(stopsForDay(stops, '2026-12-11')).toEqual([]);
    // …and the day that DOES have plans is unaffected by asking for the empty one.
    expect(stopsForDay(stops, '2026-12-10')).toHaveLength(1);
  });

  it('no selected day means the whole trip, unfiltered and in the same order', () => {
    expect(stopsForDay(all, null)).toBe(all);
  });

  it('the filtered day keeps its own 1..n numbering, unrenumbered', () => {
    const dayTwo = stopsForDay(all, '2026-12-10');
    expect(dayTwo.map((s) => s.seq)).toEqual(dayTwo.map((_, i) => i + 1));
  });

  it('every trip date resolves to its own stops and nothing else', () => {
    for (const date of TRIP_DATES) {
      const scoped = stopsForDay(all, date);
      expect(scoped.every((s) => s.date === date), `leak on ${date}`).toBe(true);
    }
    // The partition is total: the days sum back to the whole trip, nothing dropped.
    const summed = TRIP_DATES.reduce((n, d) => n + stopsForDay(all, d).length, 0);
    expect(summed).toBe(all.length);
  });
});

import { describe, it, expect } from 'vitest';

// S126 — the two passive, non-destructive time views (D-142). Pure unit coverage in
// isolation from any component; reuses S124's `effectiveStartMinutes` only, no new
// parsing/offset math.

import { sortItemsByTime, clashingItemIds } from '@/lib/sort-items-by-time';
import type { ItineraryItem } from '@/lib/trip-data';
// S377 — the Jan-9 date-line regression is asserted against the REAL seed content, because
// the defect needs BOTH the per-item offsets (D-225) and the instant sort key to disappear.
import { TRIP_ITINERARY } from '@/core/content/itinerary';
import {
  effectiveOffsetMin,
  effectiveStartMinutes,
  offsetForCountry,
  placeWallClockToUtcMs,
} from '@/core/dates';

function mk(id: string, fields: Partial<ItineraryItem> = {}): ItineraryItem {
  return { id, title: id, category: 'sightseeing', ...fields };
}

// S377: the sort key is now the absolute instant, so every call needs the day it belongs to.
// These single-zone cases use one ordinary Japan day, where instant order == wall-clock order.
const DAY = '2026-12-20';
const DAY_OFFSET = 540;

describe('sortItemsByTime — stable, view-level, non-destructive (D-142)', () => {
  it('ascends by effectiveStartMinutes', () => {
    const c = mk('c', { startMinutes: 600 });
    const a = mk('a', { startMinutes: 60 });
    const b = mk('b', { startMinutes: 300 });
    const result = sortItemsByTime([c, a, b], DAY, DAY_OFFSET);
    expect(result.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('untimed items sink to the end, preserving their original relative order', () => {
    const timed = mk('timed', { startMinutes: 600 });
    const u1 = mk('u1');
    const u2 = mk('u2');
    const u3 = mk('u3');
    // Original order: u1, timed, u2, u3 — untimed items should end up after `timed`,
    // in their ORIGINAL relative order (u1, u2, u3), not reshuffled.
    const result = sortItemsByTime([u1, timed, u2, u3], DAY, DAY_OFFSET);
    expect(result.map((i) => i.id)).toEqual(['timed', 'u1', 'u2', 'u3']);
  });

  it('is stable among items sharing the same effectiveStartMinutes', () => {
    const a = mk('a', { startMinutes: 480 });
    const b = mk('b', { startMinutes: 480 });
    const c = mk('c', { startMinutes: 480 });
    const result = sortItemsByTime([c, a, b], DAY, DAY_OFFSET);
    // Equal keys: original relative order (c, a, b) preserved, not re-sorted by id.
    expect(result.map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('a legacy-only parseable `time` (no startMinutes) sorts via the effective fallback', () => {
    const early = mk('early', { time: '6:00 am' }); // 360
    const late = mk('late', { startMinutes: 900 });
    expect(sortItemsByTime([late, early], DAY, DAY_OFFSET).map((i) => i.id)).toEqual(['early', 'late']);
  });

  it('returns a NEW array and never mutates the input', () => {
    const items = [mk('b', { startMinutes: 600 }), mk('a', { startMinutes: 60 })];
    const original = [...items];
    const result = sortItemsByTime(items, DAY, DAY_OFFSET);
    expect(result).not.toBe(items);
    expect(items).toEqual(original); // input order/contents untouched
    expect(items.map((i) => i.id)).toEqual(['b', 'a']); // literally unmutated
  });

  it('all-untimed input preserves original order entirely', () => {
    const items = [mk('x'), mk('y'), mk('z')];
    expect(sortItemsByTime(items, DAY, DAY_OFFSET).map((i) => i.id)).toEqual(['x', 'y', 'z']);
  });

  it('empty input returns an empty array', () => {
    expect(sortItemsByTime([], DAY, DAY_OFFSET)).toEqual([]);
  });
});

describe('S377 — the ordering key is the ABSOLUTE INSTANT, not the wall clock (D-225 offsets)', () => {
  it('the Jan-9 date-line day: the DTW layover sorts AFTER the HND→DTW flight that produces it', () => {
    const day = TRIP_ITINERARY.find((d) => d.date === '2027-01-09')!;
    const dayOffset = offsetForCountry(day.country); // JST +540

    // The flight departs Tokyo 17:35 JST (08:35 UTC) and lands Detroit 15:35 EST (20:35 UTC)
    // the SAME calendar day, eastbound over the date line. Keyed on wall-clock minutes the
    // layover (935) sorts before the flight (1055); keyed on the instant it cannot.
    const ids = sortItemsByTime(day.items, day.date, dayOffset).map((i) => i.id);
    expect(ids).toEqual(['j22-1', 'j22-2', 'j22-3', 'j22-4', 'j22-5', 'j22-6']);

    const idx = (id: string) => ids.indexOf(id);
    expect(idx('j22-4')).toBeLessThan(idx('j22-5')); // fly before you land
    expect(idx('j22-5')).toBeLessThan(idx('j22-6')); // land before you fly on
  });

  it('the displayed wall-clock is deliberately NON-MONOTONIC on Jan-9 (D-137: no per-item badge)', () => {
    const day = TRIP_ITINERARY.find((d) => d.date === '2027-01-09')!;
    const times = sortItemsByTime(day.items, day.date, offsetForCountry(day.country)).map((i) => i.time);
    // Correctly ordered by instant, but the rendered times read 17:35 → 15:35 → 21:35.
    expect(times).toEqual(['09:00', '11:00', '13:00', '17:35', '15:35', '21:35']);
  });

  it('a per-item tzOffsetMin flips the order against the wall clock (unit, no seed data)', () => {
    const est = mk('est', { startMinutes: 935, tzOffsetMin: -300 }); // 15:35 EST → 20:35 UTC
    const jst = mk('jst', { startMinutes: 1055 }); // 17:35 JST (day offset) → 08:35 UTC
    expect(sortItemsByTime([est, jst], '2027-01-09', 540).map((i) => i.id)).toEqual(['jst', 'est']);
    // …and with no override on either, the day offset applies to both: wall-clock order.
    const estNoTz = mk('est', { startMinutes: 935 });
    expect(sortItemsByTime([estNoTz, jst], '2027-01-09', 540).map((i) => i.id)).toEqual(['est', 'jst']);
  });

  it('untimed items STILL sink to the end, in original relative order, under the instant key', () => {
    const u1 = mk('u1');
    const timed = mk('timed', { startMinutes: 600 });
    const u2 = mk('u2');
    const result = sortItemsByTime([u1, timed, u2], '2026-12-20', 540);
    expect(result.map((i) => i.id)).toEqual(['timed', 'u1', 'u2']);
  });

  it('every mixed-zone seed day is chronologically ordered by instant', () => {
    for (const date of ['2026-12-09', '2026-12-10', '2026-12-19', '2027-01-09']) {
      const day = TRIP_ITINERARY.find((d) => d.date === date)!;
      const dayOffset = offsetForCountry(day.country);
      const sorted = sortItemsByTime(day.items, day.date, dayOffset);
      const instants = sorted.map((i) =>
        placeWallClockToUtcMs(day.date, effectiveStartMinutes(i)!, effectiveOffsetMin(i, dayOffset)),
      );
      for (let k = 1; k < instants.length; k++) {
        expect(instants[k], `${date} item ${sorted[k].id} out of order`).toBeGreaterThanOrEqual(instants[k - 1]);
      }
      // the seed order IS the true chronological order on every one of these days
      expect(sorted.map((i) => i.id)).toEqual(day.items.map((i) => i.id));
    }
  });
});

describe('clashingItemIds — warn-only half-open overlap (D-142)', () => {
  it('two items with overlapping timed spans both clash', () => {
    const a = mk('a', { startMinutes: 540, durationMinutes: 60 }); // 9:00-10:00
    const b = mk('b', { startMinutes: 570, durationMinutes: 60 }); // 9:30-10:30
    const result = clashingItemIds([a, b], DAY, DAY_OFFSET);
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.size).toBe(2);
  });

  it('touching edges (a ends exactly when b starts) never clash — half-open', () => {
    const a = mk('a', { startMinutes: 540, durationMinutes: 60 }); // 9:00-10:00
    const b = mk('b', { startMinutes: 600, durationMinutes: 30 }); // 10:00-10:30
    const result = clashingItemIds([a, b], DAY, DAY_OFFSET);
    expect(result.size).toBe(0);
  });

  it('requires BOTH start and a positive duration — a timed item with no duration never clashes', () => {
    const a = mk('a', { startMinutes: 540, durationMinutes: 60 }); // 9:00-10:00
    const b = mk('b', { startMinutes: 570 }); // 9:30, no duration
    const result = clashingItemIds([a, b], DAY, DAY_OFFSET);
    expect(result.size).toBe(0);
  });

  it('a zero or negative durationMinutes never clashes (not a positive duration)', () => {
    const a = mk('a', { startMinutes: 540, durationMinutes: 60 });
    const b = mk('b', { startMinutes: 570, durationMinutes: 0 });
    expect(clashingItemIds([a, b], DAY, DAY_OFFSET).size).toBe(0);
  });

  it('an untimed item never clashes with anything', () => {
    const a = mk('a', { startMinutes: 540, durationMinutes: 60 });
    const b = mk('b'); // no time at all
    expect(clashingItemIds([a, b], DAY, DAY_OFFSET).size).toBe(0);
  });

  it('the exact overlap predicate: a.start < b.end && b.start < a.end', () => {
    // Fully nested: b inside a's span.
    const a = mk('a', { startMinutes: 540, durationMinutes: 120 }); // 9:00-11:00
    const b = mk('b', { startMinutes: 600, durationMinutes: 30 }); // 10:00-10:30
    const result = clashingItemIds([a, b], DAY, DAY_OFFSET);
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
  });

  it('a 3-item chain: only the adjacent-overlapping pair clashes, the disjoint one does not', () => {
    const a = mk('a', { startMinutes: 480, durationMinutes: 60 }); // 8:00-9:00
    const b = mk('b', { startMinutes: 540, durationMinutes: 60 }); // 9:00-10:00 (touches a, no clash)
    const c = mk('c', { startMinutes: 570, durationMinutes: 60 }); // 9:30-10:30 (overlaps b only)
    const result = clashingItemIds([a, b, c], DAY, DAY_OFFSET);
    expect(result.has('a')).toBe(false);
    expect(result.has('b')).toBe(true);
    expect(result.has('c')).toBe(true);
    expect(result.size).toBe(2);
  });

  it('a fully disjoint 3-item chain has no clashes at all', () => {
    const a = mk('a', { startMinutes: 480, durationMinutes: 30 }); // 8:00-8:30
    const b = mk('b', { startMinutes: 600, durationMinutes: 30 }); // 10:00-10:30
    const c = mk('c', { startMinutes: 720, durationMinutes: 30 }); // 12:00-12:30
    expect(clashingItemIds([a, b, c], DAY, DAY_OFFSET).size).toBe(0);
  });

  it('a legacy-only parseable `time` (no startMinutes) participates in clash detection via the fallback', () => {
    const a = mk('a', { time: '9:00 am', durationMinutes: 60 }); // 540-600
    const b = mk('b', { startMinutes: 570, durationMinutes: 30 }); // 570-600, overlaps
    const result = clashingItemIds([a, b], DAY, DAY_OFFSET);
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
  });

  it('empty input returns an empty set', () => {
    expect(clashingItemIds([], DAY, DAY_OFFSET).size).toBe(0);
  });
});

describe('S391 — clash overlap is judged on the ABSOLUTE INSTANT, like its file-mate', () => {
  // S377 moved `sortItemsByTime` to the instant and left `clashingItemIds` on raw wall-clock
  // minutes with no offset and no day. These two cases are the ONLY shape that can tell the
  // frames apart: a day holding items in different zones (D-225 `tzOffsetMin`). A clash test
  // written in the wall-clock frame passes on the broken code AND the fixed code, so both
  // assertions below are deliberately stated in UTC instants.
  //
  // ⚖️ LATENT, NOT LIVE: clash detection needs `durationMinutes`, which 0 of the 158 seed items
  // carry (the 9 tzOffsetMin overrides carry the `duration` STRING, which this code never reads).
  // Reachable only once a duration is written — the calendar editor's DurationField, the
  // add-to-itinerary dialog, or a concierge op all do that.
  const JAN9 = '2027-01-09'; // the date-line day: Japan day (+540) with two EST (-300) items
  const JST = 540;

  it('same wall clock, different zones → NOT a clash (the false-positive badge)', () => {
    // Both read 09:00 on screen, but they are 14 hours apart in real time.
    const jst = mk('jst', { startMinutes: 540, durationMinutes: 60 }); // 09:00 JST = 00:00–01:00 UTC
    const est = mk('est', { startMinutes: 540, durationMinutes: 60, tzOffsetMin: -300 }); // = 14:00–15:00 UTC
    expect(clashingItemIds([jst, est], JAN9, JST).size).toBe(0);
  });

  it('different wall clocks that DO collide as instants → a clash (the false-negative miss)', () => {
    // 17:35 JST + 12h lands at 20:35 UTC; the Detroit item runs 20:00–22:00 UTC. They genuinely
    // overlap by 35 minutes — but on the clock faces (1055.. vs 900..) they look disjoint.
    const jst = mk('jst', { startMinutes: 1055, durationMinutes: 720 }); // 08:35–20:35 UTC
    const est = mk('est', { startMinutes: 900, durationMinutes: 120, tzOffsetMin: -300 }); // 20:00–22:00 UTC
    const result = clashingItemIds([jst, est], JAN9, JST);
    expect(result.has('jst')).toBe(true);
    expect(result.has('est')).toBe(true);
    expect(result.size).toBe(2);
  });

  it('the day offset still applies to items with no override (single-zone behaviour unchanged)', () => {
    const a = mk('a', { startMinutes: 540, durationMinutes: 60 });
    const b = mk('b', { startMinutes: 570, durationMinutes: 60 });
    // Same answer at any day/offset — a shared offset shifts both instants equally.
    expect(clashingItemIds([a, b], JAN9, JST).size).toBe(2);
    expect(clashingItemIds([a, b], '2026-12-10', 345).size).toBe(2);
  });
});

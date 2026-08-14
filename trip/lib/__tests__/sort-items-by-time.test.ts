import { describe, it, expect } from 'vitest';

// S126 — the two passive, non-destructive time views (D-142). Pure unit coverage in
// isolation from any component; reuses S124's `effectiveStartMinutes` only, no new
// parsing/offset math.

import {
  sortItemsByTime,
  clashingItemIds,
  describeClash,
  firstClashWith,
  timeFootprintChanged,
} from '@/lib/sort-items-by-time';
import { parseDurationText, effectiveDurationMinutes } from '@/core/dates';
import { formatDurationText } from '@/lib/time-picker-format';
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

describe('S391: clash overlap is judged on the ABSOLUTE INSTANT, like its file-mate', () => {
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

// ── D-316 ────────────────────────────────────────────────────────────────────────────────
// Derivation-no-migration, one-predicate-one-truth, hard-refuse-delta-scoped.

/** Every `duration` string the shipped content actually holds. */
const SEED_DURATIONS = TRIP_ITINERARY.flatMap((d) =>
  (d.items ?? []).map((i) => i.duration).filter((v): v is string => typeof v === 'string'),
);

describe('D-316 — parseDurationText derives the span from the text the data already holds', () => {
  it('every seed `duration` string parses to positive minutes (all 158 of them)', () => {
    expect(SEED_DURATIONS.length).toBe(158); // the premise: the strings exist and are all here
    const failed = SEED_DURATIONS.filter((s) => {
      const v = parseDurationText(s);
      return typeof v !== 'number' || !Number.isInteger(v) || v <= 0;
    });
    expect(failed).toEqual([]);
  });

  it('the documented grammar, value by value', () => {
    expect(parseDurationText('1h')).toBe(60);
    expect(parseDurationText('1.5h')).toBe(90);
    expect(parseDurationText('1.25h')).toBe(75);
    expect(parseDurationText('3.25h')).toBe(195);
    expect(parseDurationText('14h 55m')).toBe(895);
    expect(parseDurationText('1h 10m')).toBe(70);
    expect(parseDurationText('45m')).toBe(45);
    expect(parseDurationText('30min')).toBe(30);
    // case-insensitive + trimmed
    expect(parseDurationText('  2H 30M  ')).toBe(150);
  });

  it('round-trips formatDurationText → parseDurationText over 1..1439 with zero failures', () => {
    const failures: Array<{ minutes: number; text: string; back: number | undefined }> = [];
    for (let minutes = 1; minutes <= 1439; minutes++) {
      const text = formatDurationText(minutes);
      const back = parseDurationText(text);
      if (back !== minutes) failures.push({ minutes, text, back });
    }
    expect(failures).toEqual([]);
  });

  it('anything outside the grammar is `undefined` — no throw, no log, no default', () => {
    for (const bad of ['', '   ', 'abc', '0h', '0m', '0min', '-30m', '2 hours', '90', '1h30m?', 'h', 'm', '1:30']) {
      expect(parseDurationText(bad), bad).toBeUndefined();
    }
    // TOTAL, like parseTimeString: a non-string from a raw payload does not throw.
    expect(parseDurationText(undefined as unknown as string)).toBeUndefined();
    expect(parseDurationText(42 as unknown as string)).toBeUndefined();
  });

  it('effectiveDurationMinutes: a valid positive-integer structured value wins, else the text', () => {
    expect(effectiveDurationMinutes(mk('a', { durationMinutes: 30, duration: '2h' }))).toBe(30);
    expect(effectiveDurationMinutes(mk('a', { duration: '2h' }))).toBe(120);
    // A bad structured value degrades to the text rather than asserting a bogus span.
    expect(effectiveDurationMinutes(mk('a', { durationMinutes: 0, duration: '2h' }))).toBe(120);
    expect(effectiveDurationMinutes(mk('a', { durationMinutes: -5, duration: '2h' }))).toBe(120);
    expect(effectiveDurationMinutes(mk('a', { durationMinutes: 1.5, duration: '2h' }))).toBe(120);
    // …and to `undefined` when there is no usable text either.
    expect(effectiveDurationMinutes(mk('a', { durationMinutes: 0, duration: 'whenever' }))).toBeUndefined();
    expect(effectiveDurationMinutes(mk('a'))).toBeUndefined();
  });
});

describe('D-316 — firstClashWith: ONE predicate feeding both the badge and the block', () => {
  const nine = mk('nine', { startMinutes: 540, durationMinutes: 60 }); // 9:00–10:00

  it('returns the overlapping item', () => {
    const candidate = mk('cand', { startMinutes: 570, durationMinutes: 60 }); // 9:30–10:30
    expect(firstClashWith(candidate, [nine], DAY, DAY_OFFSET)?.id).toBe('nine');
  });

  it('excludes the candidate itself — an edit-in-place cannot clash with its own stored row', () => {
    const stored = mk('same', { startMinutes: 540, durationMinutes: 60 });
    const edited = mk('same', { startMinutes: 540, durationMinutes: 60, title: 'renamed' });
    expect(firstClashWith(edited, [stored], DAY, DAY_OFFSET)).toBeUndefined();
  });

  it('excludes tombstones', () => {
    const dead = mk('dead', { startMinutes: 540, durationMinutes: 60, deleted: true });
    const candidate = mk('cand', { startMinutes: 570, durationMinutes: 60 });
    expect(firstClashWith(candidate, [dead], DAY, DAY_OFFSET)).toBeUndefined();
  });

  it('an untimed candidate never blocks', () => {
    expect(firstClashWith(mk('cand', { durationMinutes: 60 }), [nine], DAY, DAY_OFFSET)).toBeUndefined();
  });

  it('a candidate with no duration never blocks — clearing the duration IS the escape hatch', () => {
    expect(firstClashWith(mk('cand', { startMinutes: 570 }), [nine], DAY, DAY_OFFSET)).toBeUndefined();
    // the same item WITH a duration does block, so the case above is not vacuous
    expect(firstClashWith(mk('cand', { startMinutes: 570, durationMinutes: 60 }), [nine], DAY, DAY_OFFSET)?.id)
      .toBe('nine');
  });

  it('a multi-day span never blocks, on either side (clash v1 excludes spans)', () => {
    const span = mk('span', { startMinutes: 540, durationMinutes: 60, endDate: '2026-12-22' });
    expect(firstClashWith(span, [nine], DAY, DAY_OFFSET)).toBeUndefined();
    expect(firstClashWith(mk('cand', { startMinutes: 570, durationMinutes: 60 }), [span], DAY, DAY_OFFSET))
      .toBeUndefined();
  });

  it('agrees with clashingItemIds — half-open edges and the absolute instant', () => {
    // touching, never a clash
    const touching = mk('cand', { startMinutes: 600, durationMinutes: 30 }); // 10:00–10:30
    expect(firstClashWith(touching, [nine], DAY, DAY_OFFSET)).toBeUndefined();
    expect(clashingItemIds([nine, touching], DAY, DAY_OFFSET).size).toBe(0);
    // same wall clock, different zones: NOT a clash for either
    const jst = mk('jst', { startMinutes: 540, durationMinutes: 60 });
    const est = mk('est', { startMinutes: 540, durationMinutes: 60, tzOffsetMin: -300 });
    expect(firstClashWith(est, [jst], '2027-01-09', 540)).toBeUndefined();
    expect(clashingItemIds([jst, est], '2027-01-09', 540).size).toBe(0);
  });

  it('the free-text duration participates, so a seed item can now block (the whole point)', () => {
    const seedish = mk('seed', { time: '09:00', duration: '1.5h' }); // 9:00–10:30, no structured fields
    expect(firstClashWith(mk('cand', { startMinutes: 600, durationMinutes: 30 }), [seedish], DAY, DAY_OFFSET)?.id)
      .toBe('seed');
  });

  it('an empty day never blocks', () => {
    expect(firstClashWith(nine, [], DAY, DAY_OFFSET)).toBeUndefined();
  });
});

describe('D-316 — GRANDFATHERING: the guard is delta-scoped to the time footprint', () => {
  // The seed ships three deliberate containments. This is the test that keeps them editable.
  const parent = mk('parent', { startMinutes: 540, durationMinutes: 480 }); // 9:00–17:00, the USJ day
  const lunch = mk('lunch', { startMinutes: 780, durationMinutes: 60 }); // 13:00–14:00, inside it

  it('a save that does NOT move the footprint is not guarded, even though the item overlaps', () => {
    const renamed = { ...lunch, title: 'Lunch inside the park (better ramen)', notes: 'moved stalls' };
    expect(timeFootprintChanged(lunch, DAY, renamed, DAY)).toBe(false);
    // …and the guard would REFUSE it if it ran, which is what makes this test meaningful.
    expect(firstClashWith(renamed, [parent], DAY, DAY_OFFSET)?.id).toBe('parent');
  });

  it('moving the start, the span, or the day IS a footprint change', () => {
    expect(timeFootprintChanged(lunch, DAY, { ...lunch, startMinutes: 800 }, DAY)).toBe(true);
    expect(timeFootprintChanged(lunch, DAY, { ...lunch, durationMinutes: 90 }, DAY)).toBe(true);
    expect(timeFootprintChanged(lunch, DAY, lunch, '2026-12-22')).toBe(true);
  });

  it('clearing the time or the duration is a footprint change (so the freed item is re-checked)', () => {
    expect(timeFootprintChanged(lunch, DAY, { ...lunch, startMinutes: undefined }, DAY)).toBe(true);
    expect(timeFootprintChanged(lunch, DAY, { ...lunch, durationMinutes: undefined }, DAY)).toBe(true);
  });

  it('turning a multi-day span OFF is a footprint change — the exempt span becomes a plain interval', () => {
    // The reachable break: start, duration and day are all untouched, but dropping `endDate`
    // converts a clash-EXEMPT span into an ordinary interval that lands on top of `parent`.
    // Without endDate in the disjunction the guard never runs and the collision is written.
    const span = mk('span', { startMinutes: 780, durationMinutes: 60, endDate: '2026-12-22' });
    const spanOff = { ...span, endDate: undefined };
    expect(timeFootprintChanged(span, DAY, spanOff, DAY)).toBe(true);
    // …and the guard DOES refuse it once it runs, which is what makes the assertion above
    // load-bearing: the span itself was exempt, the same item without the span is not.
    expect(firstClashWith(span, [parent], DAY, DAY_OFFSET)).toBeUndefined();
    expect(firstClashWith(spanOff, [parent], DAY, DAY_OFFSET)?.id).toBe('parent');
  });

  it('the picker dual-write over a legacy-text item is NOT a footprint change', () => {
    // Re-saving a seed item through the editor writes startMinutes/durationMinutes beside
    // the text it already had. Same instant, same span — compared on the EFFECTIVE values.
    const legacy = mk('legacy', { time: '13:00', duration: '1h' });
    const dualWritten = { ...legacy, startMinutes: 780, durationMinutes: 60 };
    expect(timeFootprintChanged(legacy, DAY, dualWritten, DAY)).toBe(false);
  });
});

describe('D-316 — the copy fragment the five guarded surfaces share', () => {
  it('names the blocking item and its span', () => {
    expect(describeClash(mk('x', { title: 'Dinner', startMinutes: 1140, durationMinutes: 90 })))
      .toBe('“Dinner”, 7:00 PM–8:30 PM');
  });

  it('reads the free-text duration too, and wraps a past-midnight end as a clock label', () => {
    expect(describeClash(mk('x', { title: 'Club night', time: '23:00', duration: '3h' })))
      .toBe('“Club night”, 11:00 PM–2:00 AM');
  });
});

describe('D-316 — the shipped seed content under the now-live predicate', () => {
  const clashesOn = (date: string): string[] => {
    const day = TRIP_ITINERARY.find((d) => d.date === date)!;
    return [...clashingItemIds(day.items, day.date, offsetForCountry(day.country))].sort();
  };

  it('the three DELIBERATE containments badge, and they are the only overlaps left', () => {
    const all = TRIP_ITINERARY.flatMap((day) =>
      [...clashingItemIds(day.items, day.date, offsetForCountry(day.country))].map((id) => `${day.date}/${id}`),
    ).sort();
    expect(all).toEqual([
      '2026-12-21/j3-1', // USJ full day …
      '2026-12-21/j3-2', // … with lunch inside it
      '2026-12-23/j5-1', // Shinsekai flex block …
      '2026-12-23/j5-2', // … with lunch inside it
      '2026-12-31/j13-3', // NYE club block …
      '2026-12-31/j13-4', // … with the countdown inside it
    ]);
  });

  it('Dec 19 is clean: j1-4 hotel check-in is 45m, so it no longer runs into the 19:00 walk', () => {
    const j14 = TRIP_ITINERARY.find((d) => d.date === '2026-12-19')!.items.find((i) => i.id === 'j1-4')!;
    expect(j14.duration).toBe('45m');
    expect(effectiveDurationMinutes(j14)).toBe(45); // 18:15 + 45m = 19:00, touching, half-open
    expect(clashesOn('2026-12-19')).toEqual([]);
  });
});

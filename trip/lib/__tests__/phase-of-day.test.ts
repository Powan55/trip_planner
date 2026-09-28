import { describe, it, expect } from 'vitest';

import { phaseOfItem, groupItemsByPhase, earliestTimedItem, PHASE_LABELS } from '@/lib/phase-of-day';
import type { ItineraryItem } from '@/lib/trip-data';

function mk(id: string, fields: Partial<ItineraryItem> = {}): ItineraryItem {
  return { id, title: id, category: 'sightseeing', ...fields };
}

// A plain single-zone Nepal day — the ordering cases below are about the sort, not about
// offsets, so they all share one date and its place offset. The date-line case names its own.
const DAY = '2026-12-15';
const DAY_OFFSET = 345; // NPT

describe('phaseOfItem — boundary classification', () => {
  it('untimed -> anytime', () => {
    expect(phaseOfItem(mk('a'))).toBe('anytime');
  });
  it('05:00 -> morning (inclusive lower bound)', () => {
    expect(phaseOfItem(mk('a', { startMinutes: 5 * 60 }))).toBe('morning');
  });
  it('11:59 -> morning', () => {
    expect(phaseOfItem(mk('a', { startMinutes: 11 * 60 + 59 }))).toBe('morning');
  });
  it('12:00 -> afternoon (inclusive lower bound)', () => {
    expect(phaseOfItem(mk('a', { startMinutes: 12 * 60 }))).toBe('afternoon');
  });
  it('16:59 -> afternoon', () => {
    expect(phaseOfItem(mk('a', { startMinutes: 16 * 60 + 59 }))).toBe('afternoon');
  });
  it('17:00 -> evening (inclusive lower bound)', () => {
    expect(phaseOfItem(mk('a', { startMinutes: 17 * 60 }))).toBe('evening');
  });
  it('23:59 -> evening', () => {
    expect(phaseOfItem(mk('a', { startMinutes: 23 * 60 + 59 }))).toBe('evening');
  });
  it('00:00-04:59 (late night) -> evening', () => {
    expect(phaseOfItem(mk('a', { startMinutes: 0 }))).toBe('evening');
    expect(phaseOfItem(mk('a', { startMinutes: 4 * 60 + 59 }))).toBe('evening');
  });
  it('a legacy-only parseable `time` (no startMinutes) classifies via the effective fallback', () => {
    expect(phaseOfItem(mk('a', { time: '6:00 am' }))).toBe('morning');
  });
  it('every DayPhase has a label', () => {
    expect(Object.keys(PHASE_LABELS).sort()).toEqual(['afternoon', 'anytime', 'evening', 'morning']);
  });
});

describe('groupItemsByPhase — chronological order (owner-instructed)', () => {
  it('an all-timed, out-of-chronological-order day is SORTED by time (the reported defect)', () => {
    // The exact shape that was reported: a 3pm plan stored before a 10am one. Before the sort,
    // this printed "Afternoon" and then rendered the 10am plan underneath it. It must now come
    // out early → mid → late, with Morning heading the day.
    const late = mk('late', { startMinutes: 900 }); // 15:00 -> afternoon
    const early = mk('early', { startMinutes: 480 }); // 08:00 -> morning
    const mid = mk('mid', { startMinutes: 720 }); // 12:00 -> afternoon
    const result = groupItemsByPhase([late, early, mid], DAY, DAY_OFFSET);
    expect(result.map((r) => r.item.id)).toEqual(['early', 'mid', 'late']);
    expect(result.map((r) => r.phase)).toEqual(['morning', 'afternoon', 'afternoon']);
    // Morning heads; the first afternoon row heads; the second does not repeat the header.
    expect(result.map((r) => r.isNewPhase)).toEqual([true, true, false]);
  });

  it('a 10am plan and a 3pm plan each sit under their OWN phase header, whatever the stored order', () => {
    // Asserted in BOTH stored orders, because the defect was order-dependent: the header was
    // only wrong when the later plan happened to be stored first.
    const a = mk('a', { startMinutes: 10 * 60 }); // 10:00 -> morning
    const b = mk('b', { startMinutes: 15 * 60 }); // 15:00 -> afternoon
    for (const input of [[a, b], [b, a]]) {
      const result = groupItemsByPhase(input, DAY, DAY_OFFSET);
      expect(result.map((r) => [r.item.id, r.phase, r.isNewPhase])).toEqual([
        ['a', 'morning', true],
        ['b', 'afternoon', true],
      ]);
    }
  });

  it('ties keep their stored order (the sort is stable)', () => {
    const first = mk('first', { startMinutes: 600 });
    const second = mk('second', { startMinutes: 600 });
    expect(groupItemsByPhase([first, second], DAY, DAY_OFFSET).map((r) => r.item.id))
      .toEqual(['first', 'second']);
    expect(groupItemsByPhase([second, first], DAY, DAY_OFFSET).map((r) => r.item.id))
      .toEqual(['second', 'first']);
  });

  it('a date-line day sorts by INSTANT, so wall clocks may run backwards — and no header repeats (#589)', () => {
    // 2027-01-09, the real Tokyo -> Detroit day. The JST flight (17:35, evening) departs BEFORE
    // the EST layover it produces (15:35, afternoon) in absolute time. Chronological order is
    // therefore evening-then-afternoon by wall clock, and a rank-blind header rule would print
    // "Afternoon" a second time under "Evening". The monotonic guard is what prevents it.
    const jst = mk('jst', { startMinutes: 17 * 60 + 35 }); // 17:35 JST -> evening
    const est = mk('est', { startMinutes: 15 * 60 + 35, tzOffsetMin: -300 }); // 15:35 EST -> afternoon
    const result = groupItemsByPhase([est, jst], '2027-01-09', 540);
    // The flight sorts first because its INSTANT is earlier, despite the later wall clock.
    expect(result.map((r) => r.item.id)).toEqual(['jst', 'est']);
    expect(result.map((r) => r.phase)).toEqual(['evening', 'afternoon']);
    expect(result.map((r) => r.isNewPhase)).toEqual([true, false]);
  });

  it('untimed items move to a single trailing run, preserving their own relative order', () => {
    const u1 = mk('u1');
    const timed = mk('timed', { startMinutes: 600 }); // 10:00 -> morning
    const u2 = mk('u2');
    const u3 = mk('u3');
    const result = groupItemsByPhase([u1, timed, u2, u3], DAY, DAY_OFFSET);
    expect(result.map((r) => r.item.id)).toEqual(['timed', 'u1', 'u2', 'u3']);
    expect(result.map((r) => r.phase)).toEqual(['morning', 'anytime', 'anytime', 'anytime']);
    expect(result.map((r) => r.isNewPhase)).toEqual([true, true, false, false]);
  });

  it('consecutive same-phase items get exactly one header at the run start', () => {
    const a = mk('a', { startMinutes: 6 * 60 }); // morning
    const b = mk('b', { startMinutes: 7 * 60 }); // morning
    const c = mk('c', { startMinutes: 13 * 60 }); // afternoon
    const result = groupItemsByPhase([a, b, c], DAY, DAY_OFFSET);
    expect(result.map((r) => r.isNewPhase)).toEqual([true, false, true]);
  });

  it('never mutates the input array', () => {
    const items = [mk('b', { startMinutes: 600 }), mk('a')];
    const original = [...items];
    groupItemsByPhase(items, DAY, DAY_OFFSET);
    expect(items).toEqual(original);
  });

  it('empty input returns an empty array', () => {
    expect(groupItemsByPhase([], DAY, DAY_OFFSET)).toEqual([]);
  });
});

describe('earliestTimedItem', () => {
  it('returns the item with the smallest effectiveStartMinutes', () => {
    const late = mk('late', { startMinutes: 900 });
    const early = mk('early', { startMinutes: 480 });
    expect(earliestTimedItem([late, early])?.id).toBe('early');
  });
  it('ignores untimed items', () => {
    const u = mk('u');
    const timed = mk('timed', { startMinutes: 600 });
    expect(earliestTimedItem([u, timed])?.id).toBe('timed');
  });
  it('returns null when nothing is timed', () => {
    expect(earliestTimedItem([mk('a'), mk('b')])).toBeNull();
  });
  it('ties resolve to the first in array order', () => {
    const a = mk('a', { startMinutes: 480 });
    const b = mk('b', { startMinutes: 480 });
    expect(earliestTimedItem([a, b])?.id).toBe('a');
  });
  it('empty input returns null', () => {
    expect(earliestTimedItem([])).toBeNull();
  });
});

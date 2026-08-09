import { describe, it, expect } from 'vitest';

import { phaseOfItem, groupItemsByPhase, earliestTimedItem, PHASE_LABELS } from '@/lib/phase-of-day';
import type { ItineraryItem } from '@/lib/trip-data';

function mk(id: string, fields: Partial<ItineraryItem> = {}): ItineraryItem {
  return { id, title: id, category: 'sightseeing', ...fields };
}

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

describe('groupItemsByPhase — D-142 compatible (never re-sorts timed items)', () => {
  it('an all-timed, out-of-chronological-order day is returned in the EXACT same order (D-142 regression net)', () => {
    // Mirrors sort-clash.spec.ts's fixture: late(15:00), early(8:00), mid(12:00) — the
    // calendar view must stay in stored order (only the Home timeline sorts).
    const late = mk('late', { startMinutes: 900 });
    const early = mk('early', { startMinutes: 480 });
    const mid = mk('mid', { startMinutes: 720 });
    const result = groupItemsByPhase([late, early, mid]);
    expect(result.map((r) => r.item.id)).toEqual(['late', 'early', 'mid']);
    // late=900min=15:00 -> afternoon; early=480min=8:00 -> morning; mid=720min=12:00 -> afternoon.
    expect(result.map((r) => r.phase)).toEqual(['afternoon', 'morning', 'afternoon']);
    // Every item differs in phase from its predecessor here, so each gets a header.
    expect(result.map((r) => r.isNewPhase)).toEqual([true, true, true]);
  });

  it('untimed items move to a single trailing run, preserving their own relative order', () => {
    const u1 = mk('u1');
    const timed = mk('timed', { startMinutes: 600 }); // 10:00 -> morning
    const u2 = mk('u2');
    const u3 = mk('u3');
    const result = groupItemsByPhase([u1, timed, u2, u3]);
    expect(result.map((r) => r.item.id)).toEqual(['timed', 'u1', 'u2', 'u3']);
    expect(result.map((r) => r.phase)).toEqual(['morning', 'anytime', 'anytime', 'anytime']);
    expect(result.map((r) => r.isNewPhase)).toEqual([true, true, false, false]);
  });

  it('consecutive same-phase items get exactly one header at the run start', () => {
    const a = mk('a', { startMinutes: 6 * 60 }); // morning
    const b = mk('b', { startMinutes: 7 * 60 }); // morning
    const c = mk('c', { startMinutes: 13 * 60 }); // afternoon
    const result = groupItemsByPhase([a, b, c]);
    expect(result.map((r) => r.isNewPhase)).toEqual([true, false, true]);
  });

  it('never mutates the input array', () => {
    const items = [mk('b', { startMinutes: 600 }), mk('a')];
    const original = [...items];
    groupItemsByPhase(items);
    expect(items).toEqual(original);
  });

  it('empty input returns an empty array', () => {
    expect(groupItemsByPhase([])).toEqual([]);
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

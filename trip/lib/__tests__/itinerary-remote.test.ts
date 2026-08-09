// @vitest-environment jsdom
//
// This suite tests ONLY the three pure per-day merge primitives exported from
// itinerary-remote.ts for testability (S77's single permitted production edit:
// adding `export` to their declarations — zero behavior change). It does NOT
// exercise pushPlans, subscribeRemote, or reconcileFirstSnapshot (Firestore I/O,
// echo-suppression, reconciliation) — those stay untouched by design.
import { describe, it, expect } from 'vitest';
import { docToDayPlan, dayEquals, sanitizeDayForWrite } from '../itinerary-remote';
import type { DayPlan } from '../trip-data';

describe('docToDayPlan', () => {
  it('happy path: maps a well-formed doc verbatim', () => {
    const data = {
      date: '2026-12-20',
      country: 'japan',
      city: 'Tokyo',
      items: [{ id: 'i1', title: 'Shibuya crossing', category: 'sightseeing' }],
    };
    expect(docToDayPlan('2026-12-20', data)).toEqual({
      date: '2026-12-20',
      country: 'japan',
      city: 'Tokyo',
      items: [{ id: 'i1', title: 'Shibuya crossing', category: 'sightseeing' }],
    });
  });

  it('missing `date` field falls back to the doc id', () => {
    const data = { country: 'nepal', city: 'Kathmandu', items: [] };
    const result = docToDayPlan('2026-12-09', data);
    expect(result.date).toBe('2026-12-09');
  });

  it('wrong-typed `date` (non-string) falls back to the doc id', () => {
    const data = { date: 12345, country: 'nepal', city: 'Kathmandu', items: [] };
    const result = docToDayPlan('2026-12-09', data);
    expect(result.date).toBe('2026-12-09');
  });

  it('`country` non-"japan" (including missing) defaults to "nepal"', () => {
    expect(docToDayPlan('id1', { country: 'nepal' }).country).toBe('nepal');
    expect(docToDayPlan('id2', { country: 'atlantis' }).country).toBe('nepal');
    expect(docToDayPlan('id3', {}).country).toBe('nepal');
    expect(docToDayPlan('id4', { country: 'japan' }).country).toBe('japan');
  });

  it('missing `city` defaults to empty string', () => {
    expect(docToDayPlan('id1', { country: 'japan' }).city).toBe('');
  });

  it('wrong-typed `city` (non-string) defaults to empty string', () => {
    expect(docToDayPlan('id1', { city: 42 }).city).toBe('');
  });

  it('missing `items` defaults to []', () => {
    expect(docToDayPlan('id1', {}).items).toEqual([]);
  });

  it('non-array `items` defaults to []', () => {
    expect(docToDayPlan('id1', { items: 'not-an-array' }).items).toEqual([]);
    expect(docToDayPlan('id1', { items: {} }).items).toEqual([]);
  });
});

describe('dayEquals', () => {
  it('returns true for the same reference', () => {
    const day: DayPlan = { date: '2026-12-09', city: 'Kathmandu', country: 'nepal', items: [] };
    expect(dayEquals(day, day)).toBe(true);
  });

  it('returns true for value-equal but different references', () => {
    const a: DayPlan = {
      date: '2026-12-09',
      city: 'Kathmandu',
      country: 'nepal',
      items: [{ id: 'i1', title: 'Temple visit', category: 'cultural' }],
    };
    const b: DayPlan = {
      date: '2026-12-09',
      city: 'Kathmandu',
      country: 'nepal',
      items: [{ id: 'i1', title: 'Temple visit', category: 'cultural' }],
    };
    expect(a).not.toBe(b);
    expect(dayEquals(a, b)).toBe(true);
  });

  it('returns false when contents differ', () => {
    const a: DayPlan = { date: '2026-12-09', city: 'Kathmandu', country: 'nepal', items: [] };
    const b: DayPlan = { date: '2026-12-09', city: 'Pokhara', country: 'nepal', items: [] };
    expect(dayEquals(a, b)).toBe(false);
  });

  it('returns false when exactly one operand is undefined', () => {
    const day: DayPlan = { date: '2026-12-09', city: 'Kathmandu', country: 'nepal', items: [] };
    expect(dayEquals(undefined, day)).toBe(false);
    expect(dayEquals(day, undefined)).toBe(false);
  });

  it('returns true when BOTH operands are undefined (reference-equal check runs first)', () => {
    // `a === b` is checked before the `!a || !b` guard, so undefined === undefined
    // short-circuits to true. This is the documented, current behavior being pinned
    // (not a new assertion invented for this test) — see the `a === b` line in
    // itinerary-remote.ts's dayEquals.
    expect(dayEquals(undefined, undefined)).toBe(true);
  });
});

describe('sanitizeDayForWrite', () => {
  it('drops undefined-valued optional fields', () => {
    const day: DayPlan = {
      date: '2026-12-09',
      city: 'Kathmandu',
      country: 'nepal',
      items: [
        {
          id: 'i1',
          title: 'Temple visit',
          category: 'cultural',
          time: undefined,
          notes: undefined,
          sourceId: undefined,
        },
      ],
    };
    const sanitized = sanitizeDayForWrite(day);
    const sanitizedItems = (sanitized as unknown as DayPlan).items;
    expect(sanitizedItems[0]).not.toHaveProperty('time');
    expect(sanitizedItems[0]).not.toHaveProperty('notes');
    expect(sanitizedItems[0]).not.toHaveProperty('sourceId');
    expect(sanitizedItems[0]).toEqual({ id: 'i1', title: 'Temple visit', category: 'cultural' });
  });

  it('returns a deep clone — mutating the result does not touch the input', () => {
    const day: DayPlan = {
      date: '2026-12-09',
      city: 'Kathmandu',
      country: 'nepal',
      items: [{ id: 'i1', title: 'Temple visit', category: 'cultural' }],
    };
    const sanitized = sanitizeDayForWrite(day) as unknown as DayPlan;
    sanitized.city = 'Mutated';
    sanitized.items[0].title = 'Mutated title';
    expect(day.city).toBe('Kathmandu');
    expect(day.items[0].title).toBe('Temple visit');
  });
});

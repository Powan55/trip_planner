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

  // RE-POINTED (D-303, owner sign-off). This assertion used to pin "anything not 'japan'
  // becomes 'nepal'". `DayPlan.country` is a LEG ID, not a nepal/japan union, and a custom
  // trip's single leg is 'main' — so that pin was holding a real bug in place: a synced custom
  // trip lost its leg id on every authoritative snapshot, and `pushDayMerged` wrote the coerced
  // value back to Firestore. The mapper now mirrors the Vault read schema's `z.string().min(1)`.
  // The DEFAULT-pack rows below are unchanged, which is the point: nepal/japan still map exactly
  // as before, so this is a widening, not a behavior swap.
  it('`country` passes a leg id through; missing/blank/wrong-typed defaults to "nepal"', () => {
    expect(docToDayPlan('id1', { country: 'nepal' }).country).toBe('nepal');
    expect(docToDayPlan('id2', { country: 'japan' }).country).toBe('japan');
    // The custom-trip leg id — the case the old coercion silently destroyed.
    expect(docToDayPlan('id3', { country: 'main' }).country).toBe('main');
    // An id this build does not know still passes through: every consumer is TOTAL on an
    // unknown leg (legCurrency → 'USD', offsetForCountry → NPT, legLabel → capitalized raw id),
    // so degrading gracefully no longer requires lying about which leg the day belongs to.
    expect(docToDayPlan('id4', { country: 'atlantis' }).country).toBe('atlantis');
    // ABSENT / blank / wrong-typed still defaults — the mapper stays total.
    expect(docToDayPlan('id5', {}).country).toBe('nepal');
    expect(docToDayPlan('id6', { country: '' }).country).toBe('nepal');
    expect(docToDayPlan('id7', { country: 42 }).country).toBe('nepal');
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

  // #123 — the poison remote item. A `null` (or otherwise unsalvageable) element used to be
  // cast straight through, and `mergeItems` then threw on `it.id` while assembling the
  // snapshot, so the whole day set never reached savePlans on ANY device.
  it('drops unsalvageable items and keeps every good one in the same array', () => {
    const good = { id: 'i1', title: 'Shibuya crossing', category: 'sightseeing' };
    const alsoGood = { id: 'i2', title: 'Ramen', category: 'food' };
    const day = docToDayPlan('2026-12-20', {
      date: '2026-12-20',
      country: 'japan',
      city: 'Tokyo',
      items: [
        null, // the reported poison value
        undefined,
        'not-an-object',
        42,
        good,
        { title: 'no id', category: 'food' },
        { id: '   ', title: 'blank id', category: 'food' }, // blank id is not a usable merge key
        { id: 'no-title', category: 'food' },
        alsoGood,
      ],
    });
    expect(day.items).toEqual([good, alsoGood]);
  });

  it('a poisoned day still merges — every downstream id read is safe', () => {
    const day = docToDayPlan('2026-12-20', {
      items: [null, { id: 'i1', title: 'Kept', category: 'food' }],
    });
    // The exact dereference that used to throw (core/sync/merge-items.ts keys on `it.id`).
    expect(() => day.items.map((it) => it.id.length)).not.toThrow();
  });

  it('a surviving item keeps unknown forward keys and defaults nothing that was absent', () => {
    const day = docToDayPlan('2026-12-20', {
      items: [{ id: 'i1', title: 'X', category: 'food', futureField: { a: 1 } }],
    });
    expect(day.items[0]).toEqual({ id: 'i1', title: 'X', category: 'food', futureField: { a: 1 } });
    // No rev/hlc/deleted invented here — that is defaultDayForMerge's job, not the mapper's.
    expect(Object.keys(day.items[0])).toEqual(['id', 'title', 'category', 'futureField']);
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

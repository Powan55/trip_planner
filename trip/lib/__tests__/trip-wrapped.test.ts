import { describe, it, expect } from 'vitest';

/**
 * S219 — Trip Wrapped pure derivation (D-016/D-099). `core/recap/wrapped.ts` composes EXISTING
 * pure selectors (`expensesToSpent`, `packingProgress`, `docsCompletion`, `elapsedTripDates`/
 * `isPostTrip`) into one headline-stat summary — these tests pin `deriveWrapped` against an
 * empty-everything input, a mid-trip mixed-data input (exact numbers, incl. top-category-per-leg
 * tie-breaking), and a fully post-trip input.
 */

import { deriveWrapped, type WrappedInputs } from '@/core/recap/wrapped';
import { TRIP_DATES } from '@/core/dates';
import type { DayPlan } from '@/lib/trip-data';
import type { Expense } from '@/core/budget/expenses';
import type { JournalEntry } from '@/core/journal/model';
import type { PhotoMeta } from '@/core/photos/model';
import type { PackingItem } from '@/core/packing/model';
import type { DocItem } from '@/core/docs/model';

const EMPTY_INPUTS: WrappedInputs = {
  plans: [],
  expenses: [],
  journalEntries: [],
  photos: [],
  packingItems: [],
  docItems: [],
};

describe('deriveWrapped — empty data', () => {
  it('every count is zero and status is "pre" for a malformed/blank clock', () => {
    const stats = deriveWrapped(EMPTY_INPUTS, '');
    expect(stats).toEqual({
      status: 'pre',
      daysElapsed: 0,
      totalTripDays: TRIP_DATES.length,
      activitiesDone: 0,
      activitiesPlanned: 0,
      spend: {
        nepal: { total: 0, topCategory: null },
        japan: { total: 0, topCategory: null },
      },
      journalCount: 0,
      photoCount: 0,
      packing: { checked: 0, total: 0 },
      docs: { done: 0, total: 0 },
    });
  });

  it('null/undefined domain inputs degrade to the same zero values (TOTAL, never throws)', () => {
    const stats = deriveWrapped(
      { plans: null, expenses: undefined, journalEntries: null, photos: undefined, packingItems: null, docItems: undefined },
      TRIP_DATES[0],
    );
    expect(stats.activitiesPlanned).toBe(0);
    expect(stats.journalCount).toBe(0);
    expect(stats.photoCount).toBe(0);
    expect(stats.packing).toEqual({ checked: 0, total: 0 });
    expect(stats.docs).toEqual({ done: 0, total: 0 });
    expect(stats.spend.nepal.topCategory).toBeNull();
  });

  it('pre-trip: before the first trip date, daysElapsed is 0 and status is "pre"', () => {
    const stats = deriveWrapped(EMPTY_INPUTS, '2026-01-01');
    expect(stats.status).toBe('pre');
    expect(stats.daysElapsed).toBe(0);
  });
});

describe('deriveWrapped — mid-trip mixed data', () => {
  const MID_DAY = TRIP_DATES[4]; // some elapsed days, not the whole trip

  const plans: DayPlan[] = [
    {
      date: TRIP_DATES[0],
      city: 'Kathmandu',
      country: 'nepal',
      items: [
        { id: 'a', title: 'Boudhanath', category: 'sightseeing', done: true },
        { id: 'b', title: 'Thamel walk', category: 'shopping', done: false },
      ],
    },
    {
      date: TRIP_DATES[1],
      city: 'Kathmandu',
      country: 'nepal',
      items: [{ id: 'c', title: 'Free day', category: 'free' }], // done absent = not done
    },
  ];

  const expenses: Expense[] = [
    { id: 'e1', leg: 'nepal', category: 'food', amount: 1000, createdAt: 't1' },
    { id: 'e2', leg: 'nepal', category: 'food', amount: 500, createdAt: 't2' },
    { id: 'e3', leg: 'nepal', category: 'shopping', amount: 800, createdAt: 't3' },
    { id: 'e4', leg: 'japan', category: 'transportation', amount: 3000, createdAt: 't4' },
  ];

  const journalEntries: JournalEntry[] = [
    { date: TRIP_DATES[0], text: 'Day one!', createdAt: 't1', updatedAt: 't1' },
  ];

  const photos: PhotoMeta[] = [
    { id: 'p1', owner: { kind: 'journal', date: TRIP_DATES[0] }, altText: 'a', w: 10, h: 10, bytes: 100, createdAt: 't1' },
    { id: 'p2', owner: { kind: 'journal', date: TRIP_DATES[0] }, altText: 'b', w: 10, h: 10, bytes: 100, createdAt: 't2' },
  ];

  const packingItems: PackingItem[] = [
    { id: 'pk1', label: 'Boots', category: 'nepal', checked: true },
    { id: 'pk2', label: 'Coat', category: 'japan', checked: false },
  ];

  const docItems: DocItem[] = [
    { id: 'd1', section: 'critical', label: 'Passport', checked: true },
    { id: 'd2', section: 'critical', label: 'Visa', checked: false },
    { id: 'd3', section: 'dayzero', label: 'Check-in', checked: false },
  ];

  const inputs: WrappedInputs = { plans, expenses, journalEntries, photos, packingItems, docItems };

  it('derives exact activity, spend, journal, photo, packing and docs counts', () => {
    const stats = deriveWrapped(inputs, MID_DAY);

    expect(stats.status).toBe('mid');
    expect(stats.daysElapsed).toBe(5); // TRIP_DATES[0..4] inclusive
    expect(stats.totalTripDays).toBe(TRIP_DATES.length);

    expect(stats.activitiesPlanned).toBe(3);
    expect(stats.activitiesDone).toBe(1);

    // Nepal: 1000+500 food, 800 shopping = 2300 total, top category = food (1500).
    expect(stats.spend.nepal.total).toBe(2300);
    expect(stats.spend.nepal.topCategory).toEqual({ category: 'food', amount: 1500 });

    // Japan: single 3000 transportation expense.
    expect(stats.spend.japan.total).toBe(3000);
    expect(stats.spend.japan.topCategory).toEqual({ category: 'transportation', amount: 3000 });

    expect(stats.journalCount).toBe(1);
    expect(stats.photoCount).toBe(2);
    expect(stats.packing).toEqual({ checked: 1, total: 2 });
    expect(stats.docs).toEqual({ done: 1, total: 3 });
  });

  it('post-trip clock: status flips to "post" and daysElapsed covers every trip day', () => {
    const stats = deriveWrapped(inputs, '2099-01-01');
    expect(stats.status).toBe('post');
    expect(stats.daysElapsed).toBe(TRIP_DATES.length);
    // The composed domain counts are unaffected by the clock — same mixed data as above.
    expect(stats.activitiesDone).toBe(1);
    expect(stats.journalCount).toBe(1);
  });
});

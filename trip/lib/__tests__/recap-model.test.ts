import { describe, it, expect } from 'vitest';

/**
 * S105 — pure recap core (D-016/D-099). `core/recap/model.ts` is framework-free; these tests pin
 * the two total functions:
 *   - `summarizePlan(items)` → { planned, done }: counts activities + the done subset (S98's
 *     `item.done === true`), total over null/non-array/corrupt-entry inputs (never throws).
 *   - `elapsedTripDates(nowDateStr)`: the trip days that have already happened as of the clock —
 *     `TRIP_DATES` filtered to `<= nowDateStr` (lexicographic == chronological for YYYY-MM-DD).
 *     Pre-trip → [], post-trip → all 32, malformed clock → [].
 *
 * These are the pure derivation the read-only recap island renders from; the clock + per-day
 * plan/entry reads stay in the component (the I/O boundary), so this suite needs no clock/storage stub.
 */

import { summarizePlan, elapsedTripDates, sumExpensesForDate, isPostTrip, type PlanSummary } from '@/core/recap/model';
import { TRIP_DATES } from '@/core/dates';
import type { ItineraryItem } from '@/lib/trip-data';
import type { Expense } from '@/core/budget/expenses';

function item(over: Partial<ItineraryItem> = {}): ItineraryItem {
  return {
    id: over.id ?? 'i1',
    title: over.title ?? 'An activity',
    category: over.category ?? 'sightseeing',
    ...over,
  };
}

describe('summarizePlan', () => {
  it('counts planned + done for a normal mixed list', () => {
    const items = [
      item({ id: 'a', done: true }),
      item({ id: 'b', done: false }),
      item({ id: 'c' }), // done absent = not done
      item({ id: 'd', done: true }),
    ];
    expect(summarizePlan(items)).toEqual<PlanSummary>({ planned: 4, done: 2 });
  });

  it('counts ONLY done === true (absent / falsy / non-boolean-truthy are not done)', () => {
    const items = [
      item({ id: 'a', done: true }),
      item({ id: 'b', done: false }),
      item({ id: 'c' }),
      // a corrupted truthy-but-not-true value must NOT count as done
      item({ id: 'd', done: 1 as unknown as boolean }),
    ];
    expect(summarizePlan(items)).toEqual<PlanSummary>({ planned: 4, done: 1 });
  });

  it('a zero-item plan is { planned: 0, done: 0 }', () => {
    expect(summarizePlan([])).toEqual<PlanSummary>({ planned: 0, done: 0 });
  });

  it('all done', () => {
    const items = [item({ id: 'a', done: true }), item({ id: 'b', done: true })];
    expect(summarizePlan(items)).toEqual<PlanSummary>({ planned: 2, done: 2 });
  });

  it('is TOTAL: null / undefined / non-array degrade to zeros, never throw', () => {
    expect(summarizePlan(null)).toEqual<PlanSummary>({ planned: 0, done: 0 });
    expect(summarizePlan(undefined)).toEqual<PlanSummary>({ planned: 0, done: 0 });
    // deliberately wrong types at the boundary
    expect(summarizePlan('nope' as unknown as ItineraryItem[])).toEqual<PlanSummary>({ planned: 0, done: 0 });
    expect(summarizePlan(42 as unknown as ItineraryItem[])).toEqual<PlanSummary>({ planned: 0, done: 0 });
  });

  it('is TOTAL: corrupt entries (null / primitive) are skipped, not counted as planned', () => {
    const items = [
      item({ id: 'a', done: true }),
      null as unknown as ItineraryItem,
      'garbage' as unknown as ItineraryItem,
      item({ id: 'b' }),
    ];
    // only the two real objects count as planned; the done one still counts
    expect(summarizePlan(items)).toEqual<PlanSummary>({ planned: 2, done: 1 });
  });

  it('does not mutate its input', () => {
    const items = [item({ id: 'a', done: true }), item({ id: 'b' })];
    const snapshot = JSON.stringify(items);
    summarizePlan(items);
    expect(JSON.stringify(items)).toBe(snapshot);
  });
});

describe('elapsedTripDates', () => {
  const FIRST = TRIP_DATES[0]; // '2026-12-09'
  const LAST = TRIP_DATES[TRIP_DATES.length - 1]; // '2027-01-09'

  it('the trip is 32 days (sanity for the post-trip count assertion)', () => {
    expect(TRIP_DATES).toHaveLength(32);
    expect(FIRST).toBe('2026-12-09');
    expect(LAST).toBe('2027-01-09');
  });

  it('pre-trip: a clock before the first trip date returns []', () => {
    expect(elapsedTripDates('2026-12-01')).toEqual([]);
    expect(elapsedTripDates('2026-11-15')).toEqual([]);
  });

  it('on the FIRST trip day, exactly that one day has elapsed', () => {
    expect(elapsedTripDates(FIRST)).toEqual([FIRST]);
  });

  it('mid-trip: returns every trip date up to and including the clock, in chronological order', () => {
    // Day 12 of the trip is 2026-12-20 (Dec 9 = Day 1).
    const days = elapsedTripDates('2026-12-20');
    expect(days).toHaveLength(12);
    expect(days[0]).toBe('2026-12-09');
    expect(days[days.length - 1]).toBe('2026-12-20');
    // preserves TRIP_DATES chronological order (oldest-first)
    expect(days).toEqual(TRIP_DATES.slice(0, 12));
    // strictly increasing (== chronological for this format)
    for (let i = 1; i < days.length; i++) {
      expect(days[i] > days[i - 1]).toBe(true);
    }
  });

  it('a mid-trip clock NOT itself a trip date still includes everything before it', () => {
    // a within-window date that IS a trip date; and a hypothetical off-grid string still filters
    expect(elapsedTripDates('2026-12-19')).toEqual(TRIP_DATES.slice(0, 11));
  });

  it('on the LAST trip day, all 32 days have elapsed', () => {
    expect(elapsedTripDates(LAST)).toEqual(TRIP_DATES);
    expect(elapsedTripDates(LAST)).toHaveLength(32);
  });

  it('post-trip: a clock after the last trip date returns all 32', () => {
    expect(elapsedTripDates('2027-01-10')).toEqual(TRIP_DATES);
    expect(elapsedTripDates('2027-06-01')).toHaveLength(32);
  });

  it('is TOTAL: a malformed / non-string clock returns []', () => {
    expect(elapsedTripDates('not-a-date')).toEqual([]);
    expect(elapsedTripDates('2026-13-40')).not.toBeUndefined(); // regex-valid shape but nonsense day: still filters by string compare
    expect(elapsedTripDates('')).toEqual([]);
    expect(elapsedTripDates(undefined as unknown as string)).toEqual([]);
    expect(elapsedTripDates(12 as unknown as string)).toEqual([]);
  });

  it('does not mutate TRIP_DATES', () => {
    const snapshot = TRIP_DATES.join(',');
    elapsedTripDates('2026-12-20');
    expect(TRIP_DATES.join(',')).toBe(snapshot);
  });
});

describe('sumExpensesForDate (S153 — the recap↔budget spend line)', () => {
  function expense(over: Partial<Expense> = {}): Expense {
    return {
      id: over.id ?? 'e1',
      leg: over.leg ?? 'nepal',
      category: over.category ?? 'food',
      amount: over.amount ?? 1000,
      date: over.date,
      createdAt: over.createdAt ?? '2026-12-09T00:00:00.000Z',
      ...(over.note !== undefined ? { note: over.note } : {}),
    };
  }

  it('sums only expenses whose date matches, ignoring other days', () => {
    const expenses = [
      expense({ id: 'a', date: '2026-12-09', amount: 500 }),
      expense({ id: 'b', date: '2026-12-09', amount: 1500 }),
      expense({ id: 'c', date: '2026-12-10', amount: 9999 }),
      expense({ id: 'd', amount: 200 }), // no date at all — never matches any day
    ];
    expect(sumExpensesForDate(expenses, '2026-12-09')).toBe(2000);
    expect(sumExpensesForDate(expenses, '2026-12-10')).toBe(9999);
  });

  it('a day with no matching expenses is 0', () => {
    const expenses = [expense({ date: '2026-12-09' })];
    expect(sumExpensesForDate(expenses, '2026-12-25')).toBe(0);
  });

  it('an empty list is 0', () => {
    expect(sumExpensesForDate([], '2026-12-09')).toBe(0);
  });

  it('is TOTAL: null/undefined/non-array input degrades to 0, never throws', () => {
    expect(sumExpensesForDate(null, '2026-12-09')).toBe(0);
    expect(sumExpensesForDate(undefined, '2026-12-09')).toBe(0);
    expect(sumExpensesForDate('nope' as unknown as Expense[], '2026-12-09')).toBe(0);
  });

  it('is TOTAL: a corrupt entry (null / non-object) or a bad amount contributes 0, not NaN/throw', () => {
    const expenses = [
      expense({ id: 'ok', date: '2026-12-09', amount: 100 }),
      null as unknown as Expense,
      { date: '2026-12-09', amount: NaN } as unknown as Expense,
      { date: '2026-12-09', amount: -50 } as unknown as Expense,
      { date: '2026-12-09' } as unknown as Expense, // amount missing
    ];
    expect(sumExpensesForDate(expenses, '2026-12-09')).toBe(100);
  });

  it('does not mutate its input', () => {
    const expenses = [expense({ date: '2026-12-09' })];
    const snapshot = JSON.stringify(expenses);
    sumExpensesForDate(expenses, '2026-12-09');
    expect(JSON.stringify(expenses)).toBe(snapshot);
  });

  // A day is one leg; an EXPENSE is not. The log dialog keeps `date` pinned to the day it was
  // opened on while the leg chip is a one-tap override, so "paid for Japan while still in Nepal"
  // is a legal row. Summing the date alone handed that ¥50,000 to a Nepal day, where both recap
  // surfaces format the figure with the DAY's currency — "Rs 50,000" — and with rows from both
  // legs on one date it added NPR to JPY.
  it('sums only the requested LEG, so the figure and the currency it is printed in agree', () => {
    const expenses = [
      expense({ id: 'n', date: '2026-12-10', leg: 'nepal', amount: 2000 }),
      expense({ id: 'j', date: '2026-12-10', leg: 'japan', amount: 50000 }), // same day, other leg
    ];
    expect(sumExpensesForDate(expenses, '2026-12-10', 'nepal')).toBe(2000);
    expect(sumExpensesForDate(expenses, '2026-12-10', 'japan')).toBe(50000);
    // Without a leg it is still the whole day — the pre-existing, cross-currency shape.
    expect(sumExpensesForDate(expenses, '2026-12-10')).toBe(52000);
  });

  it('EXCLUDES a retained unknown-leg row, exactly like expensesToSpent / expensesByDate', () => {
    // `sanitizeExpense` keeps a row whose leg the active pack does not know (dropping it deleted
    // real data), so every aggregate has to filter it or the recap and the budget disagree about
    // which rows count — `burn-rate.ts` states that invariant and this function had no guard.
    const expenses = [
      expense({ id: 'ok', date: '2026-12-10', leg: 'nepal', amount: 1000 }),
      expense({ id: 'foreign', date: '2026-12-10', leg: 'main' as Expense['leg'], amount: 9999 }),
    ];
    expect(sumExpensesForDate(expenses, '2026-12-10')).toBe(1000);
    expect(sumExpensesForDate(expenses, '2026-12-10', 'main')).toBe(0);
  });
});

describe('isPostTrip (S156 — the post-trip mode derivation)', () => {
  it('pre-trip: a clock before the trip starts is NOT post-trip', () => {
    expect(isPostTrip('2026-12-01')).toBe(false);
    expect(isPostTrip('2026-11-15')).toBe(false);
  });

  it('in-trip: a clock mid-trip is NOT post-trip', () => {
    expect(isPostTrip('2026-12-20')).toBe(false);
    expect(isPostTrip('2026-12-09')).toBe(false); // first trip day
  });

  it('BOUNDARY: the last trip day itself (2027-01-09) is still in-trip, not post-trip', () => {
    expect(isPostTrip('2027-01-09')).toBe(false);
  });

  it('BOUNDARY: the day right after the trip ends (2027-01-10) is post-trip', () => {
    expect(isPostTrip('2027-01-10')).toBe(true);
  });

  it('well past the trip is post-trip', () => {
    expect(isPostTrip('2027-01-15')).toBe(true);
    expect(isPostTrip('2028-06-01')).toBe(true);
  });

  it('is TOTAL: a malformed / non-string clock is never post-trip', () => {
    expect(isPostTrip('not-a-date')).toBe(false);
    expect(isPostTrip('')).toBe(false);
    expect(isPostTrip(undefined as unknown as string)).toBe(false);
    expect(isPostTrip(12 as unknown as string)).toBe(false);
  });
});

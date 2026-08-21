import { describe, it, expect } from 'vitest';

/**
 * S103 — pure burn-rate + per-day bucketing core (D-016/D-099). `core/budget/burn-rate.ts` is
 * framework-free; these tests pin the TIME math (`burnRate` — inclusive daysElapsed at every trip
 * boundary, the daily budget/avg, the projected-at-pace total, and the under/on/over indicator with
 * its ±5% band) and the per-day aggregator (`expensesByDate` — leg-local per-day sums, undated
 * exclusion, malformed totality). The trip window (32 days, 2026-12-09 … 2027-01-09) comes from the
 * SAME `core/dates` backbone the app uses, so the boundaries here match the real calendar.
 *
 * Clock instants are constructed at LOCAL noon (`new Date(y, m-1, d, 12, 0, 0)`) — the exact shape
 * `lib/trip-now.ts` resolves a `?today=` override to — so the elapsed-day diff is exercised the way
 * production computes it, TZ-independently (the FU-10 suite runs under TZ=America/New_York).
 */

import { burnRate, expensesByDate } from '@/core/budget/burn-rate';
import { getCountryForDate } from '@/core/dates';
import { sumExpensesForDate } from '@/core/recap/model';
import type { Expense } from '@/core/budget/expenses';

/** Local-noon Date for a 'YYYY-MM-DD' — mirrors lib/trip-now.ts's override resolution. */
function localNoon(dateStr: string): Date {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(y, mo - 1, d, 12, 0, 0, 0);
}

function exp(over: Partial<Expense> = {}): Expense {
  return {
    id: 'e1',
    leg: 'nepal',
    category: 'food',
    amount: 1000,
    createdAt: '2026-12-10T09:00:00.000Z',
    ...over,
  };
}

describe('burnRate — the TIME dimension over the home-currency totals', () => {
  it('pre-trip: 0 elapsed, all days remaining, no realised burn, projected 0, pace under', () => {
    const b = burnRate(3200, 0, localNoon('2026-11-15')); // a month before departure
    expect(b.daysTotal).toBe(32);
    expect(b.daysElapsed).toBe(0);
    expect(b.daysRemaining).toBe(32);
    expect(b.percentElapsed).toBe(0);
    expect(b.dailyAvgSpent).toBe(0); // ÷0 guarded → 0, not NaN
    expect(b.projectedTotalHome).toBe(0);
    expect(b.pace).toBe('under'); // no realised spend against a real budget
    expect(b.dailyBudget).toBeCloseTo(100, 6); // 3200 / 32
  });

  it('the very first trip day (Dec 9) counts as 1 elapsed (inclusive) — daily avg is ÷1, not ÷0', () => {
    const b = burnRate(3200, 100, localNoon('2026-12-09'));
    expect(b.daysElapsed).toBe(1);
    expect(b.daysRemaining).toBe(31);
    expect(b.dailyAvgSpent).toBeCloseTo(100, 6); // 100 / 1
    expect(b.projectedTotalHome).toBeCloseTo(3200, 6); // 100 * 32 — exactly on the $100/day plan
    expect(b.pace).toBe('on'); // projected == budget, inside the band
  });

  it('mid-trip Day 4 (Dec 12): inclusive elapsed = 4, and pace reads UNDER when spending slowly', () => {
    const b = burnRate(3200, 200, localNoon('2026-12-12')); // spent 200 over 4 days = 50/day
    expect(b.daysElapsed).toBe(4);
    expect(b.daysRemaining).toBe(28);
    expect(b.percentElapsed).toBeCloseTo(4 / 32, 6);
    expect(b.dailyAvgSpent).toBeCloseTo(50, 6); // 200 / 4
    expect(b.projectedTotalHome).toBeCloseTo(1600, 6); // 50 * 32 — half the 3200 budget
    expect(b.pace).toBe('under');
  });

  it('mid-trip pace ON: projecting right around the budget lands inside the ±5% band', () => {
    // Day 4, spent 400 → 100/day → projected 3200 == budget exactly → on.
    expect(burnRate(3200, 400, localNoon('2026-12-12')).pace).toBe('on');
    // A hair under (projected 3040, within −5% of 3200) still reads 'on'.
    // spent = 380 over 4 days = 95/day → 3040 projected (95% of budget) → on.
    expect(burnRate(3200, 380, localNoon('2026-12-12')).pace).toBe('on');
  });

  it('mid-trip pace OVER: burning faster than the plan projects past the budget + band', () => {
    // Day 4, spent 800 → 200/day → projected 6400 (2x budget) → over.
    const b = burnRate(3200, 800, localNoon('2026-12-12'));
    expect(b.dailyAvgSpent).toBeCloseTo(200, 6);
    expect(b.projectedTotalHome).toBeCloseTo(6400, 6);
    expect(b.pace).toBe('over');
    expect(b.remainingHome).toBe(2400); // 3200 − 800 (signed remaining, still positive here)
  });

  it('post-trip (Jan 9, the last day) and beyond: all 32 days elapsed, none remaining', () => {
    const last = burnRate(3200, 3000, localNoon('2027-01-09'));
    expect(last.daysElapsed).toBe(32);
    expect(last.daysRemaining).toBe(0);
    expect(last.percentElapsed).toBe(1);
    expect(last.dailyAvgSpent).toBeCloseTo(3000 / 32, 6);
    expect(last.projectedTotalHome).toBeCloseTo(3000, 6); // pace * 32 ≈ the actual total by the end

    const after = burnRate(3200, 3000, localNoon('2027-02-01')); // well after the trip
    expect(after.daysElapsed).toBe(32);
    expect(after.daysRemaining).toBe(0);
  });

  it('the day BEFORE the trip (Dec 8) is still 0 elapsed; the day AFTER the end (Jan 10) is full', () => {
    expect(burnRate(3200, 0, localNoon('2026-12-08')).daysElapsed).toBe(0);
    expect(burnRate(3200, 0, localNoon('2027-01-10')).daysElapsed).toBe(32);
  });

  it('over budget mid-trip: remainingHome goes NEGATIVE (matches rollUp — no clamp)', () => {
    const b = burnRate(1000, 1500, localNoon('2026-12-12'));
    expect(b.remainingHome).toBe(-500);
    expect(b.percentSpent).toBeCloseTo(1.5, 6); // 150% spent — the bar caller clamps, the number doesn't
    expect(b.pace).toBe('over');
  });

  it('budget-0 safety: no divide-by-zero, no NaN; pace is on with no spend, over with any spend', () => {
    const none = burnRate(0, 0, localNoon('2026-12-12'));
    expect(none.dailyBudget).toBe(0);
    expect(none.percentSpent).toBe(0); // ÷0 guarded
    expect(none.pace).toBe('on'); // nothing spent against no budget → not "over"
    expect(Number.isNaN(none.percentSpent)).toBe(false);

    const some = burnRate(0, 500, localNoon('2026-12-12'));
    expect(some.pace).toBe('over'); // any spend against a zero budget is over
    expect(some.remainingHome).toBe(-500);
    expect(Number.isFinite(some.dailyAvgSpent)).toBe(true);
  });

  it('is TOTAL — NaN / negative / non-Date inputs degrade to safe numbers, never throw', () => {
    // Bad budget/spent → sanitized to 0 via safeAmount.
    const badMoney = burnRate(NaN, -50, localNoon('2026-12-12'));
    expect(badMoney.budgetHome).toBe(0);
    expect(badMoney.spentHome).toBe(0);
    expect(badMoney.pace).toBe('on');
    // Invalid Date → treated as pre-trip (0 elapsed), no throw.
    const badClock = burnRate(3200, 100, new Date('not-a-date'));
    expect(badClock.daysElapsed).toBe(0);
    expect(badClock.dailyAvgSpent).toBe(0);
    expect(Number.isNaN(badClock.projectedTotalHome)).toBe(false);
  });
});

describe('expensesByDate — leg-local per-day buckets for the calendar overlay', () => {
  it('empty / null / undefined → {}', () => {
    expect(expensesByDate([])).toEqual({});
    expect(expensesByDate(null)).toEqual({});
    expect(expensesByDate(undefined)).toEqual({});
  });

  it('sums DATED expenses per day, accumulating same-day amounts (leg-local, no conversion)', () => {
    const byDate = expensesByDate([
      exp({ id: 'a', date: '2026-12-12', leg: 'nepal', amount: 1000 }),
      exp({ id: 'b', date: '2026-12-12', leg: 'nepal', amount: 500 }), // same day accumulates
      exp({ id: 'c', date: '2026-12-13', leg: 'nepal', amount: 300 }),
    ]);
    expect(byDate).toEqual({ '2026-12-12': 1500, '2026-12-13': 300 });
  });

  it('buckets across BOTH legs by their own dates (a day is one leg — amounts stay leg-local)', () => {
    const byDate = expensesByDate([
      exp({ id: 'n', date: '2026-12-12', leg: 'nepal', category: 'food', amount: 2000 }), // NPR day
      exp({ id: 'j', date: '2026-12-25', leg: 'japan', category: 'hotel', amount: 18000 }), // JPY day
    ]);
    expect(byDate['2026-12-12']).toBe(2000);
    expect(byDate['2026-12-25']).toBe(18000);
  });

  it("a row whose OWN leg is not the day's leg contributes to no day, and matches the recap seam", () => {
    // Dec 12 is a NEPAL day. The Japan row is the one the log dialog makes by default: `date` stays
    // pinned to the day the dialog opened on while the leg chip is tapped over to Japan. Adding it
    // in would print ¥50,000 under the day's `legCurrency` as "Rs 51,000".
    const rows = [
      exp({ id: 'j', date: '2026-12-12', leg: 'japan', amount: 50000 }),
      exp({ id: 'n', date: '2026-12-12', leg: 'nepal', amount: 1000 }),
    ];
    expect(expensesByDate(rows)).toEqual({ '2026-12-12': 1000 }); // not 51000, and not 50000

    // The drift guard: the calendar bucket IS the number both recap surfaces already compute for
    // that day. Two aggregators, one contract — if either side is changed alone, this goes red.
    expect(expensesByDate(rows)['2026-12-12']).toBe(
      sumExpensesForDate(rows, '2026-12-12', getCountryForDate('2026-12-12')),
    );
  });

  it('EXCLUDES undated expenses from the per-day map (they only count in the leg/total spend)', () => {
    const byDate = expensesByDate([
      exp({ id: 'dated', date: '2026-12-12', amount: 1000 }),
      exp({ id: 'undated', amount: 5000 }), // no date — excluded from per-day
    ]);
    expect(byDate).toEqual({ '2026-12-12': 1000 });
    // The undated 5000 is absent here but WOULD be in expensesToSpent's leg total — the two views
    // agree on the total and differ only on "which day", by exactly the undated amount.
    const perDaySum = Object.values(byDate).reduce((s, n) => s + n, 0);
    expect(perDaySum).toBe(1000); // not 6000 — proves the undated amount is not double-attributed to a day
  });

  it('is TOTAL — bad date strings, 0/negative/NaN amounts, and non-objects contribute nothing', () => {
    const byDate = expensesByDate([
      exp({ id: 'ok', date: '2026-12-12', amount: 1000 }),
      exp({ id: 'baddate', date: '12/12/2026', amount: 900 } as unknown as Expense), // wrong format → excluded
      exp({ id: 'zero', date: '2026-12-12', amount: 0 }), // 0 → contributes nothing
      exp({ id: 'neg', date: '2026-12-13', amount: -50 }), // negative → contributes nothing
      exp({ id: 'nan', date: '2026-12-14', amount: NaN }), // NaN → safeAmount 0 → nothing
      null as unknown as Expense, // non-object → skipped
    ]);
    expect(byDate).toEqual({ '2026-12-12': 1000 });
  });
});

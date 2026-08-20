import { describe, it, expect } from 'vitest';

/**
 * The two halves of the unknown-leg invariant that have no home in `expenses-core` /
 * `expenses-storage`: the `expensesByDate` aggregate exclusion (`core/budget/burn-rate.ts`) and the
 * `normalizeModel` key preservation (`core/budget/model.ts`).
 *
 * The invariant, stated once: **an unrecognised leg round-trips through LOCAL storage, and is
 * excluded from every aggregate.** `LEGS` is resolved ONCE at module load from the active pack, but
 * a storage slot outlives that resolution — a config-less join that later heals, a whole-trip
 * backup restored under a different pack, an import. Treating an unknown leg as FATAL deleted real
 * rows and real budgets on the next save (the sanitizers run on WRITE as well as read). Treating it
 * as INERT keeps the data and moves the exclusion to the only place it changes a number: the totals.
 *
 * The boundary is local, and precisely so. Retention holds for `loadExpenses` / `saveExpenses`,
 * whole-trip restore and import; it does NOT survive remote sync, where `applySnapshot` rebuilds
 * the whole slot from a hardcoded leg list (`lib/expenses-remote.ts:35`) and `unflattenBudget`
 * rebuilds `legBudgets` from `LEGS` alone (`core/budget/flatten.ts:64`). The outbound direction IS
 * inert — `flattenBudget` iterates `LEGS`, so a preserved key is never written up.
 *
 * These run under the DEFAULT pack, so `LEGS` is `['nepal', 'japan']` and `'main'` — the id a
 * custom single-leg trip uses — is the foreign leg throughout.
 */

import { expensesByDate } from '@/core/budget/burn-rate';
import type { Expense } from '@/core/budget/expenses';
import { LEGS, isLeg, normalizeModel, rollUp, type BudgetModel } from '@/core/budget/model';

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

describe('the fixture premise: this suite runs under the default pack', () => {
  it("LEGS is ['nepal', 'japan'] and 'main' is foreign to it", () => {
    expect([...LEGS]).toEqual(['nepal', 'japan']);
    expect(isLeg('main')).toBe(false);
    expect(isLeg('nepal')).toBe(true);
  });
});

describe('expensesByDate — EXCLUDES a retained unknown-leg row (regression guard)', () => {
  it("a dated 'main' row contributes nothing to any per-day bucket", () => {
    const byDate = expensesByDate([
      exp({ id: 'n', leg: 'nepal', date: '2026-12-12', amount: 1000 }),
      exp({ id: 'm', leg: 'main', date: '2026-12-12', amount: 9999 }), // same day, foreign leg
      exp({ id: 'm2', leg: 'main', date: '2026-12-13', amount: 500 }), // its own day
    ]);
    // Not 10999, and no '2026-12-13' key at all — the foreign rows are invisible to the overlay.
    expect(byDate).toEqual({ '2026-12-12': 1000 });
  });

  it('a list of ONLY unknown-leg rows buckets to {} — the calendar overlay stays empty, not wrong', () => {
    expect(
      expensesByDate([
        exp({ id: 'm1', leg: 'main', date: '2026-12-12', amount: 1200 }),
        exp({ id: 'm2', leg: 'main', date: '2026-12-25', amount: 8000 }),
      ]),
    ).toEqual({});
  });

  it('agrees with expensesToSpent about WHICH rows count (the two views cannot disagree)', () => {
    // The reason this guard exists: `expensesToSpent` already skipped a foreign leg, so retaining
    // the row without this filter would have made the per-day sum EXCEED the leg/total spend.
    const rows = [
      exp({ id: 'n', leg: 'nepal', date: '2026-12-12', amount: 1000 }),
      exp({ id: 'm', leg: 'main', date: '2026-12-12', amount: 9999 }),
    ];
    const perDaySum = Object.values(expensesByDate(rows)).reduce((s, n) => s + n, 0);
    expect(perDaySum).toBe(1000);
  });
});

describe('normalizeModel — PRESERVES unknown leg keys instead of deleting the money', () => {
  it("legBudgets: { main: 5000 } survives, alongside the seeded active legs", () => {
    const cleaned = normalizeModel({ legBudgets: { main: 5000 } } as unknown as BudgetModel);
    expect(cleaned.legBudgets).toEqual({ main: 5000, nepal: 0, japan: 0 });
  });

  it('a preserved key round-trips through a re-normalize (the save path runs it again)', () => {
    const once = normalizeModel({ legBudgets: { main: 5000 } } as unknown as BudgetModel);
    expect(normalizeModel(once).legBudgets.main).toBe(5000); // was 0 → then gone
  });

  it('a preserved leg budget is still safeAmount-coerced (retention buys no laxity)', () => {
    const cleaned = normalizeModel({
      legBudgets: { main: -5, other: 'nope', third: 1200 },
    } as unknown as BudgetModel);
    expect(cleaned.legBudgets).toEqual({ main: 0, other: 0, third: 1200, nepal: 0, japan: 0 });
  });

  it("categoryBudgets for an unknown leg survives, with categories still filtered", () => {
    const cleaned = normalizeModel({
      categoryBudgets: { main: { food: 2760, hotel: 0, bogus: 99 } },
    } as unknown as BudgetModel);
    expect(cleaned.categoryBudgets.main).toEqual({ food: 2760 }); // 0 dropped, non-category dropped
  });

  it('an unknown leg whose categories are ALL invalid still drops the key (no empty husk)', () => {
    const cleaned = normalizeModel({
      categoryBudgets: { main: { bogus: 1 } },
    } as unknown as BudgetModel);
    expect(cleaned.categoryBudgets).not.toHaveProperty('main');
  });

  it("'__proto__' is the one stored key NOT preserved — in either map, in either sense", () => {
    // JSON.parse (not a literal) is how the slot actually arrives, and it makes `__proto__` a real
    // OWN property. Preserving it is not possible and not safe: `legBudgets.__proto__ = <number>`
    // hits the prototype setter, which ignores primitives, so the key silently vanishes; and
    // `categoryBudgets.__proto__ = <object>` REPLACES the prototype of the map we return.
    const hostile = JSON.parse(
      '{"legBudgets":{"__proto__":7000,"main":1},"categoryBudgets":{"__proto__":{"food":99},"main":{"food":2760}}}',
    );
    const result = normalizeModel(hostile);

    // Neither map keeps the key…
    expect(Object.keys(result.legBudgets)).toEqual(['main', 'nepal', 'japan']);
    expect(Object.keys(result.categoryBudgets)).toEqual(['main']);
    // …and neither had its prototype rewritten (the real defect: an attacker-controlled
    // [[Prototype]] on an object the budget panel then spreads and JSON.stringifies).
    expect(Object.getPrototypeOf(result.categoryBudgets)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(result.legBudgets)).toBe(Object.prototype);
    expect((result.categoryBudgets as Record<string, unknown>).food).toBeUndefined();
    // The legitimate keys around it are untouched.
    expect(result.legBudgets.main).toBe(1);
    expect(result.categoryBudgets.main).toEqual({ food: 2760 });
    // And Object.prototype itself was never touched (this was never global pollution, but pin it).
    expect(Object.prototype).not.toHaveProperty('food');
  });

  it('the retention is INERT: rollUp iterates LEGS, so a preserved key adds no line and no total', () => {
    const cleaned = normalizeModel({
      legBudgets: { nepal: 13800, main: 5000 },
      categoryBudgets: { main: { food: 2760 } },
    } as unknown as BudgetModel);
    const roll = rollUp(cleaned);
    expect(roll.legs.map((l) => l.leg)).toEqual(['nepal', 'japan']); // no 'main' line
    // 13800 NPR only — the preserved 5000 contributes nothing to the grand total.
    expect(roll.totalBudgetHome).toBeCloseTo(13800 / cleaned.rates.NPR, 6);
  });
});

import { describe, it, expect } from 'vitest';

/**
 * S102 — pure expense core (D-016/D-099). `core/budget/expenses.ts` is framework-free; these tests
 * pin the aggregator (`expensesToSpent` — the S101 `SpentInput` seam consumer: per-leg + per-(leg,
 * category) sums, multi-leg + multi-category, empty → {}, malformed-entry totality), the pure CRUD
 * transforms (`addExpense`/`updateExpense`/`removeExpense` with caller-injected id + timestamp), and
 * the sanitizers. The aggregate is fed straight into `rollUp(model, spent)` (proven here too) so
 * expense logging subtracts with no reshape.
 */

import {
  expensesToSpent,
  addExpense,
  updateExpense,
  removeExpense,
  sanitizeExpense,
  sanitizeExpenses,
  type Expense,
  type NewExpenseInput,
} from '@/core/budget/expenses';
import { rollUp, type BudgetModel } from '@/core/budget/model';

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

function budget(over: Partial<BudgetModel> = {}): BudgetModel {
  return {
    version: 1,
    homeCurrency: 'USD',
    rates: { NPR: 138, JPY: 155 },
    legBudgets: { nepal: 0, japan: 0 },
    categoryBudgets: {},
    ...over,
  };
}

describe('expensesToSpent — the S101 SpentInput seam consumer', () => {
  it('empty / null / undefined input → {} (the S101 "nothing spent" state, remaining === budget)', () => {
    expect(expensesToSpent([])).toEqual({});
    expect(expensesToSpent(null)).toEqual({});
    expect(expensesToSpent(undefined)).toEqual({});
  });

  it('sums a single leg + category', () => {
    const spent = expensesToSpent([exp({ leg: 'nepal', category: 'food', amount: 1000 })]);
    expect(spent).toEqual({
      byLeg: { nepal: 1000 },
      byCategory: { nepal: { food: 1000 } },
    });
  });

  it('sums MULTIPLE expenses across legs AND categories', () => {
    const spent = expensesToSpent([
      exp({ id: 'a', leg: 'nepal', category: 'food', amount: 1000 }),
      exp({ id: 'b', leg: 'nepal', category: 'food', amount: 500 }), // same (leg,cat) accumulates
      exp({ id: 'c', leg: 'nepal', category: 'transportation', amount: 300 }),
      exp({ id: 'd', leg: 'japan', category: 'hotel', amount: 8000 }),
    ]);
    expect(spent.byLeg).toEqual({ nepal: 1800, japan: 8000 });
    expect(spent.byCategory).toEqual({
      nepal: { food: 1500, transportation: 300 },
      japan: { hotel: 8000 },
    });
  });

  it('is TOTAL — malformed entries (bad leg/category/amount) contribute nothing, never throws', () => {
    const spent = expensesToSpent([
      exp({ leg: 'nepal', category: 'food', amount: 1000 }),
      { ...exp(), leg: 'atlantis' as unknown as Expense['leg'] }, // invalid leg → skipped
      { ...exp(), category: 'bogus' as unknown as Expense['category'] }, // invalid category → skipped
      exp({ amount: NaN }), // NaN → safeAmount 0 → skipped
      exp({ amount: -50 }), // negative → skipped
      null as unknown as Expense, // non-object → skipped
    ]);
    expect(spent).toEqual({ byLeg: { nepal: 1000 }, byCategory: { nepal: { food: 1000 } } });
  });

  it('feeds rollUp(model, spent) so remaining = budget − spent with NO reshape', () => {
    const m = budget({ legBudgets: { nepal: 13800, japan: 31000 } });
    const spent = expensesToSpent([
      exp({ leg: 'nepal', category: 'food', amount: 6900 }), // 50 USD @138
    ]);
    const roll = rollUp(m, spent);
    const nepal = roll.legs.find((l) => l.leg === 'nepal')!;
    expect(nepal.spentLocal).toBe(6900);
    expect(nepal.remainingLocal).toBe(6900); // 13800 − 6900
    expect(roll.totalSpentHome).toBeCloseTo(50, 6);
    expect(roll.totalRemainingHome).toBeCloseTo(250, 6); // 300 − 50
    // Over-budget shows as a NEGATIVE remaining (no clamp) — the panel's over cue reads this.
    const over = rollUp(budget({ legBudgets: { nepal: 1000, japan: 0 } }), expensesToSpent([exp({ amount: 3000 })]));
    expect(over.legs.find((l) => l.leg === 'nepal')!.remainingLocal).toBe(-2000);
    expect(over.totalRemainingHome).toBeLessThan(0);
  });
});

describe('addExpense / updateExpense / removeExpense — pure transforms (injected id + timestamp)', () => {
  const input: NewExpenseInput = { leg: 'japan', category: 'hotel', amount: 8000, note: 'Ryokan' };

  it('addExpense appends a sanitized entry with the CALLER-supplied id + createdAt (deterministic)', () => {
    const list = addExpense([], input, 'exp-fixed', '2026-12-20T10:00:00.000Z');
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      id: 'exp-fixed',
      leg: 'japan',
      category: 'hotel',
      amount: 8000,
      note: 'Ryokan',
      createdAt: '2026-12-20T10:00:00.000Z',
    });
    // Pure: the original list is not mutated.
    const base: Expense[] = [];
    addExpense(base, input, 'x', 'y');
    expect(base).toHaveLength(0);
  });

  it('addExpense drops a wholly-malformed input (invalid leg) — list returned unchanged', () => {
    const bad = { leg: 'atlantis', category: 'food', amount: 100 } as unknown as NewExpenseInput;
    expect(addExpense([exp()], bad, 'z', 'w')).toHaveLength(1);
  });

  it('updateExpense patches a matching id, PRESERVING id + createdAt; non-match is a no-op', () => {
    const list = [exp({ id: 'a', amount: 1000, category: 'food' }), exp({ id: 'b', amount: 2000 })];
    const next = updateExpense(list, 'a', { amount: 1500, category: 'shopping' });
    expect(next.find((e) => e.id === 'a')).toMatchObject({
      id: 'a',
      amount: 1500,
      category: 'shopping',
      createdAt: '2026-12-10T09:00:00.000Z', // unchanged
    });
    expect(next.find((e) => e.id === 'b')!.amount).toBe(2000); // untouched
    // Non-matching id → unchanged (same values).
    expect(updateExpense(list, 'nope', { amount: 9 })).toEqual(list);
  });

  it('removeExpense deletes a matching id; non-match is a no-op; pure', () => {
    const list = [exp({ id: 'a' }), exp({ id: 'b' })];
    expect(removeExpense(list, 'a').map((e) => e.id)).toEqual(['b']);
    expect(removeExpense(list, 'nope')).toHaveLength(2);
    expect(list).toHaveLength(2); // original untouched
  });
});

describe('sanitizers — TOTAL (a corrupt slot never crashes the store)', () => {
  it('sanitizeExpense salvages a valid entry, coercing a bad amount to 0 and dropping bad optionals', () => {
    const e = sanitizeExpense({
      id: 'x',
      leg: 'nepal',
      category: 'food',
      amount: 'not-a-number',
      date: 'nope',
      note: '   ',
      createdAt: '2026-12-10T00:00:00.000Z',
    });
    expect(e).toEqual({ id: 'x', leg: 'nepal', category: 'food', amount: 0, createdAt: '2026-12-10T00:00:00.000Z' });
    // date (bad format) and note (whitespace-only) are dropped.
    expect(e).not.toHaveProperty('date');
    expect(e).not.toHaveProperty('note');
  });

  it('sanitizeExpense returns null when id / leg / category cannot be salvaged', () => {
    expect(sanitizeExpense(null)).toBeNull();
    expect(sanitizeExpense({ leg: 'nepal', category: 'food' })).toBeNull(); // no id
    expect(sanitizeExpense({ id: 'x', leg: 'atlantis', category: 'food' })).toBeNull();
    expect(sanitizeExpense({ id: 'x', leg: 'nepal', category: 'bogus' })).toBeNull();
  });

  it('sanitizeExpenses drops non-array input and unsalvageable entries', () => {
    expect(sanitizeExpenses('not an array')).toEqual([]);
    expect(sanitizeExpenses(null)).toEqual([]);
    const cleaned = sanitizeExpenses([
      exp({ id: 'a' }),
      null,
      { id: 'b', leg: 'japan', category: 'hotel', amount: 5000, createdAt: 't' },
      { garbage: true },
    ]);
    expect(cleaned.map((e) => e.id)).toEqual(['a', 'b']);
  });
});

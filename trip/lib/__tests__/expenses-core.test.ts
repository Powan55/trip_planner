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

  it('addExpense ACCEPTS an unknown leg (kept verbatim) — an unrecognised leg is not malformed', () => {
    const foreign = { leg: 'main', category: 'food', amount: 100 } as unknown as NewExpenseInput;
    const list = addExpense([exp()], foreign, 'z', 'w');
    expect(list).toHaveLength(2);
    expect(list[1]).toMatchObject({ id: 'z', leg: 'main', category: 'food', amount: 100 });
  });

  it('addExpense ACCEPTS an unknown category (kept verbatim) — a forward category is not malformed (#150)', () => {
    const forward = { leg: 'nepal', category: 'ferry', amount: 100 } as unknown as NewExpenseInput;
    const list = addExpense([exp()], forward, 'z', 'w');
    expect(list).toHaveLength(2);
    expect(list[1]).toMatchObject({ id: 'z', leg: 'nepal', category: 'ferry', amount: 100 });
  });

  it('addExpense still drops a wholly-malformed input (missing id) — list unchanged', () => {
    // An empty injected id is unsalvageable — id has no safe default.
    expect(addExpense([exp()], { leg: 'nepal', category: 'food', amount: 100 }, '', 'w')).toHaveLength(1);
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

  it('sanitizeExpense returns null when id cannot be salvaged (leg/category are NOT — #150)', () => {
    expect(sanitizeExpense(null)).toBeNull();
    expect(sanitizeExpense({ leg: 'nepal', category: 'food' })).toBeNull(); // no id
    // A leg still has to BE something — an absent / empty / non-string leg is unsalvageable.
    expect(sanitizeExpense({ id: 'x', category: 'food' })).toBeNull();
    expect(sanitizeExpense({ id: 'x', leg: '', category: 'food' })).toBeNull();
    expect(sanitizeExpense({ id: 'x', leg: 7, category: 'food' })).toBeNull();
    // A category still has to BE something too, same rule — but a forward/unrecognised STRING
    // value is retained verbatim, not unsalvageable (#150, was a hard reject before this fix).
    expect(sanitizeExpense({ id: 'x', leg: 'nepal', category: 'bogus' })).not.toBeNull();
    expect(sanitizeExpense({ id: 'x', leg: 'nepal' })).toBeNull(); // no category at all
    expect(sanitizeExpense({ id: 'x', leg: 'nepal', category: '' })).toBeNull();
    expect(sanitizeExpense({ id: 'x', leg: 'nepal', category: 7 })).toBeNull();
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

describe('an UNKNOWN leg is retained by the sanitizers and excluded from the aggregates', () => {
  it("sanitizeExpense KEEPS a 'main' row verbatim, every other field intact", () => {
    const e = sanitizeExpense({
      id: 'm1',
      leg: 'main', // the custom single-leg pack's id — not in the default pack's LEGS
      category: 'food',
      amount: 1200,
      date: '2026-12-11',
      note: 'Lunch',
      createdAt: '2026-12-11T09:00:00.000Z',
    });
    expect(e).toEqual({
      id: 'm1',
      leg: 'main',
      category: 'food',
      amount: 1200,
      date: '2026-12-11',
      note: 'Lunch',
      createdAt: '2026-12-11T09:00:00.000Z',
    });
  });

  it("the A-6 shape: a list whose legs are ALL unknown sanitizes to a NON-EMPTY list, never []", () => {
    // A cross-pack backup restore. `[] !== null` cleared the backup lib's never-destroy gate, so an
    // emptied list was WRITTEN and the UI reported "Trip restored" over a wipe.
    const restored = sanitizeExpenses([
      { id: 'm1', leg: 'main', category: 'food', amount: 1200, createdAt: 't1' },
      { id: 'm2', leg: 'main', category: 'hotel', amount: 8000, createdAt: 't2' },
      { id: 'm3', leg: 'main', category: 'transportation', amount: 300, createdAt: 't3' },
    ]);
    expect(restored).toHaveLength(3);
    expect(restored.map((e) => e.leg)).toEqual(['main', 'main', 'main']);
  });

  it('expensesToSpent still EXCLUDES the retained unknown-leg row from every total', () => {
    const spent = expensesToSpent([
      exp({ id: 'n', leg: 'nepal', category: 'food', amount: 1000 }),
      exp({ id: 'm', leg: 'main', category: 'food', amount: 9999 }), // retained on disk, not counted
    ]);
    expect(spent).toEqual({ byLeg: { nepal: 1000 }, byCategory: { nepal: { food: 1000 } } });
    expect(spent.byLeg).not.toHaveProperty('main');
    // …and therefore contributes nothing to the rollup the panel renders.
    const roll = rollUp(budget({ legBudgets: { nepal: 5000, japan: 0 } }), spent);
    expect(roll.legs.find((l) => l.leg === 'nepal')!.spentLocal).toBe(1000);
    expect(roll.legs.map((l) => l.leg)).toEqual(['nepal', 'japan']); // no 'main' line appears
  });
});

describe('a FORWARD category (#150) is retained by the sanitizers and excluded from the aggregates', () => {
  it("sanitizeExpense KEEPS an unrecognised category verbatim, every other field intact", () => {
    const e = sanitizeExpense({
      id: 'f1',
      leg: 'nepal',
      category: 'ferry', // hypothetical value a newer build introduced
      amount: 450,
      createdAt: '2026-12-11T09:00:00.000Z',
    });
    expect(e).toEqual({
      id: 'f1',
      leg: 'nepal',
      category: 'ferry',
      amount: 450,
      createdAt: '2026-12-11T09:00:00.000Z',
    });
  });

  it('expensesToSpent still EXCLUDES the retained unknown-category row from every total', () => {
    const spent = expensesToSpent([
      exp({ id: 'n', leg: 'nepal', category: 'food', amount: 1000 }),
      exp({ id: 'f', leg: 'nepal', category: 'ferry', amount: 450 }), // retained on disk, not counted
    ]);
    expect(spent).toEqual({ byLeg: { nepal: 1000 }, byCategory: { nepal: { food: 1000 } } });
  });
});

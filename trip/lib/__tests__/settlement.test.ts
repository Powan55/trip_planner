import { describe, it, expect } from 'vitest';

/**
 * S144 — pure settlement math (`core/budget/settlement.ts`, D-016/D-099). Proves the who-owes-whom
 * derivation: even division, net balances, a MINIMAL transfer set, circular-debt-nets-flat, self-
 * payment, per-leg/per-currency isolation, and that fast-path (no-split) expenses contribute zero.
 * Also pins that `paidBy`/`split` survive the S142 `mergeItems` row merge (no new sync code).
 */

import { settle } from '@/core/budget/settlement';
import { sanitizeExpense, type Expense } from '@/core/budget/expenses';
import { mergeItems } from '@/core/sync/merge-items';

const ROSTER = ['Powan', 'Sushil', 'Uttam'];

function exp(over: Partial<Expense> = {}): Expense {
  return {
    id: `e-${Math.random().toString(36).slice(2, 8)}`,
    leg: 'nepal',
    category: 'food',
    amount: 300,
    createdAt: '2026-12-10T09:00:00.000Z',
    ...over,
  };
}

describe('settle — even division + net balances', () => {
  it('two-person: A pays 300 split A+B → B owes A 150', () => {
    const [s] = settle([exp({ paidBy: 'Powan', split: ['Powan', 'Sushil'], amount: 300 })], ROSTER);
    expect(s.leg).toBe('nepal');
    expect(s.currency).toBe('NPR');
    expect(s.balances).toEqual({ Powan: 150, Sushil: -150 });
    expect(s.transfers).toEqual([{ from: 'Sushil', to: 'Powan', amount: 150 }]);
  });

  it('even division: 300 split three ways = 100 each; payer nets to +200', () => {
    const [s] = settle(
      [exp({ paidBy: 'Powan', split: ['Powan', 'Sushil', 'Uttam'], amount: 300 })],
      ROSTER,
    );
    expect(s.balances).toEqual({ Powan: 200, Sushil: -100, Uttam: -100 });
    // Two debtors → two transfers, each to the single creditor (≤ n−1 = 2).
    expect(s.transfers).toEqual([
      { from: 'Sushil', to: 'Powan', amount: 100 },
      { from: 'Uttam', to: 'Powan', amount: 100 },
    ]);
    expect(s.transfers.length).toBeLessThanOrEqual(ROSTER.length - 1);
  });

  it('self-payment: payer is the sole split member ⇒ owes nothing, no transfer', () => {
    const [s] = settle([exp({ paidBy: 'Powan', split: ['Powan'], amount: 500 })], ROSTER);
    expect(s.balances).toEqual({ Powan: 0 });
    expect(s.transfers).toEqual([]);
  });
});

describe('settle — circular debt nets flat', () => {
  it('a→b→c→a cancels: every balance 0, ZERO transfers', () => {
    // Each pays 30 for a pair; the ring of debts nets to nothing.
    const settlements = settle(
      [
        exp({ paidBy: 'Powan', split: ['Powan', 'Sushil'], amount: 30 }), // Powan +15, Sushil −15
        exp({ paidBy: 'Sushil', split: ['Sushil', 'Uttam'], amount: 30 }), // Sushil +15, Uttam −15
        exp({ paidBy: 'Uttam', split: ['Uttam', 'Powan'], amount: 30 }), // Uttam +15, Powan −15
      ],
      ROSTER,
    );
    const [s] = settlements;
    expect(s.balances).toEqual({ Powan: 0, Sushil: 0, Uttam: 0 });
    expect(s.transfers).toEqual([]);
  });

  it('NON-VACUOUS: a wrong net does NOT settle flat (guard against a trivially-passing test)', () => {
    // Powan pays for everyone twice, nobody reciprocates → he is owed, others owe. Must NOT be flat.
    const [s] = settle(
      [
        exp({ paidBy: 'Powan', split: ['Powan', 'Sushil', 'Uttam'], amount: 300 }),
        exp({ paidBy: 'Powan', split: ['Powan', 'Sushil', 'Uttam'], amount: 300 }),
      ],
      ROSTER,
    );
    expect(s.balances).toEqual({ Powan: 400, Sushil: -200, Uttam: -200 });
    expect(s.transfers.length).toBeGreaterThan(0);
  });
});

describe('settle — per-leg / per-currency isolation (D-110)', () => {
  it('NPR and JPY settle SEPARATELY and are never summed', () => {
    const settlements = settle(
      [
        exp({ leg: 'nepal', paidBy: 'Powan', split: ['Powan', 'Sushil'], amount: 300 }),
        exp({ leg: 'japan', paidBy: 'Sushil', split: ['Sushil', 'Uttam'], amount: 2000 }),
      ],
      ROSTER,
    );
    expect(settlements.map((s) => s.leg)).toEqual(['nepal', 'japan']);
    const nepal = settlements.find((s) => s.leg === 'nepal')!;
    const japan = settlements.find((s) => s.leg === 'japan')!;
    expect(nepal.currency).toBe('NPR');
    expect(nepal.balances).toEqual({ Powan: 150, Sushil: -150 });
    expect(japan.currency).toBe('JPY');
    expect(japan.balances).toEqual({ Sushil: 1000, Uttam: -1000 });
    // Powan is NOT a participant on the Japan leg — cross-leg amounts never leak.
    expect(japan.balances.Powan).toBeUndefined();
  });
});

describe('settle — fast path contributes zero', () => {
  it('a no-split expense produces NO settlement (empty array ⇒ UI hides the summary)', () => {
    expect(settle([exp({ amount: 999 })], ROSTER)).toEqual([]);
  });

  it('split expenses settle; sibling no-split expenses on the same leg add nothing', () => {
    const [s] = settle(
      [
        exp({ paidBy: 'Powan', split: ['Powan', 'Sushil'], amount: 300 }),
        exp({ amount: 5000 }), // fast path — must not move any balance
      ],
      ROSTER,
    );
    expect(s.balances).toEqual({ Powan: 150, Sushil: -150 });
  });

  it('paidBy absent + split present ⇒ falls back to `self`', () => {
    const [s] = settle([exp({ split: ['Powan', 'Sushil'], amount: 300 })], ROSTER, 'Powan');
    expect(s.balances).toEqual({ Powan: 150, Sushil: -150 });
  });

  it('tombstoned split expense is ignored', () => {
    expect(
      settle([exp({ paidBy: 'Powan', split: ['Powan', 'Sushil'], amount: 300, deleted: true })], ROSTER),
    ).toEqual([]);
  });
});

describe('paidBy/split — sanitize passthrough + mergeItems row merge (S142, no new sync code)', () => {
  it('sanitizeExpense passes paidBy + split through; a no-split expense is byte-identical', () => {
    const withSplit = sanitizeExpense({
      id: 'e1', leg: 'nepal', category: 'food', amount: 300, createdAt: 't',
      paidBy: 'Powan', split: ['Powan', 'Sushil'],
    });
    expect(withSplit?.paidBy).toBe('Powan');
    expect(withSplit?.split).toEqual(['Powan', 'Sushil']);

    // Fast path: no split fields in, none out — object has exactly the pre-S144 keys.
    const plain = { id: 'e2', leg: 'nepal', category: 'food', amount: 300, createdAt: 't' };
    expect(sanitizeExpense(plain)).toEqual(plain);
    expect(Object.keys(sanitizeExpense(plain)!)).not.toContain('paidBy');
    expect(Object.keys(sanitizeExpense(plain)!)).not.toContain('split');

    // An empty split array never persists (⇒ effectively fast path).
    expect(sanitizeExpense({ ...plain, split: [] })).toEqual(plain);
  });

  it('paidBy/split survive the mergeItems row merge — the winning row carries them unchanged', () => {
    const local: Expense[] = [
      exp({ id: 'x', paidBy: 'Powan', split: ['Powan', 'Sushil'], hlc: '1', rev: 1 }),
    ];
    const remote: Expense[] = [
      exp({ id: 'x', paidBy: 'Sushil', split: ['Sushil', 'Uttam'], hlc: '2', rev: 2, note: 'edited' }),
    ];
    const [winner] = mergeItems(local, remote);
    // Higher HLC wins (remote) and its split fields ride the merge with no extra sync handling.
    expect(winner.paidBy).toBe('Sushil');
    expect(winner.split).toEqual(['Sushil', 'Uttam']);
  });
});

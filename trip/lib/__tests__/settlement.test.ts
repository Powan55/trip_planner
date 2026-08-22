import { describe, it, expect } from 'vitest';

/**
 * S144 — pure settlement math (`core/budget/settlement.ts`, D-016/D-099). Proves the who-owes-whom
 * derivation: even division, net balances, a MINIMAL transfer set, circular-debt-nets-flat, self-
 * payment, per-leg/per-currency isolation, and that fast-path (no-split) expenses contribute zero.
 * Also pins that `paidBy`/`split` survive the S142 `mergeItems` row merge (no new sync code).
 */

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { settle, type LegSettlement } from '@/core/budget/settlement';
import { sanitizeExpense, type Expense } from '@/core/budget/expenses';
import { mergeItems } from '@/core/sync/merge-items';
import SettleUpSummary from '@/components/settle-up-summary';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

  // ── D-333 · a split row with no payer is UNATTRIBUTABLE, not "mine" ────────────────────────
  // These replace a test that pinned the OPPOSITE: `settle(…, ROSTER, 'Powan')` attributed a
  // payer-less row to a third `self` argument. That made a settlement a function of who was
  // looking — the same synced row settled to a different person on each device, and a
  // claim-authorship rename moved its balance to the new name. D-288 keeps the claim rewrite away
  // from `paidBy`/`split` precisely so money cannot be re-pointed by a rename; the fallback did it
  // anyway, through the read path.
  //
  // 🔴 READ `settleWithIdentity` BEFORE SIMPLIFYING IT AWAY. The old `self` was OPTIONAL, so the
  // old defective code ALSO returned [] when called with two arguments — a two-arg assertion
  // documents the property but cannot fail on the defect, and dropping the argument is not a proof
  // that the argument stopped mattering. The discriminating question is "does supplying an identity
  // change the answer?", and asking it requires actually supplying one. Deleting the signature is
  // what FIXED this; the cast below is what TESTS it.
  const settleWithIdentity = settle as unknown as (
    expenses: readonly Expense[],
    travelers: readonly string[],
    self?: string,
  ) => LegSettlement[];

  it('REGRESSION (D-333): paidBy absent + split present ⇒ NO settlement, for ANY supplied identity', () => {
    const nopayer = [exp({ split: ['Powan', 'Sushil'], amount: 300 })];
    expect(settle(nopayer, ROSTER)).toEqual([]);
    // The three that fail on the pre-D-333 code: an identity in the split, one outside it, and the
    // empty-string edge. Each used to hand the whole 300 to whoever was passed in.
    expect(settleWithIdentity(nopayer, ROSTER, 'Powan')).toEqual([]);
    expect(settleWithIdentity(nopayer, ROSTER, 'Uttam')).toEqual([]);
    expect(settleWithIdentity(nopayer, ROSTER, '')).toEqual([]);
    // `paidBy: ''` — the shape `sanitizeExpense` produces from an import or a merged peer row when
    // the payer field is present but empty: the split survives, the payer does not.
    expect(settle([exp({ paidBy: '', split: ['Powan', 'Sushil'], amount: 300 })], ROSTER)).toEqual([]);
  });

  it('REGRESSION (D-333): who is looking cannot change a settlement', () => {
    // The device-local half of the defect, which the rename only made visible: `self` was
    // `traveler?.name`, so the SAME synced rows settled differently on each traveller's device.
    const rows = [
      exp({ paidBy: 'Powan', split: ['Powan', 'Sushil'], amount: 300 }),
      exp({ split: ['Powan', 'Sushil'], amount: 800 }), // no payer
    ];
    const asPowan = settleWithIdentity(rows, ROSTER, 'Powan');
    expect(settleWithIdentity(rows, ROSTER, 'Sushil')).toEqual(asPowan);
    expect(settleWithIdentity(rows, ROSTER, undefined)).toEqual(asPowan);
    // NON-VACUOUS: the leg does settle, and to EXACTLY the attributable row's numbers. Attributing
    // the 800 to any name at all — including one already in the split — breaks both equalities.
    expect(asPowan[0].balances).toEqual({ Powan: 150, Sushil: -150 });
    expect(asPowan[0].transfers).toEqual([{ from: 'Sushil', to: 'Powan', amount: 150 }]);
  });

  it('tombstoned split expense is ignored', () => {
    expect(
      settle([exp({ paidBy: 'Powan', split: ['Powan', 'Sushil'], amount: 300, deleted: true })], ROSTER),
    ).toEqual([]);
  });
});

describe('settle — largest-remainder rounding keeps balances summing to 0 (D-337 family)', () => {
  it('a 3-way split of an odd amount rounds balances so a creditor’s transfers-received sum to exactly their balance', () => {
    const [s] = settle(
      [exp({ leg: 'nepal', paidBy: 'Powan', split: ['Powan', 'Sushil', 'Uttam'], amount: 1000 })],
      ROSTER,
    );
    // 1000 / 3 = 333.33...; unrounded balances would not sum to a clean 0. Rounded, they must.
    expect(Object.values(s.balances).reduce((a, b) => a + b, 0)).toBe(0);
    for (const [id, net] of Object.entries(s.balances)) {
      if (net <= 0) continue;
      const received = s.transfers.filter((t) => t.to === id).reduce((sum, t) => sum + t.amount, 0);
      expect(received).toBeCloseTo(net, 6);
    }
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

// ── The tie-break is the id, never the roster ─────────────────────────────────────────────────
// D-333 removed the identity ARGUMENT but an identity-derived value kept flowing in through
// `travelers`: `rosterForActiveTrip` puts the signed-in traveller first on a custom trip
// (`lib/token-auth.ts`), and `minimalTransfers` ranked equal-magnitude ties by that order. So the
// "A → B" instructions the Settle up card prints differed per device for byte-identical rows,
// which is exactly what `settle()`'s own header promises cannot happen. The D-333 test above
// passes a FIXED roster and varies only the identity, so it never saw this.
describe('settle — roster ORDER cannot change the answer (identity-free tie-break)', () => {
  // Two creditors at +100 and two debtors at −100: the tie the greedy solver has to break.
  const rows = [
    exp({ paidBy: 'Ana', split: ['Ana', 'Bo'], amount: 200 }),
    exp({ paidBy: 'Dee', split: ['Dee', 'Cal'], amount: 200 }),
  ];

  it('the same expenses settle identically on every device, whoever is listed first', () => {
    const onAnasPhone = settle(rows, ['Ana', 'Bo', 'Dee', 'Cal']); // Ana signed in ⇒ "me" first
    const onCalsPhone = settle(rows, ['Cal', 'Ana', 'Bo', 'Dee']); // Cal signed in, same rows
    expect(onCalsPhone).toEqual(onAnasPhone);
    // NON-VACUOUS: the tie is real, and each side is actually told to pay someone.
    expect(onAnasPhone[0].transfers).toEqual([
      { from: 'Bo', to: 'Ana', amount: 100 },
      { from: 'Cal', to: 'Dee', amount: 100 },
    ]);
  });

  it('an empty roster settles the same as any roster (nothing arithmetic reads it)', () => {
    expect(settle(rows)).toEqual(settle(rows, ['Cal', 'Ana', 'Bo', 'Dee']));
  });
});

// ── The "settled" chip and the transfer list under it must agree ──────────────────────────────
// The chip used `Math.abs(net) < 0.5`, a whole-unit threshold written for NPR/JPY, while
// `settle()` rounds a USD leg to CENTS and emits a transfer for anything over EPS. Every custom
// trip is a USD leg (`core/trips/custom.ts`), so on those trips the card called a sub-50-cent
// debt "settled" and printed the payment that clears it, in the same box. Rendered rather than
// asserted on a copy of the predicate: the defect was only ever visible on screen.
describe('SettleUpSummary — a USD balance under half a unit is NOT settled', () => {
  const settlements: LegSettlement[] = [
    {
      leg: 'nepal', // leg id only labels the block; the currency is what this test is about
      currency: 'USD',
      balances: { Ana: -0.3, Bo: 0.3 },
      transfers: [{ from: 'Ana', to: 'Bo', amount: 0.3 }],
    },
  ];

  function render(): { container: HTMLElement; unmount(): void } {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(createElement(SettleUpSummary, { settlements })));
    return {
      container,
      unmount() {
        act(() => root.unmount());
        container.remove();
      },
    };
  }

  it('prints what each side owes, not "settled", while a transfer is listed', () => {
    const r = render();
    const debtor = r.container.querySelector('[data-testid="settle-up-balance-nepal-Ana"]');
    const creditor = r.container.querySelector('[data-testid="settle-up-balance-nepal-Bo"]');
    expect(debtor?.textContent).toContain('owes $0.3');
    expect(creditor?.textContent).toContain('is owed $0.3');
    expect(r.container.textContent).not.toContain('settled');
    // The transfer is still there — this is the line the chip used to contradict.
    expect(
      r.container.querySelector('[data-testid="settle-up-transfer-nepal-Ana-Bo"]')?.textContent,
    ).toContain('$0.3');
    r.unmount();
  });

  it('an exactly-zero balance still reads "settled"', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        createElement(SettleUpSummary, {
          settlements: [{ leg: 'nepal', currency: 'USD', balances: { Ana: 0 }, transfers: [] }],
        }),
      ),
    );
    expect(
      container.querySelector('[data-testid="settle-up-balance-nepal-Ana"]')?.textContent,
    ).toContain('settled');
    act(() => root.unmount());
    container.remove();
  });
});

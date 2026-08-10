// S143 — PURE unit suite for `mergeBudget` (core/sync/merge-budget.ts), the LWW-per-field budget
// merge (D-149). Proves, on a real run, the whole convergence contract:
//   - concurrent edits to DIFFERENT fields BOTH survive (each path independent);
//   - same-field higher-HLC-wins (and, NON-VACUOUSLY, a lower-HLC same-field edit does NOT win);
//   - equal-HLC is broken by canonical JSON of the value — DETERMINISTIC + argument-order-independent;
//   - a stamped `null` = a CLEARED field, propagated without a tombstone;
//   - commutative + idempotent (a join over a per-field lattice).
//
// No firebase, no clock, no window — a pure function over the Firestore field-map shape.

import { describe, it, expect } from 'vitest';
import { mergeBudget, type BudgetFields } from '@/core/sync/merge-budget';

// Serialized HLC = pad(pt,15):pad(ct,6):actor — a higher pt sorts higher (string == tuple compare).
function hlc(pt: number, actor = 'a'): string {
  return `${String(pt).padStart(15, '0')}:${'000000'}:${actor}`;
}

describe('mergeBudget — concurrent DIFFERENT fields both survive (each path independent)', () => {
  it('friend-A edits legBudgets.nepal, friend-B edits legBudgets.japan → both keep their edits', () => {
    const local: BudgetFields = { 'legBudgets.nepal': { v: 20000, hlc: hlc(1000, 'A') } };
    const remote: BudgetFields = { 'legBudgets.japan': { v: 31000, hlc: hlc(1000, 'B') } };
    const merged = mergeBudget(local, remote);
    expect(merged['legBudgets.nepal'].v).toBe(20000);
    expect(merged['legBudgets.japan'].v).toBe(31000);
    // A field present on only ONE side survives unchanged regardless of arg order.
    expect(mergeBudget(remote, local)).toEqual(merged);
  });
});

describe('mergeBudget — same field: higher-HLC-wins (NON-VACUOUS)', () => {
  it('the strictly-later stamp wins', () => {
    const local: BudgetFields = { 'rates.NPR': { v: 138, hlc: hlc(1000) } };
    const remote: BudgetFields = { 'rates.NPR': { v: 142, hlc: hlc(2000) } }; // later
    expect(mergeBudget(local, remote)['rates.NPR']).toEqual({ v: 142, hlc: hlc(2000) });
  });

  it('a LOWER-HLC same-field edit does NOT win (guards against a vacuous always-remote merge)', () => {
    const local: BudgetFields = { 'rates.NPR': { v: 999, hlc: hlc(5000) } }; // newer local
    const remote: BudgetFields = { 'rates.NPR': { v: 142, hlc: hlc(2000) } }; // older remote
    expect(mergeBudget(local, remote)['rates.NPR'].v).toBe(999); // local (higher HLC) wins
    expect(mergeBudget(remote, local)['rates.NPR'].v).toBe(999); // symmetric — commutative
  });
});

describe('mergeBudget — equal-HLC canonical-JSON tie-break (deterministic + commutative)', () => {
  it('picks the same winner regardless of argument order', () => {
    const a: BudgetFields = { homeCurrency: { v: 'JPY', hlc: hlc(3000) } };
    const b: BudgetFields = { homeCurrency: { v: 'NPR', hlc: hlc(3000) } }; // same HLC, different value
    const ab = mergeBudget(a, b).homeCurrency;
    const ba = mergeBudget(b, a).homeCurrency;
    expect(ab).toEqual(ba); // deterministic — no arg-order dependence
    // JSON.stringify('NPR') > JSON.stringify('JPY') → 'NPR' wins deterministically.
    expect(ab.v).toBe('NPR');
  });
});

describe('mergeBudget — a stamped null CLEARS a field (no tombstone list)', () => {
  it('a later null beats an earlier value (field cleared); an earlier null loses to a later value', () => {
    const cleared = mergeBudget(
      { 'categoryBudgets.nepal.food': { v: 2760, hlc: hlc(1000) } },
      { 'categoryBudgets.nepal.food': { v: null, hlc: hlc(2000) } }, // later clear
    );
    expect(cleared['categoryBudgets.nepal.food'].v).toBeNull(); // cleared wins

    const restamped = mergeBudget(
      { 'categoryBudgets.nepal.food': { v: null, hlc: hlc(1000) } }, // earlier clear
      { 'categoryBudgets.nepal.food': { v: 5000, hlc: hlc(2000) } }, // later re-set
    );
    expect(restamped['categoryBudgets.nepal.food'].v).toBe(5000); // re-set wins
  });
});

describe('mergeBudget — commutative + idempotent (lattice join)', () => {
  const x: BudgetFields = {
    homeCurrency: { v: 'USD', hlc: hlc(1000, 'A') },
    'rates.NPR': { v: 138, hlc: hlc(4000, 'B') },
    'legBudgets.nepal': { v: 20000, hlc: hlc(2000, 'A') },
  };
  const y: BudgetFields = {
    homeCurrency: { v: 'JPY', hlc: hlc(3000, 'B') }, // wins (later)
    'rates.NPR': { v: 150, hlc: hlc(2500, 'A') }, // loses (older)
    'legBudgets.japan': { v: 31000, hlc: hlc(2000, 'B') },
  };

  it('commutative: merge(x,y) === merge(y,x)', () => {
    expect(mergeBudget(x, y)).toEqual(mergeBudget(y, x));
  });

  it('idempotent: merge(x, merge(x,y)) === merge(x,y)', () => {
    const xy = mergeBudget(x, y);
    expect(mergeBudget(x, xy)).toEqual(xy);
    expect(mergeBudget(xy, xy)).toEqual(xy);
  });
});

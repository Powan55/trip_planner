/**
 * Expense-split "who owes whom" settlement.
 *
 * FRAMEWORK-FREE: plain TypeScript — no React, no window, no clock, no
 * storage. A READ-ONLY derivation over the SAME `Expense[]` the budget rolls up: it does NOT
 * touch `expensesToSpent` / `rollUp` / the burn-rate — an expense's `amount` still counts fully
 * toward leg/category spend regardless of split. Split is only about who reimburses whom.
 *
 * ── The model ────────────────────────────────────────────────────────────
 * Each expense that carries a non-empty `split` (the TRAVELERS ids sharing it) is divided EVENLY:
 * every member owes `amount / |split|` to the payer (`paidBy`, or the `self` fallback when a split
 * expense carries no explicit payer). Net each participant's balance (paid − owed), then greedily
 * match the largest creditor to the largest debtor to emit a MINIMAL transfer set (≤ participants−1;
 * circular debts a→b→c→a net flat ⇒ zero transfers).
 *
 * ── Per-leg / per-currency isolation ────────────────────────────────────────────────
 * Amounts are leg-local (Nepal→NPR, Japan→JPY), so settlement runs INDEPENDENTLY per leg and the
 * result is one `LegSettlement` per leg that has ≥1 attributable split expense. NPR and JPY are
 * NEVER summed — each leg carries its own `currency` for display.
 *
 * Even-split only (ponytail: a boys-trip settles even; weighted split is a rare later affordance).
 */

import type { Expense } from './expenses';
import { legCurrency, type CurrencyCode, type Leg } from './model';

/** One "from pays to amount" reimbursement (leg-local currency). */
export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

/** The settlement for a single leg (one currency). */
export interface LegSettlement {
  leg: Leg;
  currency: CurrencyCode;
  /** Net per participant in leg-local currency: >0 owed TO them, <0 they owe. Participants only. */
  balances: Record<string, number>;
  /** The minimal set of transfers that clears every balance (≤ participants−1). */
  transfers: Transfer[];
}

// Sub-unit tolerance: NPR/JPY are whole-unit at trip scale, so anything under half a unit is noise
// (an even division remainder). Balances within EPS of 0 are treated as settled.
const EPS = 0.005;

const LEGS: readonly Leg[] = ['nepal', 'japan'] as const;

function uniq(ids: readonly string[]): string[] {
  return Array.from(new Set(ids));
}

/**
 * Settle every leg's split expenses into net balances + a minimal transfer set. Fast-path/no-split
 * expenses (and tombstoned rows) contribute NOTHING. `travelers` is the roster used only for a
 * stable output order; `self` is the payer fallback for a split expense with no explicit `paidBy`
 * (the current traveler = "me"). Returns one `LegSettlement` per leg with ≥1 attributable split —
 * an empty array when nothing is split (⇒ the UI hides the "Settle up" summary). PURE + TOTAL.
 */
export function settle(
  expenses: readonly Expense[],
  travelers: readonly string[] = [],
  self?: string,
): LegSettlement[] {
  const out: LegSettlement[] = [];

  for (const leg of LEGS) {
    const balances: Record<string, number> = {};
    const ensure = (id: string) => {
      if (!(id in balances)) balances[id] = 0;
    };

    for (const e of expenses) {
      if (e.leg !== leg || e.deleted === true) continue;
      if (!Array.isArray(e.split) || e.split.length === 0) continue; // fast path / not split
      const members = uniq(e.split.filter((m) => typeof m === 'string' && m.length > 0));
      if (members.length === 0) continue;
      const payer = e.paidBy && e.paidBy.length > 0 ? e.paidBy : self;
      if (!payer) continue; // unattributable (no payer, no self) — skip
      const amount = typeof e.amount === 'number' && e.amount > 0 ? e.amount : 0;
      if (amount <= 0) continue;

      const share = amount / members.length;
      ensure(payer);
      balances[payer] += amount; // fronted the whole bill
      for (const m of members) {
        ensure(m);
        balances[m] -= share; // owes an even share (payer nets to +amount−share if also a member)
      }
    }

    if (Object.keys(balances).length === 0) continue; // no attributable split on this leg
    out.push({
      leg,
      currency: legCurrency(leg),
      balances,
      transfers: minimalTransfers(balances, travelers),
    });
  }

  return out;
}

/**
 * Greedy minimal-transfer solver: repeatedly settle the largest creditor against the largest
 * debtor. Each step exhausts at least one party, so it emits ≤ (creditors+debtors)−1 ≤ participants−1
 * transfers. Not an LP optimum (ponytail: greedy is correct + minimal for the ≤3-person trip case).
 * ponytail: O(n log n) greedy; swap for an exact solver only if a many-person split ever ships.
 */
function minimalTransfers(balances: Record<string, number>, order: readonly string[]): Transfer[] {
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? order.length : i;
  };
  // Descending by magnitude, roster order as the deterministic tie-break.
  const byAmt = (a: { id: string; amt: number }, b: { id: string; amt: number }) =>
    b.amt - a.amt || rank(a.id) - rank(b.id);

  const creditors = Object.entries(balances)
    .filter(([, v]) => v > EPS)
    .map(([id, v]) => ({ id, amt: v }))
    .sort(byAmt);
  const debtors = Object.entries(balances)
    .filter(([, v]) => v < -EPS)
    .map(([id, v]) => ({ id, amt: -v }))
    .sort(byAmt);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < creditors.length && j < debtors.length) {
    const give = Math.min(creditors[i].amt, debtors[j].amt);
    if (give > EPS) transfers.push({ from: debtors[j].id, to: creditors[i].id, amount: give });
    creditors[i].amt -= give;
    debtors[j].amt -= give;
    if (creditors[i].amt <= EPS) i++;
    if (debtors[j].amt <= EPS) j++;
  }
  return transfers;
}

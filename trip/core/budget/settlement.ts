/**
 * Expense-split "who owes whom" settlement.
 *
 * FRAMEWORK-FREE: plain TypeScript — no React, no window, no clock, no
 * storage. A READ-ONLY derivation over the SAME `Expense[]` the budget rolls up: it does NOT
 * touch `expensesToSpent` / `rollUp` / the burn-rate — an expense's `amount` still counts fully
 * toward leg/category spend regardless of split. Split is only about who reimburses whom.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Each expense that carries a non-empty `split` (the TRAVELERS ids sharing it) is divided EVENLY:
 * every member owes `amount / |split|` to the payer (`paidBy`). Net each participant's balance
 * (paid − owed), then greedily match the largest creditor to the largest debtor to emit a MINIMAL
 * transfer set (≤ participants−1; circular debts a→b→c→a net flat ⇒ zero transfers).
 *
 * ── A split row with NO `paidBy` is UNATTRIBUTABLE, never "me" (D-333) ──────────────────────
 * This function takes NO identity argument on purpose. It used to fall an absent `paidBy` back to
 * the signed-in traveller, which made a settlement a function of WHO IS LOOKING: the same synced row
 * settled to a different person on each device, and a claim-authorship rename moved its balance to
 * the new name — the exact "re-point who owes whom" that D-288 keeps the claim rewrite away from
 * `paidBy`/`split` to prevent, arriving through the read path instead of a write. Every other reader
 * of `paidBy` already treats absent as absent (`lib/expense-csv.ts` emits '', `rosterForActiveTrip`
 * skips it), so the fallback was also the odd one out. A payer we do not know is not a payer we may
 * invent: the row contributes nothing, exactly like a fast-path or tombstoned one.
 *
 * ── Per-leg / per-currency isolation ────────────────────────────────────────────────
 * Amounts are leg-local (Nepal→NPR, Japan→JPY), so settlement runs INDEPENDENTLY per leg and the
 * result is one `LegSettlement` per leg that has ≥1 attributable split expense. NPR and JPY are
 * NEVER summed — each leg carries its own `currency` for display.
 *
 * Even-split only.
 */

import type { Expense } from './expenses';
import { legCurrency, LEGS, type CurrencyCode, type Leg } from './model';

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

function uniq(ids: readonly string[]): string[] {
  return Array.from(new Set(ids));
}

/** Round every balance to its currency's display unit (0.01 for a 2-decimal currency like USD,
 * 1 for a whole-unit currency), using largest-remainder apportionment so the rounded balances
 * still sum to exactly 0 — the property `minimalTransfers` needs: since it matches by
 * Math.min(creditor, debtor) on already-rounded numbers, every emitted transfer is naturally a
 * whole display-unit, and each creditor's transfers-received sum to exactly their rounded
 * balance. Without this, three balances derived from a repeating decimal (e.g. a 3-way split)
 * round independently and no longer sum to 0, so transfers can't sum to the displayed balance. */
function roundBalances(balances: Record<string, number>, unit: number): Record<string, number> {
  const ids = Object.keys(balances);
  const scaled = ids.map((id) => balances[id] / unit);
  const floors = scaled.map(Math.floor);
  const remainders = scaled.map((v, i) => v - floors[i]);
  let deficit = Math.round(scaled.reduce((s, v) => s + v, 0) - floors.reduce((s, v) => s + v, 0));
  // Hand out the leftover whole units, one at a time, to the entries with the largest remainder.
  const order = ids.map((_, i) => i).sort((a, b) => remainders[b] - remainders[a]);
  const rounded = [...floors];
  for (let k = 0; k < deficit && k < order.length; k++) rounded[order[k]] += 1;
  const out: Record<string, number> = {};
  ids.forEach((id, i) => { out[id] = rounded[i] * unit; });
  return out;
}

/**
 * Settle every leg's split expenses into net balances + a minimal transfer set. Fast-path/no-split
 * expenses, tombstoned rows, and split rows with no recorded `paidBy` (D-333) all contribute
 * NOTHING. `travelers` is the roster used only for a stable output order — it carries no identity
 * and there is deliberately no "who am I" parameter, so the result is the same on every device.
 * Returns one `LegSettlement` per leg with ≥1 attributable split — an empty array when nothing is
 * split (⇒ the UI hides the "Settle up" summary). PURE + TOTAL.
 */
export function settle(
  expenses: readonly Expense[],
  travelers: readonly string[] = [],
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
      const payer = e.paidBy;
      // No recorded payer ⇒ unattributable. NOT the signed-in traveller (D-333) — see the header.
      if (typeof payer !== 'string' || payer.length === 0) continue;
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
    const currency = legCurrency(leg);
    const rounded = roundBalances(balances, currency === 'USD' ? 0.01 : 1);
    out.push({
      leg,
      currency,
      balances: rounded,
      transfers: minimalTransfers(rounded, travelers),
    });
  }

  return out;
}

/**
 * Greedy minimal-transfer solver: repeatedly settle the largest creditor against the largest
 * debtor. Each step exhausts at least one party, so it emits ≤ (creditors+debtors)−1 ≤ participants−1
 * transfers. Not an LP optimum.
 * O(n log n) greedy; swap for an exact solver only if a many-person split ever ships.
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

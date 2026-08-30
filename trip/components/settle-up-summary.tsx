'use client';

import { ArrowRight, Users } from 'lucide-react';
import { formatMoney } from '@/core/budget/model';
import { EPS, type LegSettlement } from '@/core/budget/settlement';
import { rosterAccent } from '@/lib/token-auth';
import { legLabel } from '@/lib/leg-label';

/**
 * "Settle up" summary — the read-only who-owes-whom view over the split expenses.
 *
 * Presentation-only: it renders the pure `settle()` result (`LegSettlement[]`, one per leg with a
 * split, per-currency isolated —). The parent (`budget-panel`) computes the settlement and
 * only mounts this when there is ≥1 split expense, so `settlements` is always non-empty here.
 * No effect, no store — a straight map over the math (extracted from budget-panel to keep that
 * file bounded, light module split).
 *
 * Per leg: each participant's net (owed to them / they owe), then the minimal "A → B ¥X" transfers.
 */

export default function SettleUpSummary({ settlements }: { settlements: LegSettlement[] }) {
  if (settlements.length === 0) return null;

  return (
    <div
      data-testid="settle-up"
      className="mt-6 border-hair border-[color:hsl(var(--border))] bg-[rgb(var(--surface-low))]"
    >
      <div className="flex items-center gap-2 border-b-2 border-[color:hsl(var(--border))] px-gut py-2">
        <Users className="h-3.5 w-3.5 shrink-0 text-ink-lo" aria-hidden="true" />
        <h3 className="pr pr--l text-ink-hi">Settle up</h3>
      </div>

      <div className="flex flex-col gap-5 py-3">
        {settlements.map((s) => {
          const balances = Object.entries(s.balances);
          return (
            <div key={s.leg} data-testid={`settle-up-leg-${s.leg}`} className="flex flex-col gap-3">
              <p className="pr pr--lo px-gut">
                {legLabel(s.leg)} · {s.currency}
              </p>

              {/* Per-person net */}
              <ul className="flex flex-wrap gap-2 px-gut" data-testid={`settle-up-balances-${s.leg}`}>
                {balances.map(([id, net]) => {
                  // `settle()`'s own tolerance, not a hardcoded half unit: a 0.5 threshold is a
                  // whole-unit assumption (NPR/JPY) and called every USD balance under 50 cents
                  // "settled" while the transfer list below printed the payment still owed.
                  const settled = Math.abs(net) < EPS;
                  return (
                    <li
                      key={id}
                      data-testid={`settle-up-balance-${s.leg}-${id}`}
                      className={`chip gap-1.5 ${settled ? 'chip--hollow' : 'chip--struck'}`}
                    >
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: rosterAccent(id) }}
                      />
                      <span>{id}</span>
                      {settled ? (
                        <span className="text-ink-lo">settled</span>
                      ) : net > 0 ? (
                        <span className="num">is owed {formatMoney(net, s.currency)}</span>
                      ) : (
                        <span className="num">owes {formatMoney(-net, s.currency)}</span>
                      )}
                    </li>
                  );
                })}
              </ul>

              {/* Minimal transfers */}
              {s.transfers.length === 0 ? (
                <p className="empty px-gut" data-testid={`settle-up-even-${s.leg}`}>
                  All square — nobody owes anybody.
                </p>
              ) : (
                <ul className="list list-none" data-testid={`settle-up-transfers-${s.leg}`}>
                  {s.transfers.map((t) => (
                    <li
                      key={`${t.from}-${t.to}`}
                      data-testid={`settle-up-transfer-${s.leg}-${t.from}-${t.to}`}
                      className="r [--cols:auto_auto_1fr_auto] !items-center text-t-body text-ink-hi"
                    >
                      <span className="font-semibold">{t.from}</span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-lo" aria-hidden="true" />
                      <span className="font-semibold">{t.to}</span>
                      <span className="num text-n-sm">
                        {formatMoney(t.amount, s.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

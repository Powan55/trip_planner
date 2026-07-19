'use client';

import { ArrowRight, Users } from 'lucide-react';
import { formatMoney } from '@/core/budget/model';
import type { LegSettlement } from '@/core/budget/settlement';
import { TRAVELERS } from '@/lib/token-auth';

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

/** Brand accent for a traveler chip (falls back to gold for an unknown id). */
function accentFor(id: string): string {
  return TRAVELERS.find((t) => t.name === id)?.accent ?? '#f0c760';
}

const LEG_LABEL: Record<string, string> = { nepal: 'Nepal', japan: 'Japan' };

export default function SettleUpSummary({ settlements }: { settlements: LegSettlement[] }) {
  if (settlements.length === 0) return null;

  return (
    <div
      data-testid="settle-up"
      className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <div className="mb-4 flex items-center gap-2">
        <Users className="h-5 w-5 shrink-0 text-gold-400" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-white sm:text-base">Settle up</h3>
      </div>

      <div className="flex flex-col gap-5">
        {settlements.map((s) => {
          const balances = Object.entries(s.balances);
          return (
            <div key={s.leg} data-testid={`settle-up-leg-${s.leg}`} className="flex flex-col gap-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-white/50">
                {LEG_LABEL[s.leg] ?? s.leg} · {s.currency}
              </p>

              {/* Per-person net */}
              <ul className="flex flex-wrap gap-2" data-testid={`settle-up-balances-${s.leg}`}>
                {balances.map(([id, net]) => {
                  const settled = Math.abs(net) < 0.5;
                  return (
                    <li
                      key={id}
                      data-testid={`settle-up-balance-${s.leg}-${id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-surface/40 px-2.5 py-1 text-xs"
                    >
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: accentFor(id) }}
                      />
                      <span className="font-medium text-white/80">{id}</span>
                      {settled ? (
                        <span className="text-white/40">settled</span>
                      ) : net > 0 ? (
                        <span className="text-emerald-300/90">
                          is owed {formatMoney(net, s.currency)}
                        </span>
                      ) : (
                        <span className="text-gold-300/90">owes {formatMoney(-net, s.currency)}</span>
                      )}
                    </li>
                  );
                })}
              </ul>

              {/* Minimal transfers */}
              {s.transfers.length === 0 ? (
                <p className="text-xs text-white/50" data-testid={`settle-up-even-${s.leg}`}>
                  All square — nobody owes anybody.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5" data-testid={`settle-up-transfers-${s.leg}`}>
                  {s.transfers.map((t) => (
                    <li
                      key={`${t.from}-${t.to}`}
                      data-testid={`settle-up-transfer-${s.leg}-${t.from}-${t.to}`}
                      className="flex items-center gap-2 text-sm text-white/80"
                    >
                      <span className="font-semibold text-white">{t.from}</span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-white/40" aria-hidden="true" />
                      <span className="font-semibold text-white">{t.to}</span>
                      <span className="ml-auto font-semibold text-gold-300">
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

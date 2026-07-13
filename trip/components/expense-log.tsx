'use client';

import { useMemo } from 'react';
import { Plus, Pencil, Trash2, ReceiptText, Users } from 'lucide-react';
import { CATEGORY_COLORS } from '@/lib/trip-data';
import { legCurrency, formatMoney } from '@/core/budget/model';
import type { Expense } from '@/core/budget/expenses';

/**
 * The expense log (extracted from budget-panel in a light module split — behavior
 * byte-identical): a "Log expense" trigger (emits `expense:open` via the parent's `onLog`) + the
 * list of logged expenses (newest first) with per-row edit + delete. Amounts show in each expense's
 * leg-local currency. Empty state when nothing is logged yet. A split expense shows a small
 * "split" chip so the "Settle up" summary below is discoverable.
 */
export default function ExpenseLog({
  expenses,
  onLog,
  onEdit,
  onDelete,
}: {
  expenses: Expense[];
  onLog: () => void;
  onEdit: (expense: Expense) => void;
  onDelete: (expense: Expense) => void;
}) {
  // Newest first — sort a copy by createdAt descending (the core keeps insertion order).
  const ordered = useMemo(
    () => [...expenses].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)),
    [expenses],
  );

  return (
    <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5" data-testid="expense-log">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ReceiptText className="h-5 w-5 shrink-0 text-gold-400" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-white sm:text-base">Logged expenses</h3>
        </div>
        <button
          type="button"
          onClick={onLog}
          data-testid="expense-log-open"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-gold-500 px-3.5 py-2 text-sm font-semibold text-navy-900 transition-colors hover:bg-gold-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Log expense
        </button>
      </div>

      {ordered.length === 0 ? (
        <div
          data-testid="expense-log-empty"
          className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center"
        >
          <p className="text-sm text-white/60">No expenses logged yet.</p>
          <p className="mt-1 text-xs text-white/55">
            Tap “Log expense” to record a meal, a taxi, or a ticket — it counts against your budget above.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="expense-list">
          {ordered.map((e) => {
            const cur = legCurrency(e.leg);
            const colors = CATEGORY_COLORS[e.category];
            const splitCount = Array.isArray(e.split) ? e.split.length : 0;
            return (
              <li
                key={e.id}
                data-testid={`expense-item-${e.id}`}
                className="flex items-center gap-3 rounded-lg border border-white/10 bg-navy-900/40 p-3"
              >
                <span
                  className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${colors.bg} ${colors.text}`}
                >
                  {e.category}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white" data-testid={`expense-item-${e.id}-amount`}>
                    {formatMoney(e.amount, cur)}
                    <span className="ml-1.5 text-xs font-normal capitalize text-white/40">· {e.leg}</span>
                    {splitCount > 0 && (
                      <span
                        data-testid={`expense-item-${e.id}-split`}
                        className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-white/10 px-1.5 py-0.5 align-middle text-[0.65rem] font-normal text-white/60"
                      >
                        <Users className="h-3 w-3" aria-hidden="true" />
                        split {splitCount}
                      </span>
                    )}
                  </p>
                  {e.note && <p className="truncate text-xs text-white/50">{e.note}</p>}
                  {/* "Logged by {name}" attribution — present only on a synced
                      expense stamped by an active traveler; dormant rows carry no createdBy. */}
                  {e.createdBy && (
                    <p className="truncate text-[0.7rem] text-white/40" data-testid={`expense-item-${e.id}-author`}>
                      logged by {e.createdBy}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onEdit(e)}
                  data-testid={`expense-item-edit-${e.id}`}
                  aria-label={`Edit ${e.category} expense of ${formatMoney(e.amount, cur)}`}
                  className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(e)}
                  data-testid={`expense-item-delete-${e.id}`}
                  aria-label={`Delete ${e.category} expense of ${formatMoney(e.amount, cur)}`}
                  className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-red-500/20 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

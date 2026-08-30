'use client';

import { useMemo } from 'react';
import { Plus, Pencil, Trash2, ReceiptText, Users } from 'lucide-react';
import { CATEGORY_COLORS, type ItineraryCategory } from '@/lib/trip-data';
import { legCurrency, formatMoney } from '@/core/budget/model';
import type { Expense } from '@/core/budget/expenses';

/**
 * The expense log ( extracted from budget-panel in light module split — behavior
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
    <div className="mt-6 border-hair border-[color:hsl(var(--border))] bg-[rgb(var(--surface-low))]" data-testid="expense-log">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[color:hsl(var(--border))] px-gut py-2">
        <div className="flex items-center gap-2">
          <ReceiptText className="h-3.5 w-3.5 shrink-0 text-ink-lo" aria-hidden="true" />
          <h3 className="pr pr--l text-ink-hi">Logged expenses</h3>
        </div>
        <button
          type="button"
          onClick={onLog}
          data-testid="expense-log-open"
          className="btn px-4 focus-visible:outline-none"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Log expense
        </button>
      </div>

      {ordered.length === 0 ? (
        // The empty state renders the SHAPE of the thing that is missing at the size it
        // will be, plus the condition that fills it. Three ruled slots with the real field names
        // printed on them, not a grey sentence; the copy sits at --t-body / --text-mid and points
        // forward rather than captioning an absence.
        <div data-testid="expense-log-empty">
          <div className="list">
            {[1, 2, 3].map((slot) => (
              <div key={slot} className="r" data-mark="hollow" aria-hidden="true">
                <span className="tm !text-ink-lo">{String(slot).padStart(2, '0')}</span>
                <span className="min-w-0">
                  <span className="empty-frame block h-4 w-full max-w-[14rem]" />
                  <span className="mt">amount · category · leg</span>
                </span>
                <span className="hollow-tag">unwritten</span>
              </div>
            ))}
          </div>
          <p className="empty px-gut py-3">
            Nothing has been written into the log yet. Ten categories and two leg currencies are
            ruled and waiting — “Log expense” records the first meal, taxi or ticket against the
            budget above.
          </p>
        </div>
      ) : (
        <ul className="list list-none" data-testid="expense-list">
          {ordered.map((e) => {
            const cur = legCurrency(e.leg);
            // A forward/unrecognised category (#150) is retained on the row but has no color
            // entry — fall back to 'free's, same fallback `calendar-sortable-item.tsx` already
            // uses for the itinerary side of this exact category widening.
            const colors = CATEGORY_COLORS[e.category as ItineraryCategory] ?? CATEGORY_COLORS.free;
            const splitCount = Array.isArray(e.split) ? e.split.length : 0;
            return (
              <li
                key={e.id}
                data-testid={`expense-item-${e.id}`}
                className="r [--cols:auto_1fr_auto_auto] !items-center"
              >
                <span className={`chip shrink-0 capitalize ${colors.text}`}>{e.category}</span>
                {/* 🔴 — MOBILE-ONLY UNCLIP. Measured on a real 390px shoot: this row spends
                    ~150 of its ~241px inner width on the shrink-0 category chip + the two 44px
                    (a11y-floor) icon buttons + three 12px gaps, leaving the text column ~89px. With
                    `truncate` unconditional, EVERY line ellipsised — `¥11,700…`, `Izakaya, …`,
                    `logged by…` — and the `split N` chip, which lives inside the amount line, was
                    clipped away ENTIRELY. No check in this repo could see it: `innerText` returns
                    the full string regardless of a CSS ellipsis, so `e2e/budget.spec.ts` is green on
                    a row a phone user cannot read. Gating the clamp at `sm:` lets the lines WRAP
                    below 640px (nothing hidden, row just gets taller — correct for mobile) and
                    leaves ≥640px byte-identical to the shipped behaviour. This is a root-cause fix
                    for a live mobile defect, not a screenshot tweak — but is what surfaced it,
                    and a marketing shot of a clipped row is why it could not be deferred. */}
                <div className="min-w-0 flex-1">
                  <p className="num text-t-body text-ink-hi sm:truncate" data-testid={`expense-item-${e.id}-amount`}>
                    {formatMoney(e.amount, cur)}
                    <span className="ml-1.5 font-machine text-t-micro uppercase tracking-[0.11em] text-ink-mid">· {e.leg}</span>
                    {splitCount > 0 && (
                      <span
                        data-testid={`expense-item-${e.id}-split`}
                        className="chip ml-1.5 align-middle"
                      >
                        <Users className="h-3 w-3" aria-hidden="true" />
                        split {splitCount}
                      </span>
                    )}
                  </p>
                  {e.note && (
                    <p
                      className="text-t-sm text-ink-hi sm:truncate"
                      data-testid={`expense-item-${e.id}-note`}
                    >
                      {e.note}
                    </p>
                  )}
                  {/* "Logged by {name}" attribution — present only on a synced
                      expense stamped by an active traveler; dormant rows carry no createdBy. */}
                  {e.createdBy && (
                    <p className="mt sm:truncate" data-testid={`expense-item-${e.id}-author`}>
                      logged by {e.createdBy}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onEdit(e)}
                  data-testid={`expense-item-edit-${e.id}`}
                  aria-label={`Edit ${e.category} expense of ${formatMoney(e.amount, cur)}`}
                  className="inline-flex min-h-tap min-w-tap shrink-0 items-center justify-center rounded-r1 text-ink-mid transition-colors hover:bg-white/5 hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(e)}
                  data-testid={`expense-item-delete-${e.id}`}
                  aria-label={`Delete ${e.category} expense of ${formatMoney(e.amount, cur)}`}
                  className="inline-flex min-h-tap min-w-tap shrink-0 items-center justify-center rounded-r1 text-ink-mid transition-colors hover:bg-white/5 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

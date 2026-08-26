'use client';

import { useId, useState } from 'react';
import { Plus, X, Check } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateLong, getCountryForDate } from '@/core/dates';
import { useExpenses } from '@/hooks/use-expenses';
import { BUDGET_CATEGORIES, legCurrency, currencySymbol, formatMoney, type Leg } from '@/core/budget/model';

/**
 * #260 — inline expense quick-add for Travel Mode (Lane T). Fills the same "log without leaving
 * the checklist" gap S318/`TravelLogDifferent` fills for itinerary items, one slot below it.
 *
 * TM-9: INLINE only — no modal, no portal. Lives inside the Travel Mode root (mounted by
 * `travel-date-picker.tsx`, same as `TravelLogDifferent`), so `ExpenseLogHost`'s /travel
 * suppression guard (expense-log-host.tsx:66) is untouched and zero app chrome leaks. Does NOT
 * import `ExpenseDialog` or `createPortal` — reuses the same underlying pieces that dialog uses
 * (`useExpenses`, `BUDGET_CATEGORIES`, `legCurrency`/`currencySymbol`/`formatMoney`) without its
 * modal chrome (portal, Tab-trap, Esc handler, focus-return).
 *
 * Fields: amount (required) + category (required, defaults 'food') + note (optional) — the same
 * three the dialog treats as the fast path (split/leg-picker are opt-in extras skipped here on
 * purpose: the leg is the VIEWED day's leg, not a free choice, so there is nothing to pick).
 *
 * Leg is DERIVED from `date` (`getCountryForDate`), not user-chosen: unlike the global dialog
 * (which can be opened from anywhere and must guess a leg), this affordance is already scoped to
 * one day, so its leg is never ambiguous.
 *
 * Collapsed by default, same as `TravelLogDifferent`, so it never competes with the checklist for
 * primary attention. No motion — reveal is a plain conditional render (reduced-motion-safe).
 */

export default function TravelExpenseQuickAdd({ date }: { date: string }) {
  const { addExpense } = useExpenses();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string>('food');
  const [note, setNote] = useState('');

  const dayLabel = formatDateLong(date);
  const leg: Leg = getCountryForDate(date);
  const cur = legCurrency(leg);
  const sym = currencySymbol(cur);

  const baseId = useId();
  const amountFieldId = `${baseId}-amount`;
  const categoryLabelId = `${baseId}-category-label`;
  const noteFieldId = `${baseId}-note`;

  const numericAmount = amount === '' ? NaN : Number(amount);
  const amountValid = Number.isFinite(numericAmount) && numericAmount > 0;

  const handleSave = () => {
    if (!amountValid) return; // guard (the button is also disabled)
    const value = Number(amount);
    const trimmedNote = note.trim();
    addExpense({ leg, category, amount: value, date, note: trimmedNote || undefined });
    toast.success(`Logged ${formatMoney(value, cur)} ${category}`);
    // Clear + stay expanded, same as TravelLogDifferent, so several expenses can be logged in a row.
    setAmount('');
    setNote('');
  };

  return (
    <div data-testid="travel-expense-quickadd-slot" className="mx-auto mt-4 max-w-2xl">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="travel-expense-quickadd-trigger"
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[color:var(--border-ui)] bg-white/[0.03] px-4 py-3 text-sm font-medium text-ink-mid outline-none transition-colors duration-200 hover:bg-white/[0.06] hover:text-ink-hi focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Log an expense
        </button>
      ) : (
        <div className="rounded-2xl glass-card p-3 sm:p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-mid">
              Log an expense for {dayLabel}
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Collapse log an expense"
              data-testid="travel-expense-quickadd-collapse"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-mid outline-none transition-colors hover:bg-white/10 hover:text-ink-hi focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative sm:w-32">
              <label htmlFor={amountFieldId} className="sr-only">
                {`Amount (${cur}) for ${dayLabel}`}
              </label>
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-lo ${sym === 'Rs' ? 'left-3 text-sm' : 'left-3 text-base'}`}
              >
                {sym}
              </span>
              <input
                id={amountFieldId}
                data-testid="travel-expense-quickadd-amount"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && amountValid) {
                    e.preventDefault();
                    handleSave();
                  }
                }}
                placeholder="0"
                autoComplete="off"
                className={`min-h-[44px] w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pr-3 text-sm text-white placeholder:text-ink-lo outline-none focus:ring-1 focus:ring-ring focus-visible:ring-2 focus-visible:ring-ring ${sym === 'Rs' ? 'pl-9' : 'pl-8'}`}
              />
            </div>

            <div className="sm:w-40">
              <label htmlFor={categoryLabelId} className="sr-only">
                {`Category for the expense on ${dayLabel}`}
              </label>
              <select
                id={categoryLabelId}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                data-testid="travel-expense-quickadd-category"
                className="min-h-[44px] w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm capitalize text-white outline-none focus:ring-1 focus:ring-ring focus-visible:ring-2 focus-visible:ring-ring"
              >
                {BUDGET_CATEGORIES.map((c) => (
                  <option key={c} value={c} className="bg-surface capitalize text-white">
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1">
              <label htmlFor={noteFieldId} className="sr-only">
                {`Optional note for the expense on ${dayLabel}`}
              </label>
              <input
                id={noteFieldId}
                data-testid="travel-expense-quickadd-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && amountValid) {
                    e.preventDefault();
                    handleSave();
                  }
                }}
                placeholder="Note (optional)"
                autoComplete="off"
                className="min-h-[44px] w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-ink-lo outline-none focus:ring-1 focus:ring-ring focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <button
              type="button"
              onClick={handleSave}
              disabled={!amountValid}
              data-testid="travel-expense-quickadd-save"
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

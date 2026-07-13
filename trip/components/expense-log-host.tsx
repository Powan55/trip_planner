'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import ExpenseDialog from '@/components/expense-dialog';
import { getTodayInTrip } from '@/lib/trip-now';
import { getSelectedDay } from '@/lib/selected-day';
import { getCountryForDate } from '@/core/dates';
import { TRIP_DATES } from '@/lib/trip-data';
import type { Leg } from '@/core/budget/model';
import type { Expense } from '@/core/budget/expenses';

/**
 * Global, invisible host for the fast expense-log flow.
 *
 * Mounted ONCE in the root layout beside `QuickAddHost` (`dynamic ssr:false`). It renders nothing
 * until an event arrives; it listens on `window` for the CustomEvent `expense:open` — emitted by
 * the budget panel's "Log expense" button (add) and its per-row "Edit" button (edit) — and opens
 * `ExpenseDialog` preset to the resolved leg/date (add) or to the passed expense (edit):
 *
 *   window.dispatchEvent(new CustomEvent('expense:open'))                       // add, auto leg
 *   window.dispatchEvent(new CustomEvent('expense:open', { detail: { expense } })) // edit
 *
 * This is a PARALLEL trigger to the itinerary quick-add FAB (its OWN event + host + dialog) — the
 * itinerary FAB is left single-purpose. The dialog owns the full modal contract
 * (portal + Esc/Tab-trap + the `body[data-dialog-open]` flag); focus-return is parent-owned here:
 * we capture `document.activeElement` when the event fires (the "Log expense" / "Edit"
 * button) and refocus it once the exit animation completes.
 *
 * LEG PRESET (usually right with zero taps): `getTodayInTrip()?.country` when we're mid-trip, else
 * the leg of the calendar's selected day (`getCountryForDate(getSelectedDay())`), else the first
 * trip day's leg. `getCountryForDate` returns 'nepal' | 'japan' === Leg, so no mapping is needed.
 * In edit mode the leg/date come from the expense, so the preset is ignored.
 */

interface ExpenseOpenDetail {
  /** Edit mode: the expense to edit. Absent ⇒ add mode. */
  expense?: Expense;
  /** Optional explicit leg override for add mode (else auto-resolved). */
  leg?: Leg;
  /** Optional explicit date ('YYYY-MM-DD') for add mode (else auto-resolved). */
  date?: string;
}

export const EXPENSE_OPEN_EVENT = 'expense:open';

/** Resolve the add-mode leg preset from the trip clock → selected day → first trip day. */
function resolveLeg(): Leg {
  const today = getTodayInTrip();
  if (today) return today.country as Leg;
  const selected = getSelectedDay() ?? TRIP_DATES[0];
  return getCountryForDate(selected) as Leg;
}

/** Resolve the add-mode date preset (today in-trip → selected day → first trip day). */
function resolveDate(): string {
  return getTodayInTrip()?.date ?? getSelectedDay() ?? TRIP_DATES[0];
}

export default function ExpenseLogHost() {
  const [open, setOpen] = useState(false);
  const [presetLeg, setPresetLeg] = useState<Leg>('nepal');
  const [presetDate, setPresetDate] = useState<string | undefined>(undefined);
  const [editExpense, setEditExpense] = useState<Expense | undefined>(undefined);
  // Parent-owned focus-return target: captured when the event fires, refocused on exit.
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<ExpenseOpenDetail>).detail;
      triggerRef.current = (document.activeElement as HTMLElement) ?? null;
      if (detail?.expense) {
        // Edit mode: leg/date come from the expense; preset is unused.
        setEditExpense(detail.expense);
        setPresetLeg(detail.expense.leg);
        setPresetDate(detail.expense.date);
      } else {
        // Add mode: resolve the leg/date preset now (at open time).
        setEditExpense(undefined);
        setPresetLeg(detail?.leg ?? resolveLeg());
        setPresetDate(detail?.date ?? resolveDate());
      }
      setOpen(true);
    };
    window.addEventListener(EXPENSE_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(EXPENSE_OPEN_EVENT, onOpen);
  }, []);

  return (
    <AnimatePresence
      onExitComplete={() => {
        triggerRef.current?.focus?.();
      }}
    >
      {open && (
        <ExpenseDialog
          open={open}
          presetLeg={presetLeg}
          presetDate={presetDate}
          expense={editExpense}
          onClose={() => setOpen(false)}
        />
      )}
    </AnimatePresence>
  );
}

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { STORAGE_KEYS } from '@/core/storage/gateway';
import { loadExpenses, saveExpenses } from '@/core/budget/storage';
import {
  addExpense as addExpenseCore,
  updateExpense as updateExpenseCore,
  removeExpense as removeExpenseCore,
  type Expense,
  type NewExpenseInput,
} from '@/core/budget/expenses';

/**
 * Reactive expense store (expense LOGGING).
 *
 * A THIN React adapter over the framework-free expense core (`core/budget/expenses.ts`) +
 * the load/save adapter (`core/budget/storage.ts`, gateway key 11). It mirrors
 * `hooks/use-itinerary.ts`'s reactivity — but SIMPLER: no sync fan-out, no attribution,
 * no tombstones (expenses are a private, single-user, localStorage-only domain).
 *
 * Reactivity (mirrors the itinerary store's idiom):
 *  - Every mutator writes via `saveExpenses()` AND dispatches a same-tab CustomEvent
 *    (`EXPENSES_CHANGED_EVENT`) on `window`, so the budget panel (which reads spent/remaining
 *    off the same list) updates live the instant an expense is logged from the global dialog.
 *  - The hook listens for that CustomEvent (same-tab liveness) AND the cross-tab `storage`
 *    event, re-reading from storage on either — via the exported key constant, never a literal.
 *
 * SSR-safe + hydrated gate (mirrors `use-itinerary.ts`): the list starts `[]` (matching the
 * server render), hydrates from `loadExpenses()` in a mount effect, and every mutator reads the
 * FRESHEST persisted state as its base (not a stale React closure) so multiple mutations in one
 * handler compose. `hydrated` is exposed so a consumer can defer a persist-on-first-render.
 *
 * Instantiated per-consumer (there is no provider — unlike the itinerary store): both the budget
 * panel and the expense dialog call `useExpenses()` and stay in lockstep through the CustomEvent,
 * so no shared Context is needed.
 */

export const EXPENSES_CHANGED_EVENT = 'expenses:changed';

export interface ExpenseStore {
  expenses: Expense[];
  hydrated: boolean;
  addExpense(input: NewExpenseInput): void;
  updateExpense(id: string, patch: Partial<NewExpenseInput>): void;
  removeExpense(id: string): void;
  /**
   * Re-insert a COMPLETE, previously-removed expense verbatim — SAME `id` + `createdAt`
   * (delete-Undo). Unlike `addExpense` (which injects a fresh id/createdAt for a brand-new
   * log), this preserves the exact object so an Undo restores byte-identically. Routes through
   * the same `commit()` choke-point (persist + dispatch), reusing the pure `addExpense` core
   * with the object's own id/createdAt; a duplicate id is de-duped so a double-Undo is safe.
   */
  restoreExpense(expense: Expense): void;
}

/**
 * Generate a stable, collision-free expense id at the ADAPTER boundary (the pure core stays
 * id-agnostic). Time-prefixed + a random suffix so two logs in the same millisecond
 * still differ; browser-only (`Date.now`/`Math.random` are fine in a client component).
 */
function generateExpenseId(): string {
  return `exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useExpenses(): ExpenseStore {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const hydratedRef = useRef(false);

  // Load from localStorage on mount. SSR-safe: `loadExpenses()` returns [] under no-window,
  // matching first paint; the real read happens here after mount.
  useEffect(() => {
    setExpenses(loadExpenses());
    setHydrated(true);
    hydratedRef.current = true;
  }, []);

  // Re-read on a same-tab CustomEvent OR a cross-tab `storage` event, so every store instance
  // (the panel + the dialog + any other reader) stays in sync within and across tabs.
  useEffect(() => {
    const reread = () => {
      if (!hydratedRef.current) return;
      setExpenses(loadExpenses());
    };
    const onCustom = () => reread();
    const onStorage = (e: StorageEvent) => {
      // Route through the exported key constant (never a literal) so the cross-tab listener
      // can't silently stop matching if the on-disk key changes. A full clear (key===null) too.
      if (e.key === STORAGE_KEYS.expenses || e.key === null) reread();
    };
    window.addEventListener(EXPENSES_CHANGED_EVENT, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EXPENSES_CHANGED_EVENT, onCustom);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Single commit path: derive `next` from the freshest persisted state (storage is the source of
  // truth), write through `saveExpenses`, update React state, then dispatch the same-tab
  // CustomEvent so other store instances re-read. Gated on `hydrated` so the first-render [] can't
  // clobber a saved list before load.
  const commit = useCallback((compute: (current: Expense[]) => Expense[]) => {
    if (!hydratedRef.current) return;
    const prev = loadExpenses();
    const next = compute(prev);
    saveExpenses(next);
    setExpenses(next);
    window.dispatchEvent(new CustomEvent(EXPENSES_CHANGED_EVENT));
  }, []);

  const addExpense = useCallback(
    (input: NewExpenseInput) => {
      // id + createdAt injected HERE (the pure core stays deterministic).
      commit((current) => addExpenseCore(current, input, generateExpenseId(), new Date().toISOString()));
    },
    [commit],
  );

  const updateExpense = useCallback(
    (id: string, patch: Partial<NewExpenseInput>) => {
      commit((current) => updateExpenseCore(current, id, patch));
    },
    [commit],
  );

  const removeExpense = useCallback(
    (id: string) => {
      commit((current) => removeExpenseCore(current, id));
    },
    [commit],
  );

  const restoreExpense = useCallback(
    (expense: Expense) => {
      // Re-insert verbatim with the expense's OWN id + createdAt (not a freshly generated one),
      // so an Undo restores the exact removed object. De-dupe first so a double-Undo is a no-op.
      const { id, createdAt, ...input } = expense;
      commit((current) => addExpenseCore(removeExpenseCore(current, id), input, id, createdAt));
    },
    [commit],
  );

  return { expenses, hydrated, addExpense, updateExpense, removeExpense, restoreExpense };
}

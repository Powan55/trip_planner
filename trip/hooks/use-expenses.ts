'use client';

import { useCallback, useMemo } from 'react';
import { STORAGE_KEYS } from '@/core/storage/gateway';
import { expensesStoragePort } from '@/core/budget/storage';
import { expensesSyncPort } from '@/lib/expenses-ports';
import { createReactiveStore } from '@/hooks/create-reactive-store';
import { isRemoteConfigured } from '@/lib/firebase-config';
import { getActiveTraveler } from '@/lib/token-auth';
import { getUserName } from '@/lib/identity';
import { clock } from '@/lib/trip-now';
import { firstSyncStamp, nextSyncStamp } from '@/core/sync/stamp';
import {
  addExpense as addExpenseCore,
  updateExpense as updateExpenseCore,
  removeExpense as removeExpenseCore,
  type Expense,
  type ExpenseStamper,
  type NewExpenseInput,
} from '@/core/budget/expenses';

/**
 * Reactive expense store.
 *
 * A thin React adapter over the framework-free expense core (`core/budget/expenses.ts`) + the
 * load/save adapter (`core/budget/storage.ts`, gateway key 11). It wires `createReactiveStore`
 * with the expense `SyncPort` — the shared factory owns the
 * hydrate/listen/commit skeleton (dual-layer reactivity, fresh-base, push-from-commit); this
 * file owns the expense-specific mutators + stamping + the tombstone filter.
 *
 * ── The dormant-build byte-identity guarantee ─────────────────────────────────────────────
 * All stamping — attribution (createdBy/updatedBy) and the sync fields (rev/hlc/deleted), and
 * turning `removeExpense` into a tombstone — is gated on `isRemoteConfigured()`:
 *   - Dormant: `removeExpense` physically removes exactly as today, and no sync/attribution field
 *     is written. The dormant build is byte-for-byte unchanged from before sync existed; the
 *     exposed filter is a no-op (dormant rows carry no `deleted`).
 *   - With sync on: the tombstone + rev/hlc path activates, "logged by {name}" attribution is stamped
 *     from the active traveler, and the exposed `expenses` filters `deleted` so the UI still shows
 *     a normal delete (zero consumer edits). Undo-under-sync is a fresh-id copy
 *     (the same one-rule-everywhere pattern used elsewhere) so it can never lose to its own tombstone.
 *
 * Instantiated per-consumer (there is no provider): every `useExpenses()` stays in lockstep
 * through the CustomEvent. The remote subscribe is opened once at the app root (itinerary-provider).
 */

export const EXPENSES_CHANGED_EVENT = 'expenses:changed';

export interface ExpenseStore {
  expenses: Expense[];
  hydrated: boolean;
  addExpense(input: NewExpenseInput): void;
  updateExpense(id: string, patch: Partial<NewExpenseInput>): void;
  removeExpense(id: string): void;
  /**
   * Re-insert a previously-removed expense (delete-Undo). Dormant: verbatim same `id` +
   * `createdAt` (byte-identical restore). With sync on: a fresh-id copy (strip id/rev/hlc/deleted, mint
   * a new id + created stamp) — a verbatim same-id re-add would be silently re-killed by its own
   * tombstone on an HLC tie, the same one-rule-everywhere pattern used by the itinerary.
   *
   * Returns the id the row was restored under: the same
   * id when dormant, a fresh id under sync. The Undo caller feeds it to `usePhotos().repointExpense`
   * so a receipt's key-16 meta follows a fresh-id restore instead of stranding. Purely local — the
   * return is the only surface change; the restore behavior is otherwise byte-identical.
   */
  restoreExpense(expense: Expense): string;
  /** Clear ALL expenses (settings page). Dormant: a plain local wipe. With sync on: tombstone every
   *  live row in one commit so the clear propagates + wins (mirror of removeExpense's sync path). */
  clearAll(): void;
}

/**
 * Generate a stable, collision-free expense id at the adapter boundary (the pure core stays
 * id-agnostic). Time-prefixed + a random suffix; browser-only.
 */
function generateExpenseId(): string {
  return `exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Sync gate + actor (firebase-free, dormant-safe — mirrors use-itinerary's `syncEnabled`/
// `syncActor`). Under sync there is always an active traveler, so `actor()` is their name.
function syncEnabled(): boolean {
  return isRemoteConfigured();
}
function actor(): string {
  return getActiveTraveler()?.name ?? getUserName() ?? '';
}

// The shared hydrate/listen/commit skeleton, instantiated once for the expense
// domain with its SyncPort. The factory's commit tail fires `expensesSyncPort.push(prev,
// next)` fire-and-forget AFTER the local save + dispatch; the push self-gates on
// `isRemoteConfigured()` + an active traveler behind a dynamic import, so the dormant build pulls
// no firebase onto the hot path.
const useExpensesStore = createReactiveStore<Expense[]>({
  eventName: EXPENSES_CHANGED_EVENT,
  storageKeys: [STORAGE_KEYS.expenses],
  storage: expensesStoragePort,
  sync: expensesSyncPort,
});

export function useExpenses(): ExpenseStore {
  // `expenses` here is the raw persisted value (tombstones included under sync); the exposed value
  // is filtered below. `commit` is the factory's single write choke-point.
  const { value: rawExpenses, hydrated, commit } = useExpensesStore();

  const addExpense = useCallback((input: NewExpenseInput) => {
    // Attribution (createdBy/updatedBy, first author wins) + rev=1/hlc — gated on sync.
    const stamp: ExpenseStamper | undefined = syncEnabled()
      ? (e) => {
          const name = actor();
          const attributed: Expense = name ? { ...e, createdBy: e.createdBy ?? name, updatedBy: name } : e;
          return { ...attributed, ...firstSyncStamp(clock.now().getTime(), name) };
        }
      : undefined;
    commit((current) =>
      addExpenseCore(current, input, generateExpenseId(), new Date().toISOString(), stamp),
    );
  }, [commit]);

  const updateExpense = useCallback((id: string, patch: Partial<NewExpenseInput>) => {
    const stamp: ExpenseStamper | undefined = syncEnabled()
      ? (e) => {
          const name = actor();
          const attributed: Expense = name ? { ...e, updatedBy: name } : e;
          return { ...attributed, ...nextSyncStamp(e, clock.now().getTime(), name) };
        }
      : undefined;
    commit((current) => updateExpenseCore(current, id, patch, stamp));
  }, [commit]);

  const removeExpense = useCallback((id: string) => {
    // Dormant: physically remove exactly as today. With sync on: write a tombstone via the
    // update path (deleted:true, rev+1, hlc advanced), the exposed filter hides it.
    if (!syncEnabled()) {
      commit((current) => removeExpenseCore(current, id));
      return;
    }
    commit((current) =>
      updateExpenseCore(current, id, {}, (e) => {
        const name = actor();
        const attributed: Expense = name ? { ...e, updatedBy: name } : e;
        return { ...attributed, deleted: true, ...nextSyncStamp(e, clock.now().getTime(), name) };
      }),
    );
  }, [commit]);

  const restoreExpense = useCallback((expense: Expense): string => {
    // Dormant: re-insert verbatim (same id + createdAt), de-duping so a double-Undo is a no-op —
    // byte-identical to the original (pre-sync) behavior. Returns the same id (the re-point is then a no-op).
    if (!syncEnabled()) {
      const { id, createdAt, ...input } = expense;
      commit((current) => addExpenseCore(removeExpenseCore(current, id), input, id, createdAt));
      return id;
    }
    // With sync on: a fresh-id copy. Strip id/rev/hlc/deleted + prior attribution; mint a
    // new id + created stamp so it can never collide with — or lose to — its own tombstone. Returns
    // the fresh id so the Undo caller can re-point any receipt meta.
    const { id: _id, rev: _rev, hlc: _hlc, deleted: _del, createdBy: _cb, updatedBy: _ub, createdAt, ...content } =
      expense;
    void _id; void _rev; void _hlc; void _del; void _cb; void _ub; void createdAt;
    const newId = generateExpenseId();
    commit((current) =>
      addExpenseCore(current, content, newId, new Date().toISOString(), (e) => {
        const name = actor();
        const attributed: Expense = name ? { ...e, createdBy: name, updatedBy: name } : e;
        return { ...attributed, ...firstSyncStamp(clock.now().getTime(), name) };
      }),
    );
    return newId;
  }, [commit]);

  const clearAll = useCallback(() => {
    // Dormant: a plain local wipe — byte-identical to clearing the slot. With sync on: tombstone
    // every live expense in one commit (the same tombstone removeExpense's sync path writes, folded
    // over all rows) so each delete propagates and wins over a peer's live copy — not a blind wipe the
    // next snapshot would unwind. One commit, one push (keeps writes within the Firestore free-tier quota).
    if (!syncEnabled()) {
      commit(() => []);
      return;
    }
    commit((current) =>
      current.reduce((acc, e) => {
        if (e.deleted === true) return acc;
        return updateExpenseCore(acc, e.id, {}, (x) => {
          const name = actor();
          const attributed: Expense = name ? { ...x, updatedBy: name } : x;
          return { ...attributed, deleted: true, ...nextSyncStamp(x, clock.now().getTime(), name) };
        });
      }, current),
    );
  }, [commit]);

  // The exposed-`expenses` tombstone filter. The merge/persist layer retains
  // `deleted:true` rows so a delete can propagate and win; consumers see live rows only, with zero
  // edits. Dormant rows never carry `deleted`, so this is identity in the dormant build.
  const expenses = useMemo(() => rawExpenses.filter((e) => e.deleted !== true), [rawExpenses]);

  return { expenses, hydrated, addExpense, updateExpense, removeExpense, restoreExpense, clearAll };
}

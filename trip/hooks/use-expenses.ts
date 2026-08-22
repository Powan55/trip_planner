'use client';

import { useCallback, useMemo } from 'react';
import { keyFor } from '@/core/storage/gateway';
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
 * A THIN React adapter over the framework-free expense core (`core/budget/expenses.ts`) + the
 * load/save adapter (`core/budget/storage.ts`, gateway key 11). It wires `createReactiveStore`
 * WITH the expense `SyncPort` — the shared factory owns the
 * hydrate/listen/commit skeleton ( dual-layer reactivity, fresh-base,
 * push-from-commit); this file owns the expense-specific mutators + stamping + the tombstone
 * filter.
 *
 * ── THE DORMANT-BUILD BYTE-IDENTITY GATE ─────────────────────────────────────────────
 * ALL stamping — attribution (createdBy/updatedBy) AND the Sync-v2 fields (rev/hlc/deleted), and
 * turning `removeExpense` into a tombstone — is GATED on `isRemoteConfigured()`:
 * - DORMANT: `removeExpense` physically removes exactly as today, and NO sync/attribution field
 * is written. The dormant build is byte-for-byte unchanged (the storage/core suites hold
 * verbatim); the exposed filter is a no-op (dormant rows carry no `deleted`).
 * - SYNC ON: the tombstone + rev/hlc path activates, "logged by {name}" attribution is stamped
 * from the active traveler, and the exposed `expenses` filters `deleted` so the UI still shows
 * a normal delete. Undo-under-sync is a FRESH-ID copy
 * so it can never lose to its own tombstone.
 *
 * Instantiated per-consumer (there is no provider): every `useExpenses()` stays in lockstep
 * through the CustomEvent. The remote subscribe is opened once at the app root (itinerary-provider).
 */

import { EXPENSES_CHANGED_EVENT } from '@/core/storage/events';
export { EXPENSES_CHANGED_EVENT };

export interface ExpenseStore {
  expenses: Expense[];
  hydrated: boolean;
  addExpense(input: NewExpenseInput): void;
  updateExpense(id: string, patch: Partial<NewExpenseInput>): void;
  removeExpense(id: string): void;
  /**
   * Re-insert a previously-removed expense. DORMANT: verbatim SAME `id` +
   * `createdAt` (byte-identical restore). SYNC ON: a FRESH-ID copy (strip id/rev/hlc/deleted, mint
   * a new id + created stamp) — a verbatim same-id re-add would be silently re-killed by its own
   * tombstone on an HLC tie, the same one-rule-everywhere as the itinerary.
   *
   * RETURNS the id the row was restored under: the SAME
   * id when dormant, a FRESH id under sync. The Undo caller feeds it to `usePhotos().repointExpense`
   * so a receipt's key-16 meta follows a fresh-id restore instead of stranding. Purely local — the
   * return is the only surface change; the restore behavior is otherwise byte-identical.
   */
  restoreExpense(expense: Expense): string;
  /** Clear ALL expenses. DORMANT: a plain local wipe. SYNC: tombstone every
   * live row in one commit so the clear propagates + wins (mirror of removeExpense's sync path). */
  clearAll(): void;
  /**
   * Restore the WHOLE expense store from a validated backup ( tombstone-replace,
   * mirroring the itinerary's `restorePlans`). DORMANT: a plain local overwrite (no sync to
   * unwind). SYNC ON: tombstone every currently-live row (the `clearAll` sync mechanic) THEN
   * re-add every live backup row as a FRESH-ID copy (the `addExpense` sync-stamp path) — all in
   * ONE commit, so the restore PROPAGATES + survives the next snapshot instead of being unwound,
   * and a restored row can never lose to its own tombstone on an HLC tie.
   */
  restoreExpenses(backup: Expense[]): void;
  /**
   * — reclaim the ATTRIBUTION stamps left under a name the traveler used to go by. The
   * expense-store half of the itinerary's owner-initiated `claimAuthorship`: rewrites
   * `createdBy` / `updatedBy` from `fromName` to the CURRENT display name across every LIVE row,
   * in ONE commit. Returns how many rows changed (0 = nothing written at all).
   *
   * 🔴 `paidBy` AND `split[]` ARE NEVER WRITTEN, AND MUST NEVER BE. They are money, not
   * attribution. `core/budget/settlement.ts` de-duplicates the split members before dividing
   * (`uniq(e.split…)` then `amount / members.length`), so renaming a member INTO a split that
   * already contains the new name silently DROPS THE DIVISOR and re-points every balance and
   * every transfer. The owner ruled "extend the claim to expenses", then narrowed it himself to
   * attribution-only after seeing that arithmetic — the narrowing is the ruling.
   * Note the field comment in `core/budget/expenses.ts` calls `paidBy`/`split` "TRAVELERS id":
   * they are display-name STRINGS (`e2e/expenses.spec.ts` pins ['Powan','Sushil','Uttam']
   * literally), so a rename genuinely COULD reach them. That is exactly why it must not.
   *
   * Under sync we advance `rev`/`hlc` via the SAME `nextSyncStamp` fragment every other mutator
   * here uses. Without that bump a peer's un-rewritten copy ties or wins the LWW resolve in
   * `mergeItems` and the very next remote snapshot quietly unwinds the claim — the rewrite would
   * pass every test and revert on a real device. `createdAt` is never re-stamped. Tombstones are
   * skipped: invisible to the UI, and to the count the user approved before pressing the button.
   */
  claimAuthorship(fromName: string): number;
}

/**
 * Generate a stable, collision-free expense id at the ADAPTER boundary (the pure core stays
 * id-agnostic —). Time-prefixed + a random suffix; browser-only.
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
// domain WITH its SyncPort. The factory's commit tail fires `expensesSyncPort.push(prev,
// next)` fire-and-forget AFTER the local save + dispatch; the push self-gates on
// `isRemoteConfigured()` + an active traveler behind a dynamic import, so the dormant build pulls
// no firebase onto the hot path.
const useExpensesStore = createReactiveStore<Expense[]>({
  eventName: EXPENSES_CHANGED_EVENT,
  storageKeys: () => [keyFor('expenses')],
  storage: expensesStoragePort,
  sync: expensesSyncPort,
});

export function useExpenses(): ExpenseStore {
  // `expenses` here is the RAW persisted value (tombstones INCLUDED under sync); the exposed value
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
    // DORMANT: physically remove exactly as today. SYNC ON: write a TOMBSTONE via the
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
    // DORMANT: re-insert verbatim (same id + createdAt), de-duping so a double-Undo is a no-op —
    // byte-identical to the behavior. Returns the SAME id (the re-point is then a no-op).
    if (!syncEnabled()) {
      const { id, createdAt, ...input } = expense;
      commit((current) => addExpenseCore(removeExpenseCore(current, id), input, id, createdAt));
      return id;
    }
    // SYNC ON: a FRESH-ID copy. Strip id/rev/hlc/deleted + prior attribution; mint a
    // new id + created stamp so it can never collide with — or lose to — its own tombstone. Returns
    // the FRESH id so the Undo caller can re-point any receipt meta.
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
    // DORMANT: a plain local wipe — byte-identical to clearing the slot. SYNC ON: tombstone
    // EVERY live expense in ONE commit (the SAME tombstone removeExpense's sync path writes, folded
    // over all rows) so each delete PROPAGATES + wins over a peer's live copy — not a blind wipe the
    // next snapshot would unwind. One commit ⇒ one push.
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

  const restoreExpenses = useCallback((backup: Expense[]) => {
    // DORMANT: a plain local overwrite — there is no sync to unwind, byte-identical to
    // a savePlans-style replace. SYNC ON: tombstone-replace in ONE commit (mirrors restorePlans).
    if (!syncEnabled()) {
      commit(() => backup);
      return;
    }
    const name = actor();
    commit((current) => {
      // (a) Tombstone every currently-live row (the SAME stamp clearAll applies).
      let next = current.reduce((acc, e) => {
        if (e.deleted === true) return acc;
        return updateExpenseCore(acc, e.id, {}, (x) => {
          const attributed: Expense = name ? { ...x, updatedBy: name } : x;
          return { ...attributed, deleted: true, ...nextSyncStamp(x, clock.now().getTime(), name) };
        });
      }, current);
      // (b) Add a fresh-id copy of every LIVE backup row (strip id/rev/hlc/deleted/attribution,
      // mint a new id + created stamp) — can never lose to an existing tombstone on an HLC tie.
      for (const e of backup) {
        if (e.deleted === true) continue;
        const { id: _id, rev: _rev, hlc: _hlc, deleted: _del, createdBy: _cb, updatedBy: _ub, createdAt: _ca, ...content } =
          e;
        void _id; void _rev; void _hlc; void _del; void _cb; void _ub; void _ca;
        next = addExpenseCore(next, content, generateExpenseId(), new Date().toISOString(), (x) => {
          const attributed: Expense = name ? { ...x, createdBy: name, updatedBy: name } : x;
          return { ...attributed, ...firstSyncStamp(clock.now().getTime(), name) };
        });
      }
      return next;
    });
  }, [commit]);

  // — see the `claimAuthorship` doc on ExpenseStore for WHY paidBy/split are absent here.
  const claimAuthorship = useCallback((fromName: string): number => {
    const from = fromName.trim();
    const to = getUserName();
    // Loud no-ops are the CALLER's job (it must say why); these are the defensive floors.
    if (!from || !to || from === to) return 0;
    // A zero-match claim must not reach commit(): commit saves + pushes unconditionally, so a name
    // nobody carries would cost a localStorage write and a Spark write to store an
    // identical array. `rawExpenses` is current on a button press and is what the preview counted.
    if (!rawExpenses.some((e) => e.deleted !== true && (e.createdBy === from || e.updatedBy === from))) {
      return 0;
    }
    const sync = syncEnabled();
    const name = actor();
    const now = clock.now().getTime();
    let claimed = 0;
    commit((current) => {
      claimed = 0;
      return current.map((e) => {
        if (e.deleted === true) return e;
        if (e.createdBy !== from && e.updatedBy !== from) return e;
        claimed++;
        // Per FIELD, and ONLY these two fields. The spread carries `paidBy`/`split` (and
        // `createdAt`) through untouched — they are never read, compared, or written here.
        const renamed: Expense = {
          ...e,
          ...(e.createdBy === from ? { createdBy: to } : {}),
          ...(e.updatedBy === from ? { updatedBy: to } : {}),
        };
        return sync ? { ...renamed, ...nextSyncStamp(e, now, name) } : renamed;
      });
    });
    return claimed;
  }, [commit, rawExpenses]);

  // The exposed-`expenses` tombstone filter. The MERGE/persist layer RETAINS
  // `deleted:true` rows so a delete can propagate + win; consumers see live rows only, with ZERO
  // edits. Dormant rows never carry `deleted`, so this is identity in the dormant build.
  const expenses = useMemo(() => rawExpenses.filter((e) => e.deleted !== true), [rawExpenses]);

  return {
    expenses,
    hydrated,
    addExpense,
    updateExpense,
    removeExpense,
    restoreExpense,
    clearAll,
    restoreExpenses,
    claimAuthorship,
  };
}

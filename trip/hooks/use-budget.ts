'use client';

import { useCallback } from 'react';
import { keyFor } from '@/core/storage/gateway';
import { budgetStoragePort } from '@/core/budget/storage';
import { budgetSyncPort } from '@/lib/budget-ports';
import { createReactiveStore } from '@/hooks/create-reactive-store';
import { isRemoteConfigured } from '@/lib/firebase-config';
import { getActiveTraveler } from '@/lib/token-auth';
import { getUserName } from '@/lib/identity';
import { clock } from '@/lib/trip-now';
import { stampBudgetChanges } from '@/core/budget/flatten';
import { SEED_RATES, type BudgetModel } from '@/core/budget/model';

/**
 * Reactive budget store.
 *
 * Budget had NO hook before — `components/budget-panel.tsx` read/wrote the `BudgetModel` ad hoc.
 * This hook wires `createReactiveStore` to the budget `StoragePort` (gateway key 10) and the
 * frozen same-tab event `'budget:changed'`, so budget gets the SAME hydrate/listen/commit skeleton
 * every domain has.
 *
 * ── SYNC ───────────────────────────────────────────────
 * The factory now carries the budget `SyncPort` (`budgetSyncPort`): the commit tail fires
 * `push(prev, next)` fire-and-forget AFTER the local save + dispatch; the push self-gates on
 * `isRemoteConfigured()` + an active traveler behind a dynamic import, so the dormant build pulls no
 * firebase onto the hot path.
 *
 * ── THE DORMANT-BUILD BYTE-IDENTITY GATE ─────────────────────────────────────────────
 * The exposed `commit` wraps the factory's commit to STAMP the changed leaf paths with a per-field
 * HLC — but ONLY when `isRemoteConfigured()`. DORMANT: the wrapper is a passthrough, no
 * `sync.fieldHlc` is ever written, so the key-10 bytes are byte-for-byte (the panel's UX,
 * mutators, and money math are all unchanged — they still call `commit(() => next)`).
 */

export const BUDGET_CHANGED_EVENT = 'budget:changed';

export interface BudgetStore {
  model: BudgetModel;
  hydrated: boolean;
  /**
   * Commit a change against the FRESHEST persisted model: persists via the StoragePort,
   * updates React state, fires `'budget:changed'`, and (under sync) stamps the changed leaf paths
   * with a fresh HLC + fans the merged singleton out to Firestore. `compute` receives the
   * current persisted model; return the next one.
   */
  commit(compute: (current: BudgetModel) => BudgetModel): void;
  /**
   * Reset the whole budget to the seeded default. DORMANT: a plain local seed write
   * (commit passthrough, byte-identical). SYNC ON: commit stamps the CHANGED leaf paths with a fresh
   * HLC (`stampBudgetChanges`), so the reset-to-seed WINS the next per-field LWW merge — a set field
   * cleared back to its seed PROPAGATES + sticks, not a blind wipe the next snapshot would overwrite.
   */
  reset(): void;
}

// Sync gate + actor (firebase-free, dormant-safe — mirrors use-expenses' `syncEnabled`/`actor`).
function syncEnabled(): boolean {
  return isRemoteConfigured();
}
function actor(): string {
  return getActiveTraveler()?.name ?? getUserName() ?? '';
}

// The shared hydrate/listen/commit skeleton, instantiated once for the budget domain WITH
// its SyncPort. Push self-gates + lazy-imports firebase, so dormant pulls none.
const useBudgetStore = createReactiveStore<BudgetModel>({
  eventName: BUDGET_CHANGED_EVENT,
  storageKeys: () => [keyFor('budget')],
  storage: budgetStoragePort,
  sync: budgetSyncPort,
});

export function useBudget(): BudgetStore {
  const { value: model, hydrated, commit: rawCommit } = useBudgetStore();

  // Stamp the changed leaf paths under sync; passthrough when dormant. Stamping
  // happens INSIDE the factory's compute so the stamped model is what gets saved AND pushed.
  const commit = useCallback((compute: (current: BudgetModel) => BudgetModel) => {
    rawCommit((current) => {
      const next = compute(current);
      if (!syncEnabled()) return next; // dormant: no sync.fieldHlc, byte-identical to
      return stampBudgetChanges(current, next, clock.now().getTime(), actor());
    });
  }, [rawCommit]);

  // Reset to seed via the SAME stamped commit path — one fresh model, freshly stamped
  // under sync so it wins the next merge; a byte-identical local seed write when dormant.
  const reset = useCallback(() => {
    commit(() => ({
      version: 1,
      homeCurrency: 'USD',
      rates: { ...SEED_RATES },
      legBudgets: { nepal: 0, japan: 0 },
      categoryBudgets: {},
    }));
  }, [commit]);

  return { model, hydrated, commit, reset };
}

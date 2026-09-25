'use client';

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { keyFor } from '@/core/storage/gateway';
import { budgetStoragePort } from '@/core/budget/storage';
import { budgetSyncPort } from '@/lib/budget-ports';
import { createReactiveStore } from '@/hooks/create-reactive-store';
import { isTripRemoteConfigured } from '@/lib/firebase-config';
import { getActiveTraveler } from '@/lib/token-auth';
import { getUserName } from '@/lib/identity';
import { realClock } from '@/lib/trip-now';
import { stampBudgetChanges } from '@/core/budget/flatten';
import { CURRENCIES, SEED_RATES, type BudgetModel, type CurrencyCode } from '@/core/budget/model';
import { accountCode, getCachedPrefs, hasAccount } from '@/lib/account-prefs';

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
 * HLC — but ONLY when `isTripRemoteConfigured()` (the TRIP-scoped gate: the default sample pack
 * has no remote id, so it never stamps). DORMANT: the wrapper is a passthrough, no
 * `sync.fieldHlc` is ever written, so the key-10 bytes are byte-for-byte (the panel's UX,
 * mutators, and money math are all unchanged — they still call `commit(() => next)`).
 */

import { BUDGET_CHANGED_EVENT } from '@/core/storage/events';
export { BUDGET_CHANGED_EVENT };

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
   * Pick the display currency. With an account it is a per-person pref (D-599) and the shared
   * budget is not written; without one it stays in the budget model on this device, as before.
   */
  setHomeCurrency(home: CurrencyCode): void;
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
  return isTripRemoteConfigured();
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

// The person's own display currency (account prefs, D-599). One prefs stream for every mounted
// reader; the mirror is re-read on each notify, so a local setPref shows before the network answers.
const homeListeners = new Set<() => void>();
let stopPrefs: (() => void) | null = null;
let seeding = false;
// Per account: seed attempts made this page load, or 'done' once a claim returned a value.
const seedState = new Map<string, number | 'done'>();
const MAX_SEED_TRIES = 3;

function notifyHome(): void {
  homeListeners.forEach((l) => l());
}

function subscribeHome(cb: () => void): () => void {
  homeListeners.add(cb);
  if (!stopPrefs && hasAccount()) {
    let cancelled = false;
    let unsub: (() => void) | null = null;
    stopPrefs = () => {
      cancelled = true;
      unsub?.();
    };
    void import('@/lib/account-prefs-remote').then((m) => {
      if (!cancelled) unsub = m.subscribePrefs(notifyHome);
    });
  }
  return () => {
    homeListeners.delete(cb);
    if (homeListeners.size === 0) {
      stopPrefs?.();
      stopPrefs = null;
    }
  };
}

function personalHome(): CurrencyCode | null {
  const v = getCachedPrefs().homeCurrency;
  return CURRENCIES.includes(v as CurrencyCode) ? (v as CurrencyCode) : null;
}

export function useBudget(): BudgetStore {
  const { value: shared, hydrated, commit: rawCommit } = useBudgetStore();
  const personal = useSyncExternalStore(subscribeHome, personalHome, () => null);
  const model = useMemo(
    () => (personal && personal !== shared.homeCurrency ? { ...shared, homeCurrency: personal } : shared),
    [shared, personal],
  );

  // Seed the personal value once from the shared budget. claimField, not setPref: this is not a
  // user edit, so it must never overwrite a choice another device already made. A claim that
  // got an answer is final; a failed one (null) may be retried on up to 3 mounts per page load.
  // Only a value that came through sync is seeded: before the budget snapshot lands, a fresh
  // device holds the local default, and claiming that would make it permanent.
  const homeSynced = !!shared.sync?.fieldHlc?.homeCurrency;
  useEffect(() => {
    const code = accountCode();
    if (!hydrated || !homeSynced || personal || seeding || !code) return;
    const tries = seedState.get(code) ?? 0;
    if (tries === 'done' || tries >= MAX_SEED_TRIES) return;
    seeding = true;
    seedState.set(code, tries + 1);
    void import('@/lib/account-prefs-remote')
      .then((m) => m.claimField('homeCurrency', shared.homeCurrency))
      .catch(() => null)
      .then((won) => {
        if (won !== null) seedState.set(code, 'done');
        seeding = false;
        notifyHome();
      });
  }, [hydrated, homeSynced, personal, shared.homeCurrency]);

  // Stamp the changed leaf paths under sync; passthrough when dormant. Stamping
  // happens INSIDE the factory's compute so the stamped model is what gets saved AND pushed.
  // With an account, budget.homeCurrency is pinned to its stored value: new clients never write it
  // (older clients still read it), even when a caller spreads the personal-overlaid `model`.
  const commitShared = useCallback((compute: (current: BudgetModel) => BudgetModel, pinHome: boolean) => {
    rawCommit((current) => {
      let next = compute(current);
      if (pinHome && next.homeCurrency !== current.homeCurrency) next = { ...next, homeCurrency: current.homeCurrency };
      if (!syncEnabled()) return next; // dormant: no sync.fieldHlc, byte-identical to
      return stampBudgetChanges(current, next, realClock.now().getTime(), actor());
    });
  }, [rawCommit]);

  const commit = useCallback(
    (compute: (current: BudgetModel) => BudgetModel) => commitShared(compute, hasAccount()),
    [commitShared],
  );

  const setHomeCurrency = useCallback((home: CurrencyCode) => {
    if (!hasAccount()) {
      commitShared((cur) => ({ ...cur, homeCurrency: home }), false);
      return;
    }
    void import('@/lib/account-prefs-remote')
      .then((m) => {
        const done = m.setPref('homeCurrency', home); // mirrors locally before its first await
        notifyHome();
        return done;
      })
      .then(notifyHome, (err) => console.warn('[budget] home currency not saved:', err));
  }, [commitShared]);

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

  return { model, hydrated, commit, setHomeCurrency, reset };
}

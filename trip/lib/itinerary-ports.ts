// Itinerary port adapters — the framework-layer I/O that satisfies the core's
// StoragePort<DayPlan[]> / SyncPort<DayPlan[]> contracts (core/ports.ts). This is the thin
// seam between the pure `core/itinerary` CRUD and the real world; `hooks/use-itinerary.ts`
// wires the store to these.
//
// StoragePort impl  = the Vault-backed itinerary gateway: loadPlans / savePlans /
//                     hasStoredPlans, called UNCHANGED. The key-presence three-state,
//                     `[]`-survives, and quarantine behaviors live inside those functions.
// SyncPort impl     = pushPlans(prev, next), reached via a DYNAMIC import gated on
//                     isRemoteConfigured() — firebase stays off the dormant
//                     hot path. Best-effort + never-throws.

import type { DayPlan } from './trip-data';
import type { StoragePort, SyncPort } from '@/core/ports';
import { loadPlans, savePlans, hasStoredPlans } from './itinerary-storage';
import { isRemoteConfigured } from './firebase-config';

/**
 * Production StoragePort for the itinerary — the Vault gateway.
 * `load()` returns the FRESHEST persisted state (the read base); `save()` always
 * writes, incl. `[]`; `has()` is raw key-presence. No behavior added here.
 */
export const itineraryStoragePort: StoragePort<DayPlan[]> = {
  load: loadPlans,
  save: savePlans,
  has: hasStoredPlans,
};

/**
 * Production SyncPort for the itinerary — the per-day Firestore push + subscribe.
 *
 * firebase/itinerary-remote is NOT imported at module scope;
 * every remote op is behind an `isRemoteConfigured()` gate and a DYNAMIC
 * `import('./itinerary-remote')`, so the dormant build never pulls firebase onto the hot
 * path. Best-effort + self-degrading: a dormant gate is a silent no-op, and any import/push
 * failure is swallowed to a warn so a remote failure never breaks the local edit.
 *
 *  - `push`      — the merge-aware per-day transactional write. Mirrors the hook's
 *                  former inline `if (isRemoteConfigured()) import(...).then(pushPlans)`
 *                  byte-for-byte; the merge-awareness is entirely inside `pushPlans`.
 *  - `subscribe` — the remote→local snapshot listener. The dynamic import is async, so we
 *                  return a proxy unsubscribe immediately and swap in the real one once the
 *                  module resolves; a teardown before then cancels the pending subscribe. A
 *                  dormant gate returns a no-op unsub with NO firebase import.
 *  - `isConfigured` — the pure, firebase-free gate, synchronous.
 */
export const itinerarySyncPort: SyncPort<DayPlan[]> = {
  async push(prev, next) {
    if (!isRemoteConfigured()) return;
    try {
      const { pushPlans } = await import('./itinerary-remote');
      await pushPlans(prev, next);
    } catch (err) {
      // Degrade to local-only; never let a remote-push path break a local edit.
      console.warn('[use-itinerary] remote push unavailable:', err);
    }
  },

  subscribe(onApplied) {
    // Dormant gate: no config ⇒ no firebase import, a no-op unsubscribe.
    if (!isRemoteConfigured()) return () => {};

    let realUnsub: (() => void) | null = null;
    let cancelled = false;

    import('./itinerary-remote')
      .then(({ subscribeRemote }) => {
        if (cancelled) return; // torn down before the import resolved
        realUnsub = subscribeRemote(onApplied);
      })
      .catch((err) => {
        // Degrade to local-only; never crash.
        console.warn('[use-itinerary] remote subscribe unavailable:', err);
      });

    return () => {
      cancelled = true;
      if (realUnsub) {
        realUnsub();
        realUnsub = null;
      }
    };
  },

  isConfigured() {
    return isRemoteConfigured();
  },
};

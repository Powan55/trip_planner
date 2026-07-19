// Itinerary port adapters — the framework-layer I/O that satisfies the core's
// StoragePort<DayPlan[]> / SyncPort<DayPlan[]> contracts (core/ports.ts). This is the thin
// seam between the pure `core/itinerary` CRUD and the real world; `hooks/use-itinerary.ts`
// wires the store to these.
//
// StoragePort impl = the Vault-backed itinerary gateway: loadPlans / savePlans /
// hasStoredPlans, called UNCHANGED. (key-presence three-
// state, `[]`-survives, quarantine) live inside those functions.
// SyncPort impl = pushPlans(prev, next), reached via a DYNAMIC import gated on
// isRemoteConfigured() — firebase stays off the dormant
// hot path. Best-effort + never-throws.

import type { DayPlan } from './trip-data';
import type { StoragePort, SyncPort } from '@/core/ports';
import { loadPlans, savePlans, hasStoredPlans } from './itinerary-storage';
import { isRemoteConfigured } from './firebase-config';
import { withOutbox, type ChunkSync } from '@/core/sync/outbox';

/**
 * Production StoragePort for the itinerary — the Vault gateway.
 * `load()` returns the FRESHEST persisted state; `save()` always
 * writes, incl. `[]`; `has()` is raw key-presence. No behavior added here.
 */
export const itineraryStoragePort: StoragePort<DayPlan[]> = {
  load: loadPlans,
  save: savePlans,
  has: hasStoredPlans,
};

/**
 * Production SyncPort for the itinerary — the per-day Firestore push + subscribe
 *, finalized at.
 *
 * Preserves EXACTLY: firebase/itinerary-remote is NOT imported at module scope;
 * every remote op is behind an `isRemoteConfigured()` gate and a DYNAMIC
 * `import('./itinerary-remote')`, so the dormant build never pulls firebase onto the hot
 * path. Best-effort + self-degrading: a dormant gate is a silent no-op, and any import/push
 * failure is swallowed to a warn so a remote failure never breaks the local edit.
 *
 * - `push` — the merge-aware per-day transactional write. Mirrors the hook's
 * former inline `if (isRemoteConfigured()) import(...).then(pushPlans)`
 * byte-for-byte; the merge-awareness is entirely inside `pushPlans`.
 * - `subscribe` — the remote→local snapshot listener. The dynamic import is async, so we
 * return a proxy unsubscribe immediately and swap in the real one once the
 * module resolves; a teardown before then cancels the pending subscribe. A
 * dormant gate returns a no-op unsub with NO firebase import.
 * - `isConfigured` — the pure, firebase-free gate, synchronous.
 */
/**
 * Itinerary `ChunkSync` for the offline outbox. Chunk = a day (keyed by `date`).
 * - `chunkDiff` = the dates whose day-contents changed prev→next (the same per-day JSON compare
 * `pushPlans` uses as `dayEquals`, inlined here so this module keeps NOT statically importing
 * `itinerary-remote` — firebase stays off the dormant hot path,).
 * - `pushChunk` = the merge-aware per-day transactional write of ONE present day, reached via the
 * SAME dynamic, gated import as before; it REJECTS on failure so the decorator keeps the chunk
 * dirty (the decorator is the swallower now, not this port).
 */
const itineraryChunkSync: ChunkSync<DayPlan[]> = {
  domain: 'itinerary',
  chunkDiff(prev, next) {
    const prevByDate = new Map(prev.map((d) => [d.date, d]));
    const nextByDate = new Map(next.map((d) => [d.date, d]));
    const dates = new Set<string>([...prevByDate.keys(), ...nextByDate.keys()]);
    const changed: string[] = [];
    for (const date of dates) {
      if (JSON.stringify(prevByDate.get(date)) !== JSON.stringify(nextByDate.get(date))) {
        changed.push(date);
      }
    }
    return changed;
  },
  async pushChunk(date, current) {
    const { pushDayChunk } = await import('./itinerary-remote');
    await pushDayChunk(current, date); // rejects on failure → outbox keeps the chunk dirty
  },
};

// Exported so the provider can flush this domain's outbox on app-start / online / visible
//.
export const itineraryOutboxSync = itineraryChunkSync;

export const itinerarySyncPort: SyncPort<DayPlan[]> = {
  // Offline-outbox-decorated push: write-ahead enqueue → per-day merge-aware push →
  // ack-on-resolve; a rejecting day stays dirty and retries on the next flush (survives reload).
  // Self-gates on configured AND identified traveler (dormant/guest never write the slot), so the
  // dormant build still pulls NO firebase onto the hot path (the pushChunk import is gated behind
  // that). Never throws to the commit caller.
  push: withOutbox(itineraryChunkSync, itineraryStoragePort),

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

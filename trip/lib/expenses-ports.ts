// Expense port adapters — the framework-layer I/O satisfying the
// core's SyncPort<Expense[]> contract, mirroring `lib/itinerary-ports.ts`. The StoragePort
// (`expensesStoragePort`) already lives in `core/budget/storage.ts`; this file adds the SYNC
// side: the offline-outbox-decorated push (chunked by leg) + the gated subscribe.
//
// Preserves the dormant-safe contract EXACTLY: firebase/expenses-remote is NOT imported at module scope;
// every remote op is behind an `isRemoteConfigured()` gate and a DYNAMIC import, so the dormant
// build never pulls firebase onto the hot path. Best-effort + self-degrading.

import type { StoragePort, SyncPort } from '@/core/ports';
import type { Expense } from '@/core/budget/expenses';
import { expensesStoragePort } from '@/core/budget/storage';
import { isRemoteConfigured } from './firebase-config';
import { withOutbox, type ChunkSync } from '@/core/sync/outbox';

/** Rows for one leg, in stable insertion order (for the prev/next chunk-diff compare). */
function legRows(list: Expense[], leg: 'nepal' | 'japan'): Expense[] {
  return list.filter((e) => e.leg === leg);
}

/**
 * Expense `ChunkSync` for the offline outbox. Chunk = a leg (`'nepal'` | `'japan'`).
 *  - `chunkDiff` = the legs whose row-set changed prev→next (per-leg JSON compare, inlined so
 *    this module keeps NOT statically importing `expenses-remote` — firebase stays off the
 *    dormant hot path).
 *  - `pushChunk` = the merge-aware per-leg transactional write, reached via the SAME dynamic,
 *    gated import; it REJECTS on failure so the decorator keeps the chunk dirty.
 */
const expensesChunkSync: ChunkSync<Expense[]> = {
  domain: 'expenses',
  chunkDiff(prev, next) {
    const changed: string[] = [];
    for (const leg of ['nepal', 'japan'] as const) {
      if (JSON.stringify(legRows(prev, leg)) !== JSON.stringify(legRows(next, leg))) {
        changed.push(leg);
      }
    }
    return changed;
  },
  async pushChunk(leg, current) {
    const { pushExpenseChunk } = await import('./expenses-remote');
    await pushExpenseChunk(current, leg); // rejects on failure → outbox keeps the chunk dirty
  },
};

// Exported so the provider can flush this domain's outbox on app-start / online / visible
// (flush-then-subscribe).
export const expensesOutboxSync = expensesChunkSync;

export const expensesSyncPort: SyncPort<Expense[]> = {
  // Offline-outbox-decorated push: write-ahead enqueue → per-leg merge-aware push →
  // ack-on-resolve; a rejecting leg stays dirty and retries on the next flush. Self-gates on
  // configured AND identified traveler (dormant/guest never write the slot), so the dormant build
  // still pulls NO firebase onto the hot path. Never throws to the commit caller.
  push: withOutbox(expensesChunkSync, expensesStoragePort),

  subscribe(onApplied) {
    // Dormant gate: no config ⇒ no firebase import, a no-op unsubscribe.
    if (!isRemoteConfigured()) return () => {};

    let realUnsub: (() => void) | null = null;
    let cancelled = false;

    import('./expenses-remote')
      .then(({ subscribeRemoteExpenses }) => {
        if (cancelled) return; // torn down before the import resolved
        realUnsub = subscribeRemoteExpenses(onApplied);
      })
      .catch((err) => {
        console.warn('[expenses] remote subscribe unavailable:', err);
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

// Re-export the StoragePort so a caller can wire flush(port) without reaching into core/budget.
export { expensesStoragePort };
export type { StoragePort };

// Budget port adapters — the framework-layer I/O satisfying the core's
// SyncPort<BudgetModel> contract, mirroring `lib/expenses-ports.ts`. The StoragePort
// (`budgetStoragePort`) already lives in `core/budget/storage.ts`; this file adds the SYNC side: the
// offline-outbox-decorated push (the singleton 'model' chunk) + the gated subscribe.
//
// Preserves the dormant-safe contract EXACTLY: firebase/budget-remote is NOT imported at module scope; every
// remote op is behind an `isRemoteConfigured()` gate and a DYNAMIC import, so the dormant build never
// pulls firebase onto the hot path. Best-effort + self-degrading.

import type { StoragePort, SyncPort } from '@/core/ports';
import type { BudgetModel } from '@/core/budget/model';
import { budgetStoragePort } from '@/core/budget/storage';
import { flattenBudget } from '@/core/budget/flatten';
import { isRemoteConfigured } from './firebase-config';
import { withOutbox, type ChunkSync } from '@/core/sync/outbox';

/**
 * Budget `ChunkSync` for the offline outbox. The budget is a SINGLETON, so its only chunk is
 * `'model'`.
 *  - `chunkDiff` = `['model']` when ANY leaf field changed prev→next (a `flattenBudget` JSON compare,
 *    ignoring the additive `sync.fieldHlc` — a value change is what dirties the doc). Inlined so this
 *    module keeps NOT statically importing `budget-remote` — firebase stays off the dormant hot path.
 *  - `pushChunk` = the merge-aware singleton transactional write, reached via the SAME dynamic, gated
 *    import; it REJECTS on failure so the decorator keeps the chunk dirty.
 */
const budgetChunkSync: ChunkSync<BudgetModel> = {
  domain: 'budget',
  chunkDiff(prev, next) {
    return JSON.stringify(flattenBudget(prev)) !== JSON.stringify(flattenBudget(next)) ? ['model'] : [];
  },
  async pushChunk(chunk, current) {
    const { pushBudgetChunk } = await import('./budget-remote');
    await pushBudgetChunk(current, chunk); // rejects on failure → outbox keeps the chunk dirty
  },
};

// Exported so the provider can flush this domain's outbox on app-start / online / visible
// (flush-then-subscribe).
export const budgetOutboxSync = budgetChunkSync;

export const budgetSyncPort: SyncPort<BudgetModel> = {
  // Offline-outbox-decorated push: write-ahead enqueue → merge-aware singleton push →
  // ack-on-resolve; a rejecting push stays dirty and retries on the next flush. Self-gates on
  // configured AND identified traveler (dormant/guest never write the slot), so the dormant build
  // still pulls NO firebase onto the hot path. Never throws to the commit caller.
  push: withOutbox(budgetChunkSync, budgetStoragePort),

  subscribe(onApplied) {
    // Dormant gate: no config ⇒ no firebase import, a no-op unsubscribe.
    if (!isRemoteConfigured()) return () => {};

    let realUnsub: (() => void) | null = null;
    let cancelled = false;

    import('./budget-remote')
      .then(({ subscribeRemoteBudget }) => {
        if (cancelled) return; // torn down before the import resolved
        realUnsub = subscribeRemoteBudget(onApplied);
      })
      .catch((err) => {
        console.warn('[budget] remote subscribe unavailable:', err);
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
export { budgetStoragePort };
export type { StoragePort };

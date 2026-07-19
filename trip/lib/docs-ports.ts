// Docs-checklist port adapters — the framework-layer I/O satisfying the
// core's SyncPort<DocItem[]> contract, mirroring `lib/budget-ports.ts` (singleton chunk) with the
// row-merge push of `lib/expenses-ports.ts`. The StoragePort (`docsStoragePort`) lives in
// `core/docs/storage.ts`; this file adds the SYNC side: the offline-outbox-decorated push (the
// singleton `'checklist'` chunk) + the gated subscribe.
//
// Preserves EXACTLY: firebase/docs-remote is NOT imported at module scope; every remote
// op is behind an `isRemoteConfigured()` gate and a DYNAMIC import, so the dormant build never pulls
// firebase onto the hot path. Best-effort + self-degrading.
//
// ── DOMAIN LITERAL ────────────────────────────────────────────────────────────────────────────
// 'docs' is a first-class member of `SyncDomain` (additive union extension at merge — lifted
// the core/sync fence for the one-line member, the same way expenses/budget joined it).
import type { SyncDomain } from '@/core/sync/outbox';
export const DOCS_DOMAIN: SyncDomain = 'docs';

import type { StoragePort, SyncPort } from '@/core/ports';
import type { DocItem } from '@/core/docs/model';
import { docsStoragePort } from '@/core/docs/storage';
import { isRemoteConfigured } from './firebase-config';
import { withOutbox, type ChunkSync } from '@/core/sync/outbox';

/**
 * Docs `ChunkSync` for the offline outbox. The checklist is a SINGLETON doc, so its only
 * chunk is `'checklist'`.
 * - `chunkDiff` = `['checklist']` when the row-set changed prev→next (a whole-list JSON compare).
 * Inlined so this module keeps NOT statically importing `docs-remote` — firebase stays off the
 * dormant hot path.
 * - `pushChunk` = the merge-aware singleton transactional write, reached via the SAME dynamic,
 * gated import; it REJECTS on failure so the decorator keeps the chunk dirty.
 */
const docsChunkSync: ChunkSync<DocItem[]> = {
  domain: DOCS_DOMAIN,
  chunkDiff(prev, next) {
    return JSON.stringify(prev) !== JSON.stringify(next) ? ['checklist'] : [];
  },
  async pushChunk(chunk, current) {
    const { pushDocsChunk } = await import('./docs-remote');
    await pushDocsChunk(current, chunk); // rejects on failure → outbox keeps the chunk dirty
  },
};

// Exported so the provider can flush this domain's outbox on app-start / online / visible
//.
export const docsOutboxSync = docsChunkSync;

export const docsSyncPort: SyncPort<DocItem[]> = {
  // Offline-outbox-decorated push: write-ahead enqueue → merge-aware singleton push →
  // ack-on-resolve; a rejecting push stays dirty and retries on the next flush. Self-gates on
  // configured AND identified traveler (dormant/guest never write the slot). Never throws.
  push: withOutbox(docsChunkSync, docsStoragePort),

  subscribe(onApplied) {
    // Dormant gate: no config ⇒ no firebase import, a no-op unsubscribe.
    if (!isRemoteConfigured()) return () => {};

    let realUnsub: (() => void) | null = null;
    let cancelled = false;

    import('./docs-remote')
      .then(({ subscribeRemoteDocs }) => {
        if (cancelled) return; // torn down before the import resolved
        realUnsub = subscribeRemoteDocs(onApplied);
      })
      .catch((err) => {
        console.warn('[docs] remote subscribe unavailable:', err);
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

// Re-export the StoragePort so the provider can wire flush(port) without reaching into core/docs.
export { docsStoragePort };
export type { StoragePort };

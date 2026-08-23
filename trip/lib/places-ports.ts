// My-Places port adapters (issue #17, D-229 addendum) — the framework-layer I/O satisfying the
// core's `SyncPort<MyPlace[]>` contract, mirroring `lib/docs-ports.ts` (singleton chunk + row
// merge). The StoragePort (`myPlacesStoragePort`) lives in `core/places/storage.ts`; this file adds
// the SYNC side: the offline-outbox-decorated push (the singleton `'list'` chunk) + the gated
// subscribe.
//
// Preserves EXACTLY: firebase/places-remote is NOT imported at module scope; every remote op is
// behind a gate and a DYNAMIC import, so the dormant build never pulls firebase onto the hot path.
// Best-effort + self-degrading.
//
// THE GATE IS `isTripRemoteConfigured()`, NOT `isRemoteConfigured()`. Places is a per-TRIP domain
// (a `MyPlace.legId` names a leg of the active trip) and every write composes
// `trips/{getTripId()}/…`. The default sample pack's remote id is retired, so `getTripId()` is ''
// there and this gate is false: saved places on the sample trip stay on the device, silently and
// without an invalid-path write. Custom trips sync.
import type { SyncDomain } from '@/core/sync/outbox';
export const PLACES_DOMAIN: SyncDomain = 'places';

import type { StoragePort, SyncPort } from '@/core/ports';
import type { MyPlace } from '@/core/places/model';
import { myPlacesStoragePort } from '@/core/places/storage';
import { isTripRemoteConfigured } from './firebase-config';
import { withOutbox, type ChunkSync } from '@/core/sync/outbox';

/**
 * Places `ChunkSync` for the offline outbox. The list is a SINGLETON doc, so its only chunk is
 * `'list'`.
 * - `chunkDiff` = `['list']` when the row-set changed prev→next (a whole-list JSON compare).
 *   Inlined so this module keeps NOT statically importing `places-remote` — firebase stays off the
 *   dormant hot path.
 * - `pushChunk` = the merge-aware singleton transactional write, reached via the SAME dynamic,
 *   gated import; it REJECTS on failure so the decorator keeps the chunk dirty.
 */
const placesChunkSync: ChunkSync<MyPlace[]> = {
  domain: PLACES_DOMAIN,
  chunkDiff(prev, next) {
    return JSON.stringify(prev) !== JSON.stringify(next) ? ['list'] : [];
  },
  async pushChunk(chunk, current) {
    const { pushPlacesChunk } = await import('./places-remote');
    await pushPlacesChunk(current, chunk); // rejects on failure → outbox keeps the chunk dirty
  },
};

// Exported so the provider can flush this domain's outbox on app-start / online / visible.
export const placesOutboxSync = placesChunkSync;

export const placesSyncPort: SyncPort<MyPlace[]> = {
  // Offline-outbox-decorated push: write-ahead enqueue → merge-aware singleton push →
  // ack-on-resolve; a rejecting push stays dirty and retries on the next flush. `withOutbox`
  // self-gates on `isTripRemoteConfigured()` AND an identified traveler (dormant / default pack /
  // guest never write the slot). Never throws.
  push: withOutbox(placesChunkSync),

  subscribe() {
    // Dormant / default-pack gate: no remote trip ⇒ no firebase import, a no-op unsubscribe.
    if (!isTripRemoteConfigured()) return () => {};

    let realUnsub: (() => void) | null = null;
    let cancelled = false;

    import('./places-remote')
      .then(({ subscribeRemotePlaces }) => {
        if (cancelled) return; // torn down before the import resolved
        realUnsub = subscribeRemotePlaces();
      })
      .catch((err) => {
        console.warn('[places] remote subscribe unavailable:', err);
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
    return isTripRemoteConfigured();
  },
};

// Re-export the StoragePort so the provider can wire flush(port) without reaching into core/places.
export { myPlacesStoragePort };
export type { StoragePort };

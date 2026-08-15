/**
 * My-places merge — the PURE local↔remote reconciliation for the `MyPlace[]` (issue #17,
 * D-229 addendum). A thin, deliberate adapter over the shared id-keyed row algebra
 * (`core/sync/merge-items.ts`), NOT a second merge implementation: the conflict rule is exactly
 * the one the itinerary / expenses / docs already run — per-row HLC-max with tombstone-wins-by-HLC
 * (`DEFAULT_POLICY.deleteWins === 'hlc'`), so a delete stays deleted unless a STRICTLY-later edit
 * resurrects it. It is not last-write-wins, and `rev` is a monotonic version, never the order key.
 *
 * ── PURITY ────────────────────────────────────────────────────────────────────────────────────
 * No I/O, no clock, no `window`, no firebase, no React. `nowPt` (the tombstone-GC horizon anchor)
 * is INJECTED, exactly like the itinerary's `gcTombstones`.
 *
 * ── WHY THIS FILE EXISTS AT ALL (three things a bare `mergeItems` gets wrong here) ────────────
 * 1. LEGACY HLC SEED. `mergeItems` seeds a missing `hlc` from `updatedAt` — a field `MyPlace`
 *    does not have (it has `addedAt`). Without `seedFromAddedAt` below, EVERY unstamped row
 *    resolves to `{pt:0,ct:0,actor:''}` and a same-id collision falls through to the last-resort
 *    JSON content fingerprint: deterministic, but semantically meaningless. The seed is applied
 *    TRANSIENTLY (`updatedAt` is never persisted — `sanitizePlaces` strips it on the way out)
 *    because it is derived from `addedAt` deterministically on every merge, so storing it would
 *    add bytes and a second source of truth for nothing.
 * 2. ORDER. `mergeItems` returns live rows HLC-ASCENDING (oldest first). `MyPlace[]` is a
 *    NEWEST-FIRST invariant. Feeding merged output straight into `saveMyPlaces` would leave the
 *    list reversed in the UI and — because the cap keeps the FIRST 200 — silently discard the
 *    NEWEST places instead of the oldest. Hence the explicit `newestFirst` re-sort before the cap.
 * 3. CAP. Tombstones are sorted and capped SEPARATELY from live rows (`capPlaces`, inside
 *    `sanitizePlaces`) so a burst of deletes can never evict a live place.
 *
 * CONVERGENCE: `mergeItems` is commutative + idempotent; `newestFirst` is a total order
 * (`addedAt` desc, `id` asc) computed from stored fields only, and `gcTombstoneRows` drops the
 * same rows on every client. So two devices reach the identical list regardless of arrival order.
 */

import { gcTombstoneRows, mergeItems } from '@/core/sync/merge-items';
import { sanitizePlaces, type MyPlace } from './model';

/** A place carrying the transient legacy-HLC seed. `updatedAt` never reaches storage or the wire. */
type SeededPlace = MyPlace & { updatedAt?: string };

/**
 * Give every un-stamped row a MEANINGFUL total-order key. A row written before issue #17 (or on a
 * device that was local-only at the time) has no `hlc`; `seedHlcFromLegacy(updatedAt)` inside
 * `mergeItems` would then hand it the pt=0 epoch. Copying `addedAt` into `updatedAt` makes the
 * seed the place's real import instant instead, so "the older import loses to the newer one" is
 * true rather than accidental. Deterministic ⇒ every client seeds identically.
 */
function seedFromAddedAt(rows: readonly MyPlace[]): SeededPlace[] {
  return (rows ?? []).map((p) => (p.hlc ? p : { ...p, updatedAt: p.addedAt }));
}

/** Newest-first by import instant, `id` ascending as the deterministic tie-break. */
function newestFirst(a: MyPlace, b: MyPlace): number {
  if (a.addedAt !== b.addedAt) return a.addedAt < b.addedAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Merge this device's places with the remote view of the same trip's places, producing a list
 * ready to hand straight to `saveMyPlaces` — newest-first, tombstones retained (the hook filters
 * them out of the exposed value) and capped.
 *
 * @param nowPt injected ms-since-epoch, the anchor for the 30-day tombstone GC horizon.
 */
export function mergePlaces(
  local: readonly MyPlace[],
  remote: readonly MyPlace[],
  nowPt: number,
): MyPlace[] {
  const merged = gcTombstoneRows(mergeItems(seedFromAddedAt(local), seedFromAddedAt(remote)), nowPt);
  const live = merged.filter((p) => p.deleted !== true).sort(newestFirst);
  const dead = merged.filter((p) => p.deleted === true).sort(newestFirst);
  // `sanitizePlaces` is the one narrowing boundary: it drops the transient `updatedAt` seed,
  // re-parses anything a peer build wrote, and applies the live/tombstone caps.
  return sanitizePlaces([...live, ...dead]);
}

// Cross-friend attribution stamping — the ONE place that decides
// how an item gets `createdBy` / `updatedBy` / `updatedAt`.
//
// Extracted from the store mutators so the stamping rule lives in a single named,
// unit-testable module.
// The store's `addItem` / `updateItem` / cross-day `moveItem` call these; `removeItem`
// and `reorderItems` deliberately do NOT (a delete/reorder is not a content edit).
//
// KEY CONTRACT: stamping fires ONLY when a display name is set. With no
// name (the dormant / local-only-no-name case) these are NO-OPS — the attribution fields
// stay `undefined` and the item remains valid. The name source is injected (the store
// passes `getUserName` from lib/identity) so this module stays pure and testable, and so
// it never imports firebase.
//
// ECHO-SUPPRESSION: these run ONLY inside the local mutators. The remote
// snapshot-ingest path writes items via savePlans() directly (never through the
// mutators), so a remote author's attribution is PRESERVED, never re-stamped locally.

import type { ItineraryItem } from './trip-data';

/** A function that returns the current display name, or null/undefined if none is set. */
export type NameSource = () => string | null | undefined;

/**
 * Stamp a freshly-ADDED item (addItem): set createdBy + updatedBy + updatedAt from the
 * current name. No-op (returns the item unchanged) when no name is set.
 *
 * If the item already carries a `createdBy` (e.g. a card-created draft, or a remote item
 * being re-added), the FIRST author wins — only `updatedBy`/`updatedAt` advance.
 *
 * @param item the item being added
 * @param getName name source (store injects lib/identity getUserName)
 * @param nowIso ISO timestamp to stamp (defaults to now; injectable for tests)
 */
export function stampCreated(
  item: ItineraryItem,
  getName: NameSource,
  nowIso: string = new Date().toISOString(),
): ItineraryItem {
  const name = getName();
  if (!name) return item;
  return {
    ...item,
    createdBy: item.createdBy ?? name,
    updatedBy: name,
    updatedAt: nowIso,
  };
}

/**
 * Stamp a CONTENT EDIT (updateItem / cross-day moveItem): set updatedBy + updatedAt from
 * the current name. No-op when no name is set. `createdBy` is left untouched (first
 * author wins).
 *
 * @param item the item being edited (already merged with any patch)
 * @param getName name source (store injects lib/identity getUserName)
 * @param nowIso ISO timestamp to stamp (defaults to now; injectable for tests)
 */
export function stampUpdated(
  item: ItineraryItem,
  getName: NameSource,
  nowIso: string = new Date().toISOString(),
): ItineraryItem {
  const name = getName();
  if (!name) return item;
  return { ...item, updatedBy: name, updatedAt: nowIso };
}

/**
 * Stamp COMPLETION attribution. Transition-gated on the `patch.done`:
 * - patch flips done false→true: stamp `doneBy = getName()` + `doneAt = now ISO`.
 * - patch flips done true→false: CLEAR BOTH (delete the keys).
 * - patch does not change `done`: return the item untouched (the whole point vs `updatedBy`).
 *
 * Name-gate mirrors `stampUpdated`: no display name set ⇒ stamping is a NO-OP (both stay absent),
 * so the dormant/portfolio build (no name) is byte-identical — a done toggle changes only `done`.
 * Clearing always runs (deleting an absent key is a no-op).
 *
 * @param item the item being edited (already merged with the patch)
 * @param patch the update patch
 * @param getName name source (store injects lib/identity getUserName)
 * @param nowIso ISO timestamp to stamp (defaults to now; injectable for tests)
 */
export function stampDone(
  item: ItineraryItem,
  patch: Partial<ItineraryItem>,
  getName: NameSource,
  nowIso: string = new Date().toISOString(),
): ItineraryItem {
  if (!('done' in patch)) return item;
  if (patch.done === false) {
    const { doneBy: _b, doneAt: _a, ...rest } = item;
    return rest;
  }
  if (patch.done === true) {
    const name = getName();
    if (!name) return item;
    return { ...item, doneBy: name, doneAt: nowIso };
  }
  return item;
}

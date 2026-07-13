// Core itinerary CRUD — pure, framework-free.
//
// EXTRACTED MECHANICALLY from `hooks/use-itinerary.ts`. Every array-manipulation
// body below is the VERBATIM logic that previously lived inside the hook's mutators —
// moved, not rewritten. The hook is now a thin React adapter that wires these pure
// functions to the ports (StoragePort = the Vault gateway; SyncPort = pushPlans) and
// supplies the two I/O-bearing callbacks these functions inject:
//
//   - `getCountryForDate` is imported from `@/core/dates` (pure, TZ-safe) — same source
//     the hook's `synthesizeDay` used via `@/lib/trip-data`'s re-export. It is the ONLY
//     dependency, and it is framework-free, so this module imports React / window /
//     firebase NOWHERE.
//   - Attribution stamping is INJECTED as `stamp` callbacks, NOT called here. The
//     adapter passes `stampCreated(item, getUserName)` / `stampUpdated(item, getUserName)`
//     bound closures so the identity read (I/O) stays at the adapter boundary and this
//     core stays pure. `addItem`/`updateItem`/`moveItem` take a `stamp` fn; `removeItem`
//     and `reorderItems` do not (a delete/reorder is not a content edit).
//
// Every function is a pure `DayPlan[] -> DayPlan[]` (or selector) transform. None reads or
// writes storage; the caller reads the freshest persisted base and persists the
// result. This is what makes the chained-mutation composition in one handler correct: each
// call is a plain transform over whatever array it is handed.

import type { DayPlan, ItineraryItem } from '@/lib/trip-data';
import { getCountryForDate, getCityForDate } from '@/core/dates';

/**
 * A stamper: given an item, return it with attribution applied (or unchanged when no name
 * is set). Injected by the adapter so this core stays free of the identity read.
 */
export type ItemStamper = (item: ItineraryItem) => ItineraryItem;

/** Identity stamper — the no-attribution default (used by tests / pure callers). */
export const noStamp: ItemStamper = (item) => item;

/**
 * Synthesize an empty day for a date with no stored plan. Lifted from `use-itinerary.ts`'s
 * `synthesizeDay` (itself lifted from `calendar-planner.tsx`); the `city` now comes from
 * `getCityForDate` — the SAME per-day city source `dayInTripFor` (`core/dates`) uses,
 * so a synthesized day and the travel-mode/Today header agree on the REAL day-trip city
 * (Nagarkot, Kyoto, …) rather than collapsing to the base city. Behavior is unchanged on the
 * frozen base dates (their sample city IS the base city).
 */
export function synthesizeDay(dateStr: string): DayPlan {
  return {
    date: dateStr,
    city: getCityForDate(dateStr),
    country: getCountryForDate(dateStr),
    items: [],
  };
}

/**
 * Upsert helper mirroring the store's former `updateDayPlan`: if a DayPlan exists for
 * `date`, map over it; otherwise synthesize an empty day and apply the updater. Verbatim
 * from `use-itinerary.ts`'s `upsertDay` compute body.
 */
export function upsertDay(
  current: DayPlan[],
  date: string,
  updater: (plan: DayPlan) => DayPlan,
): DayPlan[] {
  const existing = current.find((p) => p.date === date);
  return existing
    ? current.map((p) => (p.date === date ? updater(p) : p))
    : [...current, updater(synthesizeDay(date))];
}

/**
 * Add an item to a day. Verbatim from `use-itinerary.ts`'s `addItem` → `upsertDay`
 * updater body. The item is stamped by the injected `stamp` at the boundary
 * BEFORE the pure append, exactly as the hook stamped it before calling upsertDay.
 */
export function addItem(
  current: DayPlan[],
  date: string,
  item: ItineraryItem,
  stamp: ItemStamper = noStamp,
): DayPlan[] {
  const stamped = stamp(item);
  return upsertDay(current, date, (plan) => ({
    ...plan,
    items: [...(plan.items ?? []), stamped],
  }));
}

/**
 * Patch an item within a day. Verbatim from `use-itinerary.ts`'s `updateItem` →
 * `upsertDay` updater body. The MERGED item is stamped by the injected `stamp`,
 * matching the hook's `stampUpdated({ ...i, ...patch }, getUserName)`.
 */
export function updateItem(
  current: DayPlan[],
  date: string,
  itemId: string,
  patch: Partial<ItineraryItem>,
  stamp: ItemStamper = noStamp,
): DayPlan[] {
  return upsertDay(current, date, (plan) => ({
    ...plan,
    items: (plan.items ?? []).map((i) =>
      i.id === itemId ? stamp({ ...i, ...patch }) : i,
    ),
  }));
}

/**
 * Remove an item from a day. Verbatim from `use-itinerary.ts`'s `removeItem` →
 * `upsertDay` updater body. No attribution (a delete is not a content edit).
 */
export function removeItem(current: DayPlan[], date: string, itemId: string): DayPlan[] {
  return upsertDay(current, date, (plan) => ({
    ...plan,
    items: (plan.items ?? []).filter((i) => i.id !== itemId),
  }));
}

/**
 * Clear a whole day — empty its `items` in ONE transform. Mirrors `removeItem`'s
 * `upsertDay` structure but drops every item rather than one. Pure `DayPlan[] -> DayPlan[]`:
 * the DORMANT clear (a physical empty). The SYNC-on clear tombstones every live item in the
 * hook adapter (one commit → one per-day doc write); this core stays I/O-free.
 */
export function clearDay(current: DayPlan[], date: string): DayPlan[] {
  return upsertDay(current, date, (plan) => ({ ...plan, items: [] }));
}

/**
 * Move an item between days. Verbatim from `use-itinerary.ts`'s `moveItem` compute body:
 * remove from source, append to the (upserted) target. A cross-day move IS a content edit
 * → the moved item is stamped by the injected `stamp` (createdBy preserved, first
 * author wins). Same-date is a no-op guard, matching the hook.
 */
export function moveItem(
  current: DayPlan[],
  itemId: string,
  fromDate: string,
  toDate: string,
  stamp: ItemStamper = noStamp,
): DayPlan[] {
  if (fromDate === toDate) return current;

  const sourcePlan = current.find((p) => p.date === fromDate);
  const item = (sourcePlan?.items ?? []).find((i) => i.id === itemId);
  if (!item) return current;

  const moved = stamp(item);

  // Remove from source.
  const removed = current.map((p) =>
    p.date === fromDate
      ? { ...p, items: (p.items ?? []).filter((i) => i.id !== itemId) }
      : p,
  );
  // Append to target (upsert it if absent).
  const targetExists = removed.some((p) => p.date === toDate);
  return targetExists
    ? removed.map((p) =>
        p.date === toDate ? { ...p, items: [...(p.items ?? []), moved] } : p,
      )
    : [...removed, { ...synthesizeDay(toDate), items: [moved] }];
}

/**
 * Reorder items within a day to match `orderedIds`. Verbatim from `use-itinerary.ts`'s
 * `reorderItems` → `upsertDay` updater body. Items not present in `orderedIds` are dropped
 * (callers pass the full set); unknown ids are ignored.
 */
export function reorderItems(
  current: DayPlan[],
  date: string,
  orderedIds: string[],
): DayPlan[] {
  return upsertDay(current, date, (plan) => {
    const byId = new Map((plan.items ?? []).map((i) => [i.id, i]));
    const reordered = orderedIds
      .map((id) => byId.get(id))
      .filter((i): i is ItineraryItem => i !== undefined);
    return { ...plan, items: reordered };
  });
}

/**
 * Bulk delete — remove a set of items across days in ONE transform, by FOLDING the
 * single-item `removeItem` over the selection. Pure `DayPlan[] -> DayPlan[]`: the DORMANT
 * bulk delete (physical removes). The SYNC-on bulk delete tombstones every selected item in
 * the hook adapter (one commit → few per-day doc writes); this core stays I/O-free.
 * Folding `removeItem` (not re-implementing) means each removal composes on the prior's output.
 */
export function deleteItems(
  current: DayPlan[],
  targets: Array<{ date: string; itemId: string }>,
): DayPlan[] {
  return targets.reduce((acc, { date, itemId }) => removeItem(acc, date, itemId), current);
}

/**
 * Bulk move — move a set of items to `toDate` in ONE transform, by FOLDING the
 * single-item `moveItem` over the selection. Pure `DayPlan[] -> DayPlan[]`: the DORMANT bulk
 * move (physical remove-from-source + append-to-target, same ids — byte-safe since
 * no source tombstone exists). The SYNC-on move mints fresh-id targets in the hook adapter,
 * exactly as the single `moveItem` sync path does. A cross-day move IS a content edit
 * → the injected `stamp` applies; same-date targets are no-ops (matches `moveItem`).
 */
export function moveItems(
  current: DayPlan[],
  targets: Array<{ itemId: string; fromDate: string }>,
  toDate: string,
  stamp: ItemStamper = noStamp,
): DayPlan[] {
  return targets.reduce(
    (acc, { itemId, fromDate }) => moveItem(acc, itemId, fromDate, toDate, stamp),
    current,
  );
}

/**
 * Copy a whole day — copy `srcDate`'s LIVE items onto `dstDate` in ONE transform, by
 * FOLDING the single-item `addItem` over a fresh-id copy of each. Every produced copy goes
 * through the injected `copyOf` stripper (production = `freshCopyOf`: strip id/deleted/rev/hlc,
 * mint a new id, keep content + sourceId) so a copy NEVER reuses a source id — which also makes
 * `copyDay(current, d, d)` (copy onto the same day) safe: the copies get fresh ids and cannot
 * collide with the originals (dedupe on id). Tombstones on the source are skipped (live only).
 * Pure `DayPlan[] -> DayPlan[]`; the hook injects `copyOf`/`stamp` at the boundary.
 */
export function copyDay(
  current: DayPlan[],
  srcDate: string,
  dstDate: string,
  copyOf: (item: ItineraryItem) => ItineraryItem,
  stamp: ItemStamper = noStamp,
): DayPlan[] {
  const src = current.find((p) => p.date === srcDate);
  const items = (src?.items ?? []).filter((i) => i.deleted !== true);
  return items.reduce((acc, item) => addItem(acc, dstDate, copyOf(item), stamp), current);
}

/**
 * Selector: the DayPlan for a date, or a synthesized empty day. Verbatim from
 * `use-itinerary.ts`'s `getDayPlan` selector body (now operating on the passed plans).
 */
export function getDayPlan(plans: DayPlan[], date: string): DayPlan {
  return plans.find((p) => p.date === date) ?? synthesizeDay(date);
}

/**
 * Selector: every plan item across all days whose `sourceId` equals `sourceId`, with its
 * date. Verbatim from `use-itinerary.ts`'s `findPlacements` selector body.
 */
export function findPlacements(
  plans: DayPlan[],
  sourceId: string,
): Array<{ date: string; item: ItineraryItem }> {
  const out: Array<{ date: string; item: ItineraryItem }> = [];
  for (const plan of plans) {
    for (const item of plan.items ?? []) {
      if (item.sourceId === sourceId) out.push({ date: plan.date, item });
    }
  }
  return out;
}

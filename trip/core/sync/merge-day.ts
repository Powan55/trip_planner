/**
 * Sync v2 — the PURE per-day item-level merge.
 *
 * Replaces today's per-day last-write-wins (which clobbers a whole day-doc) with an
 * item-level merge keyed on `ItineraryItem.id`: two friends editing DIFFERENT items on the
 * same day both keep their edits; only a genuine SAME-`id` concurrent edit falls back to a
 * deterministic HLC tie-break (`hlc.ts`). The merge lives ENTIRELY inside one per-day
 * doc (no per-item docs, no new collection).
 *
 * ── PURITY ─────────────────────────────────────────────────────────────
 * No I/O, no clock, no `window`, no firebase, no React/Next. `nowPt` for GC is INJECTED.
 * Imports only the domain types and the pure HLC helpers.
 *
 * ── CONVERGENCE ─────────────────────────────────────────────
 * `mergeDay` is COMMUTATIVE (winner of each `id` is HLC-determined, independent of argument
 * order) and IDEMPOTENT (`mergeDay(x, mergeDay(x,y))` ≡ `mergeDay(x,y)`). Because each item's
 * winner is a deterministic total-order max and days/items are independent, the merge
 * is a join over a lattice ⇒ all clients converge to the same state regardless of the order
 * snapshots arrive. The commutativity + idempotence property test in the test suite is the
 * formal statement of "no client can end up divergent".
 */

import type { DayPlan } from '@/lib/trip-data';
import { mergeItems, gcTombstoneRows, DEFAULT_GC_HORIZON_MS, DEFAULT_POLICY, type MergePolicy } from './merge-items';

// The per-item conflict resolver + the id-keyed union/ordering were generalized into
// `merge-items.ts` so expenses reuse the identical merge
// algebra. `mergeDay` now DELEGATES to `mergeItems` — behavior-preserving, so the original suite
// passes with ZERO assertion edits. `MergePolicy` is re-exported here to keep this module's
// public API byte-identical (`core-merge-day.test.ts` imports the type from here). The GC horizon
// is likewise re-exported from its new home in `merge-items.ts` so the day-shaped `gcTombstones`
// public API is unchanged (the test imports `DEFAULT_GC_HORIZON_MS` from here).
export type { MergePolicy } from './merge-items';
export { DEFAULT_GC_HORIZON_MS } from './merge-items';

/**
 * Merge the local view of ONE day with the remote view of the SAME day.
 * Operates entirely within the day-doc. Keeps the LOCAL day metadata (`date`/`city`/`country`)
 * and merges only the `items` via the shared `mergeItems` — day metadata is derived from
 * the date and never a conflict source in practice.
 *
 * Result `items` INCLUDE tombstones (they must persist to propagate + win). The
 * UI-exposed selector filters `deleted` out downstream — the MERGE sees tombstones;
 * the UI does not. Ordering is `mergeItems`' deterministic hlc-asc rule (live first, tombstones
 * appended) — extracted verbatim, so convergence + the original ordering assertions are unchanged.
 */
export function mergeDay(local: DayPlan, remote: DayPlan, policy: MergePolicy = DEFAULT_POLICY): DayPlan {
  return { ...local, items: mergeItems(local.items ?? [], remote.items ?? [], policy) };
}

/**
 * Collection-level merge: pair days by `date` and `mergeDay` each matched
 * pair; a day present on only one side passes through unchanged (different dates never
 * conflict — the whole reason per-day docs work). Result is sorted by `date` ascending for a
 * deterministic, argument-order-independent output.
 */
export function mergeDays(local: DayPlan[], remote: DayPlan[], policy: MergePolicy = DEFAULT_POLICY): DayPlan[] {
  const byDate = new Map<string, DayPlan>();
  for (const d of local) byDate.set(d.date, d);
  for (const d of remote) {
    const existing = byDate.get(d.date);
    byDate.set(d.date, existing ? mergeDay(existing, d, policy) : d);
  }
  return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Garbage-collect old, unreferenced tombstones from ONE day — a SEPARATE
 * pure pass the adapter may run opportunistically AFTER a merge, never in the hot merge path
 * (so a GC bug can never lose a live item). PURE: `nowPt` (physical now, ms) is INJECTED.
 *
 * Drop a tombstone iff BOTH:
 *   - its `hlc.pt` is older than `nowPt - horizonMs` (comfortably past any realistic offline
 *     window — default 30 days), AND
 *   - no LIVE item on this day shares its `id` (nothing references/supersedes it).
 * Because the merge is deterministic and runs on every client, all clients GC the same
 * tombstone at the same logical point ⇒ convergent. Conservative: when in doubt, keep it
 * (doc size is a non-issue at 32 days × a friends group; GC is tidiness, not correctness).
 *
 * @param day       the day to GC.
 * @param nowPt     injected physical-now in ms (ClockPort.now().getTime()).
 * @param horizonMs how old a tombstone's `hlc.pt` must be before it may drop (default 30d).
 */
export function gcTombstones(day: DayPlan, nowPt: number, horizonMs: number = DEFAULT_GC_HORIZON_MS): DayPlan {
  // DELEGATE to the id-keyed `gcTombstoneRows` (merge-items.ts) — ONE GC predicate shared with the
  // expenses analog. Behavior-preserving vs the former inline copy (the gc suite passes
  // with ZERO assertion edits): identical live-never-dropped / old-unreferenced-tombstone-dropped
  // rule, over the same `hlc ?? seedHlcFromLegacy(updatedAt)` ordering key.
  return { ...day, items: gcTombstoneRows(day.items ?? [], nowPt, horizonMs) };
}

/**
 * Sync v2 — the PURE per-day item-level merge.
 *
 * Replaces per-day last-write-wins (which clobbers a whole day-doc) with an
 * item-level merge keyed on `ItineraryItem.id`: two friends editing DIFFERENT items on the
 * same day both keep their edits; only a genuine SAME-`id` concurrent edit falls back to a
 * deterministic HLC tie-break (`hlc.ts`). The merge lives ENTIRELY inside one per-day
 * doc (no per-item docs, no new collection).
 *
 * ── PURITY ───────────────────────────────────────────────────────────────────
 * No I/O, no clock, no `window`, no firebase, no React/Next. `nowPt` for GC is INJECTED.
 * Imports only the domain types and the pure HLC helpers.
 *
 * ── CONVERGENCE ──────────────────────────────────────────────────────────────
 * `mergeDay` is COMMUTATIVE (winner of each `id` is HLC-determined, independent of argument
 * order) and IDEMPOTENT (`mergeDay(x, mergeDay(x,y))` ≡ `mergeDay(x,y)`). Because each item's
 * winner is a deterministic total-order max and days/items are independent, the merge
 * is a join over a lattice ⇒ all clients converge to the same state regardless of the order
 * snapshots arrive. The commutativity + idempotence property test is the
 * formal statement of "no client can end up divergent".
 */

import type { DayPlan, ItineraryItem } from '@/lib/trip-data';
import { compareHlc, parse, seedHlcFromLegacy, type Hlc } from './hlc';

/**
 * Delete-vs-edit resolution policy, a single named flag so the choice is
 * reversible without touching the merge internals:
 *   - `'hlc'`   (DEFAULT) — tombstone-wins-BY-HLC: the deleted item stays deleted unless a
 *               STRICTLY-later edit (higher HLC) resurrects it. Deterministic + convergent;
 *               allows a legitimate late re-add. Recommended default.
 *   - `'always'`— any tombstone beats any concurrent edit regardless of HLC. Simpler mental
 *               model; loses late re-adds. Exposed + tested; NOT the default.
 */
export interface MergePolicy {
  deleteWins: 'hlc' | 'always';
}

const DEFAULT_POLICY: MergePolicy = { deleteWins: 'hlc' };

/**
 * The effective HLC of an item for ordering/tie-break. An item carrying no `hlc` (a legacy
 * or freshly-read v1 item) is SEEDED deterministically from its `updatedAt` so the
 * merge always has a total-order key. Pure: `seedHlcFromLegacy` reads no clock.
 */
function itemHlc(item: ItineraryItem): Hlc {
  return parse(item.hlc ?? seedHlcFromLegacy(item.updatedAt));
}

/**
 * Resolve two items with the SAME `id` (one local, one remote) to a single winner.
 * This is the whole per-item conflict decision.
 */
function resolvePair(a: ItineraryItem, b: ItineraryItem, policy: MergePolicy): ItineraryItem {
  const aDel = a.deleted === true;
  const bDel = b.deleted === true;

  // Tombstone vs live edit — policy 'always': any tombstone beats any concurrent edit.
  if (policy.deleteWins === 'always' && aDel !== bDel) {
    return aDel ? a : b;
  }

  // All other cases (live-vs-live, tombstone-vs-tombstone, and 'hlc' tombstone-vs-edit):
  // higher HLC wins. For 'hlc' delete-vs-edit this is exactly "tombstone stays unless a
  // strictly-later edit resurrects"; ties (edit.hlc == tombstone.hlc) keep the tombstone
  // because compareHlc returns 0 and we bias the tombstone on a tie below.
  const cmp = compareHlc(itemHlc(a), itemHlc(b));
  if (cmp > 0) return a;
  if (cmp < 0) return b;
  // Exact HLC tie (same pt/ct/actor). In the REAL protocol this only happens on a genuine
  // ECHO (a===b by value), because two different-content edits can never share (pt,ct,actor)
  // — a device stamps monotonically and distinct devices differ on `actor`. So on an echo
  // `a` and `b` are value-identical and either choice is convergent + idempotent.
  //
  // For ROBUSTNESS we still make the (protocol-impossible) equal-HLC/different-content case
  // deterministic so `mergeDay` is UNCONDITIONALLY commutative:
  //   1. bias the tombstone (a delete is not spuriously resurrected by an equal-HLC live copy);
  //   2. else break by a stable content fingerprint (higher wins) — argument-order-independent.
  if (aDel !== bDel) return aDel ? a : b;
  return contentFingerprint(a) >= contentFingerprint(b) ? a : b;
}

/**
 * A stable, canonical string fingerprint of an item for the protocol-impossible
 * equal-HLC/different-content tie-break above. Keys are sorted so the fingerprint is
 * argument-order-independent (JSON key order otherwise follows insertion order). Used ONLY
 * as a last-resort determinism guard — never in the normal HLC-ordered path.
 */
function contentFingerprint(it: ItineraryItem): string {
  const entries = Object.entries(it as unknown as Record<string, unknown>).sort(([x], [y]) =>
    x < y ? -1 : x > y ? 1 : 0,
  );
  return JSON.stringify(entries);
}

/**
 * Merge the local view of ONE day with the remote view of the SAME day.
 * Operates entirely within the day-doc. Preserves the day's `date`/`city`/`country` from
 * whichever side has the newer top-level intent; here we keep the LOCAL day metadata (the
 * device's own city/country label for the date) and merge only the `items` — day metadata
 * is derived from the date and never a conflict source in practice.
 *
 * Result `items` INCLUDE tombstones (they must persist to propagate + win). The
 * UI-exposed selector filters `deleted` out downstream — the MERGE sees
 * tombstones; the UI does not.
 *
 * ORDERING (the chosen rule): the merged live items are sorted by their
 * winning `hlc` ASCENDING (oldest-created/edited first), with `id` as a final deterministic
 * tie-break; tombstones are appended after the live items (excluded from the exposed order).
 * This is simple, stable, and fully convergent — independent of argument order — accepting
 * that a manual within-day reorder may be re-sorted after a concurrent remote edit (a
 * known trade-off; no ITEM is ever lost, only order may change).
 */
export function mergeDay(local: DayPlan, remote: DayPlan, policy: MergePolicy = DEFAULT_POLICY): DayPlan {
  const byId = new Map<string, ItineraryItem>();

  // Seed with local items.
  for (const it of local.items ?? []) {
    byId.set(it.id, it);
  }
  // Fold in remote items, resolving collisions per-`id`.
  for (const rit of remote.items ?? []) {
    const existing = byId.get(rit.id);
    byId.set(rit.id, existing ? resolvePair(existing, rit, policy) : rit);
  }

  const winners = Array.from(byId.values());
  const live = winners.filter((it) => it.deleted !== true);
  const tombstones = winners.filter((it) => it.deleted === true);

  const orderKey = (it: ItineraryItem) => it.hlc ?? seedHlcFromLegacy(it.updatedAt);
  const stableSort = (arr: ItineraryItem[]) =>
    arr.sort((x, y) => {
      const kx = orderKey(x);
      const ky = orderKey(y);
      if (kx !== ky) return kx < ky ? -1 : 1;
      return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
    });

  const items = [...stableSort(live), ...stableSort(tombstones)];

  return { ...local, items };
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
export const DEFAULT_GC_HORIZON_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function gcTombstones(day: DayPlan, nowPt: number, horizonMs: number = DEFAULT_GC_HORIZON_MS): DayPlan {
  const liveIds = new Set((day.items ?? []).filter((it) => it.deleted !== true).map((it) => it.id));
  const cutoff = nowPt - horizonMs;
  const items = (day.items ?? []).filter((it) => {
    if (it.deleted !== true) return true; // never drop a live item
    const pt = itemHlc(it).pt;
    const tooOld = pt < cutoff;
    const referenced = liveIds.has(it.id); // a live item resurrected this id — keep the ghost out, but don't GC "referenced"
    // Keep the tombstone unless it is BOTH old enough AND not referenced by a live item.
    return !(tooOld && !referenced);
  });
  return { ...day, items };
}

/**
 * Sync v2 — the PURE id-keyed row merge.
 *
 * This is the GENERALIZATION of `merge-day.ts`'s per-item fold: the
 * conflict resolver (`resolvePair`) and the union-by-id + deterministic ordering were already
 * item-generic — only the `DayPlan` wrapper + day-metadata handling were itinerary-specific.
 * They were EXTRACTED here as `mergeItems<R>` over any id-keyed row carrying the Sync-v2 stamps,
 * so expenses (chunked by leg) reuse the exact same merge algebra the itinerary proved. The
 * `merge-day.ts` API is unchanged: `mergeDay` now DELEGATES to `mergeItems` (its original suite passes
 * with ZERO assertion edits — that is the extraction's proof).
 *
 * ── PURITY ─────────────────────────────────────────────────────────────
 * No I/O, no clock, no `window`, no firebase, no React/Next. Imports only the pure HLC helpers.
 *
 * ── CONVERGENCE ──────────────────────────────────────────
 * COMMUTATIVE (each id's winner is an HLC-determined total-order max, argument-order-independent)
 * and IDEMPOTENT (`mergeItems(x, mergeItems(x,y)) ≡ mergeItems(x,y)`) — a join over a lattice, so
 * all clients converge to the same row-set regardless of the order snapshots arrive.
 */

import { compareHlc, parse, seedHlcFromLegacy, type Hlc } from './hlc';

/** Structural row type — anything id-keyed carrying the Sync-v2 stamps. */
export interface SyncedRow {
  id: string;
  rev?: number;
  hlc?: string;
  deleted?: boolean;
  /** Legacy HLC seed source when `hlc` is absent (seedHlcFromLegacy). */
  updatedAt?: string;
}

/**
 * Delete-vs-edit resolution policy, a single named flag so the choice is
 * reversible without touching the merge internals:
 *   - `'hlc'`   (DEFAULT) — tombstone-wins-BY-HLC: the deleted row stays deleted unless a
 *               STRICTLY-later edit (higher HLC) resurrects it. Deterministic + convergent.
 *   - `'always'`— any tombstone beats any concurrent edit regardless of HLC. Exposed + tested;
 *               NOT the default.
 */
export interface MergePolicy {
  deleteWins: 'hlc' | 'always';
}

export const DEFAULT_POLICY: MergePolicy = { deleteWins: 'hlc' };

/**
 * The effective HLC of a row for ordering/tie-break. A row carrying no `hlc` (a legacy or
 * freshly-read v1 row) is SEEDED deterministically from its `updatedAt` so the merge
 * always has a total-order key. Pure: `seedHlcFromLegacy` reads no clock.
 */
function rowHlc(row: SyncedRow): Hlc {
  return parse(row.hlc ?? seedHlcFromLegacy(row.updatedAt));
}

/**
 * Resolve two rows with the SAME `id` (one local, one remote) to a single winner.
 * This is the whole per-row conflict decision — extracted verbatim
 * from `merge-day.ts`'s former `resolvePair` (behavior-preserving; the original suite pins it).
 */
export function resolvePair<R extends SyncedRow>(a: R, b: R, policy: MergePolicy): R {
  const aDel = a.deleted === true;
  const bDel = b.deleted === true;

  // Tombstone vs live edit — policy 'always': any tombstone beats any concurrent edit.
  if (policy.deleteWins === 'always' && aDel !== bDel) {
    return aDel ? a : b;
  }

  // All other cases (live-vs-live, tombstone-vs-tombstone, and 'hlc' tombstone-vs-edit):
  // higher HLC wins. For 'hlc' delete-vs-edit this is exactly "tombstone stays unless a
  // strictly-later edit resurrects"; ties keep the tombstone (compareHlc returns 0 and we bias
  // the tombstone on a tie below).
  const cmp = compareHlc(rowHlc(a), rowHlc(b));
  if (cmp > 0) return a;
  if (cmp < 0) return b;
  // Exact HLC tie (same pt/ct/actor). In the REAL protocol this only happens on a genuine ECHO
  // (a===b by value). For ROBUSTNESS we still make the (protocol-impossible) equal-HLC/
  // different-content case deterministic so the merge is UNCONDITIONALLY commutative:
  //   1. bias the tombstone (a delete is not spuriously resurrected by an equal-HLC live copy);
  //   2. else break by a stable content fingerprint (higher wins) — argument-order-independent.
  if (aDel !== bDel) return aDel ? a : b;
  return contentFingerprint(a) >= contentFingerprint(b) ? a : b;
}

/**
 * A stable, canonical string fingerprint of a row for the protocol-impossible equal-HLC/
 * different-content tie-break above. Keys are sorted so the fingerprint is argument-order-
 * independent. Used ONLY as a last-resort determinism guard — never in the normal HLC path.
 */
function contentFingerprint(row: SyncedRow): string {
  const entries = Object.entries(row as unknown as Record<string, unknown>).sort(([x], [y]) =>
    x < y ? -1 : x > y ? 1 : 0,
  );
  return JSON.stringify(entries);
}

/**
 * Merge the local view of an id-keyed row-set with the remote view of the SAME set.
 * Union by `id`; on a same-`id` collision, `resolvePair` picks the winner. Result rows
 * INCLUDE tombstones (they must persist to propagate + win); the caller's exposed
 * selector filters `deleted` out downstream.
 *
 * ORDERING (the chosen rule, extracted from `mergeDay`): live rows sorted by
 * their winning `hlc` ASCENDING (oldest first), with `id` as a final deterministic tie-break;
 * tombstones appended after the live rows (same sort). Stable + fully convergent — independent
 * of argument order.
 */
export function mergeItems<R extends SyncedRow>(
  local: readonly R[],
  remote: readonly R[],
  policy: MergePolicy = DEFAULT_POLICY,
): R[] {
  const byId = new Map<string, R>();

  // Seed with local rows.
  for (const it of local ?? []) {
    byId.set(it.id, it);
  }
  // Fold in remote rows, resolving collisions per-`id`.
  for (const rit of remote ?? []) {
    const existing = byId.get(rit.id);
    byId.set(rit.id, existing ? resolvePair(existing, rit, policy) : rit);
  }

  const winners = Array.from(byId.values());
  const live = winners.filter((it) => it.deleted !== true);
  const tombstones = winners.filter((it) => it.deleted === true);

  const orderKey = (it: R) => it.hlc ?? seedHlcFromLegacy(it.updatedAt);
  const stableSort = (arr: R[]) =>
    arr.sort((x, y) => {
      const kx = orderKey(x);
      const ky = orderKey(y);
      if (kx !== ky) return kx < ky ? -1 : 1;
      return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
    });

  return [...stableSort(live), ...stableSort(tombstones)];
}

/**
 * Default tombstone GC horizon: a tombstone may drop once its `hlc.pt` is
 * older than 30 days — comfortably past any realistic offline window. Lives here (the id-keyed
 * layer) so BOTH the itinerary `gcTombstones` (day-shaped) and the expenses `gcTombstoneRows`
 * (chunk-shaped) share ONE horizon; `merge-day.ts` re-exports it for its existing public API.
 */
export const DEFAULT_GC_HORIZON_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Garbage-collect old, unreferenced tombstones from ONE id-keyed row-set —
 * the expenses analog of `merge-day.ts`'s day-shaped `gcTombstones`, which now DELEGATES here so
 * there is ONE GC predicate. A SEPARATE pure pass the adapter runs on a MERGED result at the two
 * merge boundaries only (never in the hot merge path, never as its own write). PURE: `nowPt` is
 * INJECTED.
 *
 * Drop a row iff BOTH:
 *   - it is a tombstone (`deleted === true`), AND
 *   - its `hlc.pt` is older than `nowPt - horizonMs`, AND
 *   - no LIVE row shares its `id` (nothing references/supersedes it).
 * Structurally unable to drop a live row (the first guard returns it untouched) or a recent
 * tombstone (still inside the horizon). Conservative + convergent: every client GCs the same row
 * at the same logical point; cross-client `nowPt` skew only delays a drop, never loses data.
 */
export function gcTombstoneRows<R extends SyncedRow>(
  rows: readonly R[],
  nowPt: number,
  horizonMs: number = DEFAULT_GC_HORIZON_MS,
): R[] {
  const liveIds = new Set((rows ?? []).filter((r) => r.deleted !== true).map((r) => r.id));
  const cutoff = nowPt - horizonMs;
  return (rows ?? []).filter((r) => {
    if (r.deleted !== true) return true; // never drop a live row
    const tooOld = rowHlc(r).pt < cutoff;
    const referenced = liveIds.has(r.id); // a live row resurrected this id → keep the ghost paired
    return !(tooOld && !referenced);
  });
}

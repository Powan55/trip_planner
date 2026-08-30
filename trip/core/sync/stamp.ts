/**
 * Sync v2 — the `rev`/`hlc` stamping helper, PURE core.
 *
 * The ONE place that decides how a local edit advances an item's `rev` (monotonic per-item
 * revision) and `hlc` (the primary merge order key). It rides ALONGSIDE the existing
 * attribution stamping (`lib/attribution.ts` sets `createdBy`/`updatedBy`/`updatedAt`) —
 * this sets the two NEW ordering/version fields, keeping "one stamping concern, one module"
 * per side. Attribution stays in `lib/` (it takes a name source); the ordering stamp is pure
 * `core/` because it only needs an injected clock + uid.
 *
 * ── PURITY ─────────────────────────────────────────────────────────────
 * `physicalNow` (ms) and `actor` (uid) are INJECTED. No clock read, no firebase, no window.
 * Imports only the domain type and the pure HLC helpers. Testable in isolation.
 *
 * ── STATUS: PROVIDED + UNIT-TESTED, NOT YET WIRED ────────────────────────
 * These helpers are complete and covered, but does NOT call them from the store — the
 * store mutators stay untouched this change.
 *
 * ── DORMANT-GATE DECISION for ──────
 * RECOMMENDED: at gate `hlc` stamping on the caller's `isRemoteConfigured()` — i.e.
 * only stamp `rev`/`hlc` on a local edit when remote sync is actually configured. Dormant
 * (no-Firebase) items then receive `rev`/`hlc` ONLY at the migration / `docToDayPlan`
 * defaulting boundary, so the dormant portfolio build stays byte-for-byte identical.
 * The helpers below are gate-agnostic (pure); the GATE is the caller's responsibility at
 * Confirmed at.
 */

import type { ItineraryItem } from '@/lib/trip-data';
import { hlcSendOrLocal, parse, serialize } from './hlc';

// ── The PURE, TYPE-AGNOSTIC hlc-advance primitives ────────────────────────────────────
// The itinerary `stampSync*` wrappers below stay
// `ItineraryItem`-typed so their contextual `category` narrowing is preserved and the suite
// passes with ZERO edits. To avoid duplicating the rev/hlc math for the SECOND synced domain
//, the math is factored into these two primitives — a `{rev,hlc}` fragment the
// itinerary wrappers AND the expense stampers both spread onto their own typed row (
// "SAME helpers, generalized", realized as a shared fragment rather than a generic that would
// forfeit the frozen suite's literal-narrowing). Reads use a narrow structural shape.

/** The fresh-create ordering fragment: `rev=1` + a brand-new hlc from this device. */
export function firstSyncStamp(physicalNow: number, actor: string): { rev: number; hlc: string } {
  return { rev: 1, hlc: serialize(hlcSendOrLocal(null, physicalNow, actor)) };
}

/** The edit ordering fragment: bump `rev` + advance the hlc from `prev`'s hlc. */
export function nextSyncStamp(
  prev: { rev?: number; hlc?: string } | null | undefined,
  physicalNow: number,
  actor: string,
): { rev: number; hlc: string } {
  const last = prev?.hlc ? parse(prev.hlc) : null;
  return { rev: (prev?.rev ?? 1) + 1, hlc: serialize(hlcSendOrLocal(last, physicalNow, actor)) };
}

/**
 * Stamp a freshly-ADDED item's ordering fields:
 * - `rev = 1` (first known revision), and
 * - `hlc = hlcSendOrLocal(null, physicalNow, actor)` (a fresh stamp from this device).
 * Existing content fields and the attribution triple are untouched — this composes
 * with `stampCreated`, it does not replace it.
 *
 * @param item the item being added (already attribution-stamped if applicable).
 * @param physicalNow injected ms-since-epoch (ClockPort.now().getTime()).
 * @param actor this device's uid.
 */
export function stampSyncCreated(item: ItineraryItem, physicalNow: number, actor: string): ItineraryItem {
  return { ...item, ...firstSyncStamp(physicalNow, actor) };
}

/**
 * Stamp a CONTENT EDIT's ordering fields (, `updateItem` / cross-day
 * `moveItem`): bump `rev` and advance `hlc` from the item's PREVIOUS `hlc`:
 * - `rev = (prev.rev ?? 1) + 1`, and
 * - `hlc = hlcSendOrLocal(parse(prev.hlc) ?? null, physicalNow, actor)`.
 * The result's `hlc` is ALWAYS strictly greater than the previous (monotonic — hlc.ts).
 *
 * @param item the item being edited (already merged with any patch + attribution).
 * @param physicalNow injected ms-since-epoch.
 * @param actor this device's uid.
 */
export function stampSyncUpdated(item: ItineraryItem, physicalNow: number, actor: string): ItineraryItem {
  return { ...item, ...nextSyncStamp(item, physicalNow, actor) };
}

/**
 * Stamp a DELETE as a tombstone: a delete is now a content
 * event that must PROPAGATE and be ORDERED, so it does NOT physically remove the item — it
 * flips `deleted:true`, bumps `rev`, and advances `hlc`. The UI-exposed selector filters
 * `deleted` out downstream so the user still sees the item gone.
 *
 * @param item the item being deleted.
 * @param physicalNow injected ms-since-epoch.
 * @param actor this device's uid.
 */
export function stampSyncDeleted(item: ItineraryItem, physicalNow: number, actor: string): ItineraryItem {
  return { ...item, deleted: true, ...nextSyncStamp(item, physicalNow, actor) };
}

/**
 * Stamp a REORDER: re-stamp `rows` so their `hlc`s ASCEND in the array order given.
 *
 * Array position is not a merge-visible fact. `mergeItems` re-sorts every merged row-set by
 * `hlc` ascending, and that sort runs at BOTH sync boundaries (`pushDayMerged` →
 * `mergeDay(remoteNow, localDay)`, and the server-acked snapshot → `mergeDays`). So a reorder
 * that leaves `hlc` alone is silently reverted by the very next merge — including a self-merge
 * of a snapshot the device produced itself. Making the new order ascend in `hlc` is what makes
 * it survive, WITHOUT touching the sort rule that four other synced domains share.
 *
 * Each row's stamp advances from `max(its own hlc, the previous row's new hlc)`, so the result
 * is strictly ascending across the array AND every row's new stamp is strictly greater than
 * THAT ROW's old stamp — which is what makes each reordered row beat its own pre-reorder copy
 * still sitting on the server, since the merge resolves per `id`. It is NOT true that every new
 * stamp beats every input stamp: when `physicalNow` is behind the rows' existing stamps (a peer
 * clock ahead of ours, or offline-ahead edits) the first row's new stamp can still sort below a
 * LATER row's input stamp. That is harmless — no merge ever compares those two. (String compare
 * is the HLC compare: `serialize` is fixed-width, see hlc.ts.)
 *
 * TOMBSTONES PASS THROUGH UNTOUCHED, in place. A tombstone's `hlc` is the causal position of
 * the DELETE — advancing it would let a reorder win a delete-vs-concurrent-edit race it did not
 * previously win. `mergeItems` sorts tombstones into their own trailing partition anyway, so
 * their position was never user-visible.
 *
 * CONVERGENCE is unchanged: this mints ordinary local stamps, so each row's merge winner is
 * still the HLC-max and the merge is still commutative + idempotent. Two devices reordering the
 * same day concurrently both land on the SAME array even though neither saw the other.
 *
 * They do not necessarily land on EITHER device's array. When the two reorders fall in different
 * milliseconds the later one wins wholesale, row for row. When they share a millisecond they also
 * share `pt`, and each device assigns `ct = 0,1,2…` down its OWN order — so the per-`id` maxima
 * interleave and the merged order can be a THIRD order that neither user asked for. Convergence
 * is what is guaranteed here, not "the later reorder wins": both devices agree, and the answer is
 * deterministic, but under a same-ms collision it may be neither device's order.
 *
 * @param rows the day's rows, ALREADY in the user's new order.
 * @param physicalNow injected ms-since-epoch.
 * @param actor this device's uid.
 */
export function reorderSyncStamps<R extends { rev?: number; hlc?: string; deleted?: boolean }>(
  rows: readonly R[],
  physicalNow: number,
  actor: string,
): R[] {
  let last: string | undefined;
  return rows.map((row) => {
    if (row.deleted === true) return row;
    const base = last === undefined || (row.hlc !== undefined && row.hlc > last) ? row.hlc : last;
    const stamp = nextSyncStamp({ rev: row.rev, hlc: base }, physicalNow, actor);
    last = stamp.hlc;
    return { ...row, ...stamp };
  });
}

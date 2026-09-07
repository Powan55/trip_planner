/**
 * Sync v2 — the `rev`/`hlc` stamping helper, PURE core.
 *
 * The ONE place that decides how a local edit advances an item's `rev` (monotonic per-item
 * revision), `hlc` (the merge CONFLICT key) and `ord` (the day ORDER key — split off `hlc` so
 * that advancing one does not move the row). It rides ALONGSIDE the existing
 * attribution stamping (`lib/attribution.ts` sets `createdBy`/`updatedBy`/`updatedAt`) —
 * this sets the sync ordering/version fields, keeping "one stamping concern, one module"
 * per side. Attribution stays in `lib/` (it takes a name source); the ordering stamp is pure
 * `core/` because it only needs an injected clock + uid.
 *
 * ── PURITY ─────────────────────────────────────────────────────────────
 * `physicalNow` (ms) and `actor` (uid) are INJECTED. No clock read, no firebase, no window.
 * Imports only the domain type and the pure HLC helpers. Testable in isolation.
 *
 * ── STORE INTEGRATION ──────────────────────────────────────────────────
 * `hooks/use-itinerary.ts` calls these helpers on create, update, delete and reorder.
 * Content edits advance `rev`/`hlc`; reorders advance only `ord`.
 *
 * ── DORMANT GATE ────────────────────────────────────────────────────────
 * The store's `syncEnabled()` delegates to `isTripRemoteConfigured()`: local mutations
 * stamp sync fields only when the active trip has remote sync configured. A no-Firebase
 * build or local-only sample pack skips this path; legacy `rev`/`hlc` defaults still belong
 * to the migration / `docToDayPlan` read boundary. These pure helpers do not own the gate.
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
 * AND FREEZES THE ROW'S POSITION. `mergeItems` orders a day by `ord ?? hlc`, so an edit that
 * advanced `hlc` alone — which it must, to win its own conflict resolve — also made the row the
 * day maximum and dropped it to the bottom. Pinning `ord` to the PRE-EDIT key keeps the sort
 * answer identical to what it was a moment before the edit. Every edit surface routes through
 * here (the done toggle, the item editor, cross-day move, the rename-and-claim pass), so one
 * freeze covers them all. Deliberately NOT pushed down into `nextSyncStamp`: expenses, docs,
 * places and the budget flattener share that primitive and have no user-visible order.
 *
 * A row that carries neither `ord` nor `hlc` gets no `ord` — there is nothing truthful to freeze
 * (`updatedAt` has already been rewritten to now by the attribution stamp that runs first), and
 * the merge's own `seedHlcFromLegacy` fallback still gives it a total-order key.
 *
 * @param item the item being edited (already merged with any patch + attribution).
 * @param physicalNow injected ms-since-epoch.
 * @param actor this device's uid.
 */
export function stampSyncUpdated(item: ItineraryItem, physicalNow: number, actor: string): ItineraryItem {
  const ord = item.ord ?? item.hlc;
  return { ...item, ...(ord ? { ord } : {}), ...nextSyncStamp(item, physicalNow, actor) };
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
 * Stamp a REORDER: re-stamp `rows` so their `ord`s ASCEND in the array order given.
 *
 * Array position is not a merge-visible fact. `mergeItems` re-sorts every merged row-set by
 * `ord ?? hlc` ascending, and that sort runs at BOTH sync boundaries (`pushDayMerged` →
 * `mergeDay(remoteNow, localDay)`, and the server-acked snapshot → `mergeDays`). So a reorder
 * that leaves the order key alone is silently reverted by the very next merge — including a
 * self-merge of a snapshot the device produced itself. Making the new order ascend in `ord` is
 * what makes it survive, WITHOUT touching the sort rule that four other synced domains share.
 *
 * `rev`/`hlc` ARE LEFT ALONE, and that is the point. Re-stamping `hlc` made every reordered row
 * win its own conflict resolve, and `resolvePair` picks a whole row — so a drag shipped the
 * dragging device's entire local snapshot over any peer edit that had not reached it yet, and a
 * peer's newer note or title was silently replaced by the copy the dragger happened to hold. A
 * drag now writes ONE field that no content edit reads, so it can no longer carry a body at all.
 * `resolvePair` joins `ord` separately from the body winner, which is what still lets the new
 * position land on top of a row whose content the peer wins.
 *
 * Each row's stamp advances from `max(its own ord ?? hlc, the previous row's new ord)`, so the
 * result is strictly ascending across the array AND every row's new stamp is strictly greater
 * than THAT ROW's old key — which is what makes each reordered row beat its own pre-reorder copy
 * still sitting on the server, since the merge resolves per `id`. It is NOT true that every new
 * stamp beats every input stamp: when `physicalNow` is behind the rows' existing stamps (a peer
 * clock ahead of ours, or offline-ahead edits) the first row's new stamp can still sort below a
 * LATER row's input stamp. That is harmless — no merge ever compares those two. (String compare
 * is the HLC compare: `serialize` is fixed-width, see hlc.ts.)
 *
 * TOMBSTONES PASS THROUGH UNTOUCHED, in place. `mergeItems` sorts tombstones into their own
 * trailing partition, so their position was never user-visible and there is nothing to express.
 *
 * CONVERGENCE is unchanged: this mints ordinary local stamps, so each row's `ord` is still an
 * HLC-max over a total order and the merge is still commutative + idempotent. Two devices
 * reordering the same day concurrently both land on the SAME array even though neither saw the
 * other.
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
export function reorderSyncStamps<R extends { hlc?: string; ord?: string; deleted?: boolean }>(
  rows: readonly R[],
  physicalNow: number,
  actor: string,
): R[] {
  let last: string | undefined;
  return rows.map((row) => {
    if (row.deleted === true) return row;
    const key = row.ord ?? row.hlc;
    const base = last === undefined || (key !== undefined && key > last) ? key : last;
    const ord = serialize(hlcSendOrLocal(base ? parse(base) : null, physicalNow, actor));
    last = ord;
    return { ...row, ord };
  });
}

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
 * ── PURITY ───────────────────────────────────────────────────────────────────
 * `physicalNow` (ms) and `actor` (uid) are INJECTED. No clock read, no firebase, no window.
 * Imports only the domain type and the pure HLC helpers. Testable in isolation.
 *
 * ── DORMANT-GATE ─────────────────────────────────────────────────────────────
 * `hlc` stamping is gated on the caller's `isRemoteConfigured()` — i.e.
 * only stamp `rev`/`hlc` on a local edit when remote sync is actually configured. Dormant
 * (no-Firebase) items then receive `rev`/`hlc` ONLY at the migration / `docToDayPlan`
 * defaulting boundary, so the dormant portfolio build stays byte-for-byte identical.
 * The helpers below are gate-agnostic (pure); the GATE is the caller's responsibility.
 */

import type { ItineraryItem } from '@/lib/trip-data';
import { hlcSendOrLocal, parse, serialize } from './hlc';

/**
 * Stamp a freshly-ADDED item's ordering fields (`addItem`):
 *   - `rev = 1` (first known revision), and
 *   - `hlc = hlcSendOrLocal(null, physicalNow, actor)` (a fresh stamp from this device).
 * Existing content fields and the attribution triple are untouched — this composes
 * with `stampCreated`, it does not replace it.
 *
 * @param item        the item being added (already attribution-stamped if applicable).
 * @param physicalNow injected ms-since-epoch (ClockPort.now().getTime()).
 * @param actor       this device's uid (anon-auth).
 */
export function stampSyncCreated(item: ItineraryItem, physicalNow: number, actor: string): ItineraryItem {
  return {
    ...item,
    rev: 1,
    hlc: serialize(hlcSendOrLocal(null, physicalNow, actor)),
  };
}

/**
 * Stamp a CONTENT EDIT's ordering fields (`updateItem` / cross-day
 * `moveItem`): bump `rev` and advance `hlc` from the item's PREVIOUS `hlc`:
 *   - `rev = (prev.rev ?? 1) + 1`, and
 *   - `hlc = hlcSendOrLocal(parse(prev.hlc) ?? null, physicalNow, actor)`.
 * The result's `hlc` is ALWAYS strictly greater than the previous (monotonic — hlc.ts).
 *
 * @param item        the item being edited (already merged with any patch + attribution).
 * @param physicalNow injected ms-since-epoch.
 * @param actor       this device's uid.
 */
export function stampSyncUpdated(item: ItineraryItem, physicalNow: number, actor: string): ItineraryItem {
  const last = item.hlc ? parse(item.hlc) : null;
  return {
    ...item,
    rev: (item.rev ?? 1) + 1,
    hlc: serialize(hlcSendOrLocal(last, physicalNow, actor)),
  };
}

/**
 * Stamp a DELETE as a tombstone (`removeItem`): a delete is now a content
 * event that must PROPAGATE and be ORDERED, so it does NOT physically remove the item — it
 * flips `deleted:true`, bumps `rev`, and advances `hlc`. The UI-exposed selector filters
 * `deleted` out downstream so the user still sees the item gone.
 *
 * @param item        the item being deleted.
 * @param physicalNow injected ms-since-epoch.
 * @param actor       this device's uid.
 */
export function stampSyncDeleted(item: ItineraryItem, physicalNow: number, actor: string): ItineraryItem {
  const last = item.hlc ? parse(item.hlc) : null;
  return {
    ...item,
    deleted: true,
    rev: (item.rev ?? 1) + 1,
    hlc: serialize(hlcSendOrLocal(last, physicalNow, actor)),
  };
}

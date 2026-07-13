'use client';

import { useCallback } from 'react';
import { DayPlan, ItineraryItem } from '@/lib/trip-data';
import { ITINERARY_STORAGE_KEY } from '@/lib/itinerary-storage';
import { getUserName } from '@/lib/identity';
import { getActiveTraveler } from '@/lib/token-auth';
import { isRemoteConfigured } from '@/lib/firebase-config';
import { clock } from '@/lib/trip-now';
import { stampCreated, stampUpdated } from '@/lib/attribution';
import { stampSyncCreated, stampSyncUpdated, stampSyncDeleted } from '@/core/sync/stamp';
import { itineraryStoragePort, itinerarySyncPort } from '@/lib/itinerary-ports';
import { createReactiveStore } from '@/hooks/create-reactive-store';
import { generateItemId } from '@/lib/item-id';
import * as itinerary from '@/core/itinerary';

/**
 * Shared reactive itinerary store.
 *
 * This hook owns the live `plans: DayPlan[]` and is the single read/write path for the
 * itinerary. It is a thin React adapter: the array-manipulation CRUD lives in the
 * framework-free `core/itinerary` (pure `DayPlan[]` transforms), persistence is expressed as
 * the `StoragePort` (production impl = the Vault gateway `loadPlans`/`savePlans`/
 * `hasStoredPlans`), and the local→remote fan-out is the `SyncPort` (production impl =
 * the lazy-gated `pushPlans`). This hook only owns React state + effects + the same-tab/
 * cross-tab event wiring + attribution stamping at the boundary. It does not re-implement or
 * alter the persistence contract (key-presence, never a length gate; always writes, incl.
 * `[]`) — those all live in the StoragePort impl.
 *
 * Reactivity (both layers, by design):
 *  - Every mutator writes via the StoragePort `save()` AND dispatches a same-tab
 *    `CustomEvent` (`ITINERARY_CHANGED_EVENT`) on `window`.
 *  - The hook listens for that CustomEvent (same-tab liveness)
 *    AND the cross-tab `storage` event, re-reading from the StoragePort on either.
 *
 * Instantiated once at the app root by `itinerary-provider.tsx`; consumers read the one
 * shared instance via `useItineraryContext()`. The raw hook is exported for the provider
 * and for tests.
 */

export const ITINERARY_CHANGED_EVENT = 'itinerary:changed';

export interface ItineraryStore {
  plans: DayPlan[];
  hydrated: boolean;
  addItem(date: string, item: ItineraryItem): void;
  updateItem(date: string, itemId: string, patch: Partial<ItineraryItem>): void;
  removeItem(date: string, itemId: string): void;
  restoreItem(date: string, item: ItineraryItem): void;
  clearDay(date: string): void;
  clearAll(): void;
  restoreDay(date: string, items: ItineraryItem[]): void;
  restorePlans(backup: DayPlan[]): void;
  moveItem(itemId: string, fromDate: string, toDate: string): void;
  deleteItems(targets: Array<{ date: string; itemId: string }>): void;
  moveItems(targets: Array<{ itemId: string; fromDate: string }>, toDate: string): void;
  copyDay(srcDate: string, dstDate: string): void;
  reorderItems(date: string, orderedIds: string[]): void;
  getDayPlan(date: string): DayPlan;
  findPlacements(sourceId: string): Array<{ date: string; item: ItineraryItem }>;
}

// Cross-friend attribution stamping lives in lib/attribution.ts —
// a single named, unit-testable place. The mutators below pass bound `stampCreated` /
// `stampUpdated` closures (name source = `getUserName`) into the pure core, so:
//   - stamping fires only when a name is set (dormant / no-name ⇒ fields stay undefined,
//     items stay valid);
//   - it runs only in these local mutators (at the adapter boundary), so the snapshot-ingest
//     path (which writes via savePlans() directly) preserves a remote author's attribution
//     (echo-suppression). Keeping the identity read here — not in core — is what lets
//     `core/itinerary` stay pure while the attribution behavior is byte-identical.

// ── Sync v2 rev/hlc stamping ──────────────────────────
// The mutators additionally stamp the two ordering fields via the pure `core/sync/stamp`
// helpers — riding alongside attribution stamping (no duplication). These take an
// injected `physicalNow` (ClockPort) and `actor`, so they stay pure/testable and
// never import firebase.
//
// ── The dormant-build byte-identity guarantee (the biggest risk here) ───────────────────────
// Stamping rev/hlc — and, critically, turning `removeItem` into a tombstone — changes
// localStorage bytes. Doing that unconditionally would break the dormant portfolio build's
// byte-identity and risk the delete-all-stays-empty guarantee (a tombstone
// must not leave `plans` non-empty). So the entire sync-v2 behavior is gated on
// `isRemoteConfigured()`:
//   - Dormant (no firebase env): `syncEnabled()` is false. `removeItem` physically removes
//     exactly as today, and no rev/hlc is stamped. The dormant build is byte-for-byte
//     unchanged; the persistence pack + the delete-all-stays-empty guarantee hold verbatim.
//   - Configured (sync on): the tombstone + rev/hlc path activates, and the exposed `plans`
//     selector filters `deleted` items so the UI still shows a normal delete.
// The `actor` is sourced synchronously and firebase-free from the active traveler token
// (`getActiveTraveler().name` — Powan/Sushil/Uttam, distinct per friend),
// falling back to the display name, then ''. The anon-auth uid would be strictly better as
// the actor but is only available async inside the remote handle; the per-friend token is a
// stable, synchronous, dormant-safe id sufficient for the HLC tie-break (distinct across the
// three clients). Recorded here as a deliberate judgment call.
function syncEnabled(): boolean {
  return isRemoteConfigured();
}

function syncActor(): string {
  return getActiveTraveler()?.name ?? getUserName() ?? '';
}

// A fresh-id copy of an item's content: strip the per-placement identity and all sync
// ordering fields (`id`/`deleted`/`rev`/`hlc`) and mint a new `id`, keeping `sourceId`
// and everything else. Used by both the sync-on `moveItem` target step and the sync-on
// `restoreItem` (undo-of-delete) — the tombstone-source + fresh-id pattern. A fresh
// id is what lets the copy coexist with the source's own tombstone without colliding, and
// sidesteps `resolvePair`'s HLC-tie tombstone bias (merge-day.ts:79) entirely.
//
// Exported for the duplicate-item feature: the "same dinner, another day" UI builds its copy with
// this exact stripper (no divergent hand-rolled one) then hands it to `addItem`, so a
// duplicate is byte-for-byte the same fresh-id-copy mechanics as a sync-on move target —
// always a new id, never the source id.
export function freshCopyOf(item: ItineraryItem): ItineraryItem {
  const { id: _id, deleted: _deleted, rev: _rev, hlc: _hlc, ...content } = item;
  return { ...content, id: generateItemId() } as ItineraryItem;
}

// The shared hydrate/listen/commit skeleton, instantiated once for the itinerary
// domain. This is the one synced domain, so it passes its existing remote as the factory's
// optional `sync?` seam: the factory's commit tail fires `itinerarySyncPort.push(prev, next)`
// fire-and-forget AFTER the local save + dispatch, byte-for-byte the former inline push.
// The push self-gates on `isRemoteConfigured()` behind a dynamic import, so the dormant build
// still pulls no firebase onto the hot path; echo-suppression (push only from
// commit, never the snapshot path) is unchanged. The StoragePort impl owns the
// key-presence / []-survives / quarantine contract — the factory is agnostic (it reads the
// freshest base via `load()`, so chained mutations in one handler compose).
const useItineraryStore = createReactiveStore<DayPlan[]>({
  eventName: ITINERARY_CHANGED_EVENT,
  storageKeys: [ITINERARY_STORAGE_KEY],
  storage: itineraryStoragePort,
  sync: itinerarySyncPort,
});

export function useItinerary(): ItineraryStore {
  // `plans` here is the raw persisted value (tombstones included under sync); the exposed value
  // is filtered by `visiblePlans` below. `commit` is the factory's single write
  // choke-point (fresh-base compute, push-from-commit).
  const { value: plans, hydrated, commit } = useItineraryStore();

  const addItem = useCallback(
    (date: string, item: ItineraryItem) => {
      // Stamp createdBy/updatedBy/updatedAt from the identity module at the
      // boundary — no-op when no name is set — then, when sync is on (gated), stamp
      // rev=1/hlc via the pure core helper. Both ride on the same merged item; the
      // core applies the composed stamper, so the pure append stays pure.
      commit((current) =>
        itinerary.addItem(current, date, item, (i) => {
          const attributed = stampCreated(i, getUserName);
          return syncEnabled()
            ? stampSyncCreated(attributed, clock.now().getTime(), syncActor())
            : attributed;
        }),
      );
    },
    [commit],
  );

  const updateItem = useCallback(
    (date: string, itemId: string, patch: Partial<ItineraryItem>) => {
      // A content edit stamps updatedBy/updatedAt and, when sync is on (gated),
      // bumps rev + advances hlc from the item's previous hlc. The core stamps the
      // merged item via the injected stamper; no-op attribution when no name is set.
      commit((current) =>
        itinerary.updateItem(current, date, itemId, patch, (i) => {
          const attributed = stampUpdated(i, getUserName);
          return syncEnabled()
            ? stampSyncUpdated(attributed, clock.now().getTime(), syncActor())
            : attributed;
        }),
      );
    },
    [commit],
  );

  const removeItem = useCallback(
    (date: string, itemId: string) => {
      // Dormant (sync off): physically remove exactly as today — the dormant build
      // stays byte-for-byte identical and the delete-all-stays-empty guarantee holds verbatim.
      // With sync on: a delete is a content event that must propagate and win, so instead of
      // removing we write a tombstone (deleted:true, rev+1, hlc advanced) via
      // updateItem's edit path. The exposed `plans` selector filters `deleted` items, so the
      // UI still shows the item gone (zero consumer edits); the
      // tombstone persists beneath to propagate the delete.
      if (!syncEnabled()) {
        commit((current) => itinerary.removeItem(current, date, itemId));
        return;
      }
      commit((current) =>
        itinerary.updateItem(current, date, itemId, {}, (i) =>
          stampSyncDeleted(stampUpdated(i, getUserName), clock.now().getTime(), syncActor()),
        ),
      );
    },
    [commit],
  );

  // Undo of a delete. The caller captured the removed item and calls this to put it
  // back. `removeItem` was unchanged — it already did the right thing per mode — so restore
  // is the mirror image, gated the same way:
  //  - Dormant: the delete physically removed the item, so restore is a plain same-id re-add
  //    via addItem (byte-identical; no stamping fires when no name is set).
  //  - With sync on: the delete left a tombstone (removeItem's sync path). A same-id re-add would be
  //    silently re-killed by resolvePair's tombstone bias on an HLC tie (merge-day.ts:79), so we
  //    restore a fresh-id copy into the same day — the exact mechanics as moveItem part (b):
  //    fresh createdBy + rev=1 + fresh hlc, same sourceId; it can never collide with the tombstone,
  //    and the original tombstone still propagates the delete to peers. Reuses `addItem` (its sync
  //    path already stamps stampSyncCreated(stampCreated(...))), so there is one stamping code path.
  const restoreItem = useCallback(
    (date: string, item: ItineraryItem) => {
      addItem(date, syncEnabled() ? freshCopyOf(item) : item);
    },
    [addItem],
  );

  // Clear a whole day in one operation. Same mode-gating as removeItem:
  //  - Dormant: physically empty the day via the pure core clearDay — byte-identical, no
  //    stamping; the cleared day is a legitimate empty state that never reseeds.
  //  - With sync on: a clear is N deletes that must propagate and win, so we tombstone every live
  //    item on the day inside one commit() — the same stamp removeItem's sync path applies,
  //    folded over the day's live ids. One commit means pushPlans diffs one changed day, one
  //    per-day doc write (keeping writes within the Firestore free-tier quota), not N writes. Existing tombstones are left as-is.
  const clearDay = useCallback(
    (date: string) => {
      if (!syncEnabled()) {
        commit((current) => itinerary.clearDay(current, date));
        return;
      }
      commit((current) => {
        const day = current.find((p) => p.date === date);
        const liveIds = (day?.items ?? []).filter((i) => i.deleted !== true).map((i) => i.id);
        // Fold the removeItem sync-path stamp over every live id — one accumulated commit.
        return liveIds.reduce(
          (acc, id) =>
            itinerary.updateItem(acc, date, id, {}, (i) =>
              stampSyncDeleted(stampUpdated(i, getUserName), clock.now().getTime(), syncActor()),
            ),
          current,
        );
      });
    },
    [commit],
  );

  // Clear the entire itinerary in one operation (the settings page "clear all"). Same
  // mode-gating as clearDay, folded over every day:
  //  - Dormant: physically empty every day's items — a byte-identical local wipe, no stamping;
  //    the emptied days are legit empty states that never reseed (the key stays present).
  //  - With sync on: tombstone every live item across every day inside one commit() — the same stamp
  //    clearDay/removeItem apply, folded over the whole trip (identical to restorePlans step (a)).
  //    One commit means pushPlans diffs the changed days, per-day writes, and each tombstone
  //    propagates and wins over a peer's still-live copy, so the clear survives the next snapshot —
  //    not a blind local wipe that the union-merge would unwind.
  const clearAll = useCallback(() => {
    if (!syncEnabled()) {
      commit((current) => current.map((d) => ({ ...d, items: [] })));
      return;
    }
    const actor = syncActor();
    commit((current) => {
      let next = current;
      for (const day of current) {
        for (const it of day.items) {
          if (it.deleted === true) continue;
          next = itinerary.updateItem(next, day.date, it.id, {}, (i) =>
            stampSyncDeleted(stampUpdated(i, getUserName), clock.now().getTime(), actor),
          );
        }
      }
      return next;
    });
  }, [commit]);

  // Undo of a clear — restore the full captured live list in one commit. Per item this
  // is the restoreItem mechanic (fresh-id under sync via freshCopyOf + addItem's sync-path
  // stamp so it survives the tombstone bias; same-id under dormant), folded so the whole day
  // comes back in a single write. The captured list is the day's exposed (live) items at clear
  // time, so re-adding them exactly reverses the tombstone-all.
  const restoreDay = useCallback(
    (date: string, items: ItineraryItem[]) => {
      if (items.length === 0) return;
      const sync = syncEnabled();
      commit((current) =>
        items.reduce(
          (acc, item) =>
            itinerary.addItem(acc, date, sync ? freshCopyOf(item) : item, (i) => {
              const attributed = stampCreated(i, getUserName);
              return sync
                ? stampSyncCreated(attributed, clock.now().getTime(), syncActor())
                : attributed;
            }),
          current,
        ),
      );
    },
    [commit],
  );

  // Whole-trip restore from a backup. The backup was already
  // parsed and trust-validated by `parseBackup` (same schema as an import); this expresses applying it
  // as a merge, not an overwrite, so under sync it propagates and survives the next snapshot instead of
  // being unwound (the reason a plain overwrite was disabled for the sync case).
  //  - Dormant (sync off): a plain local overwrite — there is no sync to unwind, so this is
  //    byte-identical to `importItinerary`'s `savePlans(backup)` (one commit, no stamping, no push).
  //  - With sync on: a tombstone-replace in one commit, applying the tombstone-and-fresh-id
  //    mechanic to a whole restore:
  //      (a) tombstone every currently-live item across every day (removeItem's sync stamp), so each
  //          removal propagates and wins over a peer's still-live copy (a backup with an
  //          empty day therefore leaves that day empty — the items are tombstoned, none re-added);
  //      (b) add every backup item as a fresh-id copy (freshCopyOf + addItem's sync stamp),
  //          so a restored item can never lose to an existing tombstone on an HLC tie, and a
  //          concurrent peer edit that is strictly later still survives the next merge (not a blind
  //          clobber). A backup tombstone is skipped (not re-added live).
  //    One commit means pushPlans diffs the changed days, per-day writes via the normal outbox/commit
  //    fan-out (traveler-gated) — the restore syncs.
  const restorePlans = useCallback(
    (backup: DayPlan[]) => {
      if (!syncEnabled()) {
        commit(() => backup);
        return;
      }
      const actor = syncActor();
      commit((current) => {
        // (a) Tombstone every live item on every current day (raw base — tombstones already dead
        // are left as-is; gcTombstones prunes them past the 30-day horizon).
        let next = current;
        for (const day of current) {
          for (const it of day.items) {
            if (it.deleted === true) continue;
            next = itinerary.updateItem(next, day.date, it.id, {}, (i) =>
              stampSyncDeleted(stampUpdated(i, getUserName), clock.now().getTime(), actor),
            );
          }
        }
        // (b) Add a fresh-id copy of every LIVE backup item onto its day (freshCopyOf strips
        // id/deleted/rev/hlc + mints a new id; addItem synthesizes the day if absent).
        for (const day of backup) {
          for (const it of day.items) {
            if (it.deleted === true) continue;
            next = itinerary.addItem(next, day.date, freshCopyOf(it), (i) =>
              stampSyncCreated(stampCreated(i, getUserName), clock.now().getTime(), actor),
            );
          }
        }
        return next;
      });
    },
    [commit],
  );

  // Move an item between days (drag-between-days semantics).
  //
  // Dormant (sync off): a physical move — remove from source, append to target — exactly
  // as before, byte-identical. A cross-day move is a content edit → stamp updatedBy/
  // updatedAt on the moved item (no-op when no name set); createdBy preserved (first author wins).
  //
  // With sync on: a physical remove from the source day leaves no tombstone, so the sync-v2
  // union-merge (pushDayMerged / snapshot mergeDays) resurrects the source copy — the item ends up
  // live on both days for everyone. So under sync a move is, in one commit, the same mechanics as
  // the dialog's cross-day date-change: (a) tombstone the source copy (deleted:true, rev+1,
  // hlc advanced — identical to removeItem's sync path), then (b) add a fresh-id copy of the item
  // to the target day (identical to addItem's sync path: fresh createdBy + rev=1 + fresh hlc, same
  // `sourceId` carried so findPlacements follows the move). The fresh id is required so a later
  // move-back can't collide with this item's own tombstone on the origin day.
  const moveItem = useCallback(
    (itemId: string, fromDate: string, toDate: string) => {
      if (!syncEnabled()) {
        commit((current) =>
          itinerary.moveItem(current, itemId, fromDate, toDate, (i) =>
            stampUpdated(i, getUserName),
          ),
        );
        return;
      }
      // Sync on: tombstone-source + fresh-id-target, one atomic commit against freshest state.
      commit((current) => {
        if (fromDate === toDate) return current; // same-day: no-op (matches core moveItem)
        const source = current.find((p) => p.date === fromDate);
        const original = (source?.items ?? []).find((i) => i.id === itemId);
        if (!original) return current; // nothing to move (guard, matches core moveItem)

        // (a) Tombstone the source copy — IDENTICAL to removeItem's sync path.
        const tombstoned = itinerary.updateItem(current, fromDate, itemId, {}, (i) =>
          stampSyncDeleted(stampUpdated(i, getUserName), clock.now().getTime(), syncActor()),
        );

        // (b) Add a FRESH-ID copy to the target — IDENTICAL to addItem's sync path. Carry the
        // item's content (incl. sourceId/sourceType/done/notes…) but a NEW id, and let the
        // stampers set fresh createdBy + rev=1 + fresh hlc; drop any inherited tombstone/rev/hlc.
        const freshCopy = freshCopyOf(original);
        return itinerary.addItem(tombstoned, toDate, freshCopy, (i) =>
          stampSyncCreated(stampCreated(i, getUserName), clock.now().getTime(), syncActor()),
        );
      });
    },
    [commit],
  );

  // ── Bulk ops — each is one commit(), the same mode-gated stamping as its
  // single-item sibling folded over the selection, so one commit means pushPlans diffs a few
  // changed days, few per-day doc writes, never N commits. ────────────────────────

  // Bulk delete a set of items (multi-select). Same mode-gating as removeItem:
  //  - Dormant: physically remove every target via the pure core deleteItems (fold of
  //    removeItem) — byte-identical, no stamping; an emptied day is a legit empty state.
  //  - With sync on: tombstone every selected item in one commit — the same stamp removeItem's sync
  //    path applies, folded over the selection (identical mechanic to clearDay, but a subset).
  const deleteItems = useCallback(
    (targets: Array<{ date: string; itemId: string }>) => {
      if (targets.length === 0) return;
      if (!syncEnabled()) {
        commit((current) => itinerary.deleteItems(current, targets));
        return;
      }
      commit((current) =>
        targets.reduce(
          (acc, { date, itemId }) =>
            itinerary.updateItem(acc, date, itemId, {}, (i) =>
              stampSyncDeleted(stampUpdated(i, getUserName), clock.now().getTime(), syncActor()),
            ),
          current,
        ),
      );
    },
    [commit],
  );

  // Bulk move a set of items to `toDate` (multi-select move-to-day). Same mode-gating as
  // moveItem, folded over the selection in one commit:
  //  - Dormant: physical move via the pure core moveItems (fold of moveItem) — remove from
  //    source, append to target, same ids; stamp updatedBy (no-op when no name set).
  //  - With sync on: per item, tombstone-source + fresh-id-target — identical to the single
  //    moveItem sync path, accumulated so all moves land in one write. The fresh id is required
  //    so the moved copy can never collide with its own source tombstone.
  const moveItems = useCallback(
    (targets: Array<{ itemId: string; fromDate: string }>, toDate: string) => {
      if (targets.length === 0) return;
      if (!syncEnabled()) {
        commit((current) =>
          itinerary.moveItems(current, targets, toDate, (i) => stampUpdated(i, getUserName)),
        );
        return;
      }
      commit((current) =>
        targets.reduce((acc, { itemId, fromDate }) => {
          if (fromDate === toDate) return acc; // same-day: no-op (matches core moveItem)
          const source = acc.find((p) => p.date === fromDate);
          const original = (source?.items ?? []).find((i) => i.id === itemId);
          if (!original) return acc; // nothing to move (guard, matches core moveItem)
          const tombstoned = itinerary.updateItem(acc, fromDate, itemId, {}, (i) =>
            stampSyncDeleted(stampUpdated(i, getUserName), clock.now().getTime(), syncActor()),
          );
          return itinerary.addItem(tombstoned, toDate, freshCopyOf(original), (i) =>
            stampSyncCreated(stampCreated(i, getUserName), clock.now().getTime(), syncActor()),
          );
        }, current),
      );
    },
    [commit],
  );

  // Copy a whole day's live items onto `dstDate` (copy-day). Every copy is a fresh-id copy of
  // the source item's content (freshCopyOf, reused — never a hand-rolled stripper), so a copy
  // never reuses a source id, in both modes (a same-id copy would collide with the source, and
  // under sync would be re-killed by the tombstone bias). One commit via the pure core copyDay
  // (fold of addItem): dormant stamps attribution only; sync additionally stamps rev=1/hlc —
  // the same stamper addItem's sync path uses, so there is one stamping code path.
  const copyDay = useCallback(
    (srcDate: string, dstDate: string) => {
      const sync = syncEnabled();
      commit((current) =>
        itinerary.copyDay(current, srcDate, dstDate, freshCopyOf, (i) => {
          const attributed = stampCreated(i, getUserName);
          return sync
            ? stampSyncCreated(attributed, clock.now().getTime(), syncActor())
            : attributed;
        }),
      );
    },
    [commit],
  );

  const reorderItems = useCallback(
    (date: string, orderedIds: string[]) => {
      // `orderedIds` comes from the UI, which only ever sees live items (the tombstone
      // filter). Core `reorderItems` drops any item not listed — so, when sync is on, we
      // must append this day's tombstone ids so the reorder does not silently drop pending
      // deletes (which would stop them propagating). Reorder is order-only: it does not bump
      // rev/hlc — the tombstones keep their existing stamps and simply trail the live
      // items (they are excluded from the exposed order anyway). Dormant: no tombstones
      // exist, so this is byte-identical to before.
      commit((current) => {
        let ids = orderedIds;
        if (syncEnabled()) {
          const day = current.find((p) => p.date === date);
          const tombstoneIds = (day?.items ?? [])
            .filter((i) => i.deleted === true && !orderedIds.includes(i.id))
            .map((i) => i.id);
          if (tombstoneIds.length > 0) ids = [...orderedIds, ...tombstoneIds];
        }
        return itinerary.reorderItems(current, date, ids);
      });
    },
    [commit],
  );

  // ── The exposed-`plans` tombstone filter ──────────────────
  // The merge sees tombstones; the UI does not. The internal `plans` state (and the
  // persisted localStorage layer beneath it) retain `deleted:true` items so a delete can
  // propagate and win over a concurrent edit. The value handed to consumers — and every
  // selector below — is filtered to `!deleted` items only, so the calendar, dashboard,
  // timeline, findPlacements, and every card render live items exactly as before, with zero
  // consumer edits. Dormant items
  // never carry `deleted` (physical remove, gated), so `visiblePlans === plans` byte-for-byte
  // in the dormant build; the filter only ever removes anything when sync is on.
  const visiblePlans = useCallback(
    (source: DayPlan[]): DayPlan[] =>
      source.map((d) => ({ ...d, items: d.items.filter((it) => it.deleted !== true) })),
    [],
  );
  const exposedPlans = visiblePlans(plans);

  // Selectors (pure, derived from the exposed/filtered plans — delegated to core).
  const getDayPlan = useCallback(
    (date: string): DayPlan => itinerary.getDayPlan(exposedPlans, date),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plans],
  );

  const findPlacements = useCallback(
    (sourceId: string): Array<{ date: string; item: ItineraryItem }> =>
      itinerary.findPlacements(exposedPlans, sourceId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plans],
  );

  return {
    plans: exposedPlans,
    hydrated,
    addItem,
    updateItem,
    removeItem,
    restoreItem,
    clearDay,
    clearAll,
    restoreDay,
    restorePlans,
    moveItem,
    deleteItems,
    moveItems,
    copyDay,
    reorderItems,
    getDayPlan,
    findPlacements,
  };
}

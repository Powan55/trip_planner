'use client';

import { useCallback } from 'react';
import { DayPlan, ItineraryItem } from '@/lib/trip-data';
import { keyFor } from '@/core/storage/gateway';
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
 * This hook owns the live `plans: DayPlan[]` and is the SINGLE read/write path for the
 * itinerary. As of it is a THIN React adapter: the array-manipulation CRUD lives in the
 * framework-free `core/itinerary` (pure `DayPlan[]` transforms), persistence is expressed as
 * the `StoragePort` (production impl = the Vault gateway `loadPlans`/`savePlans`/
 * `hasStoredPlans`), and the local→remote fan-out is the `SyncPort` (production impl =
 * the lazy-gated `pushPlans`). This hook only owns React state + effects + the same-tab/
 * cross-tab event wiring + attribution stamping at the boundary. It does NOT re-implement or
 * alter the persistence contract (key-presence, never a length gate; always writes, incl.
 * `[]`) — those all live in the StoragePort impl.
 *
 * Reactivity:
 * - Every mutator writes via the StoragePort `save()` AND dispatches a same-tab
 * `CustomEvent` (`ITINERARY_CHANGED_EVENT`) on `window`.
 * - The hook listens for that CustomEvent
 * AND the cross-tab `storage` event, re-reading from the StoragePort on either.
 *
 * Instantiated ONCE at the app root by `itinerary-provider.tsx`; consumers read the one
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
// `stampUpdated` closures (name source = `getUserName`) INTO the pure core, so:
// - stamping fires ONLY when a name is set (dormant / no-name ⇒ fields stay undefined,
// items valid — holds);
// - it runs ONLY in these local mutators (at the adapter boundary), so the snapshot-ingest
// path (which writes via savePlans() directly) PRESERVES a remote author's attribution
// Keeping the identity read here — not in core — is what lets
// `core/itinerary` stay pure while the behavior is byte-identical.

// ── Sync v2 rev/hlc stamping ──────────────────────────
// The mutators additionally stamp the two NEW ordering fields via the pure `core/sync/stamp`
// helpers — riding ALONGSIDE attribution. These take an
// injected `physicalNow` and `actor`, so they stay pure/testable and
// never import firebase.
//
// ── THE DORMANT-BUILD BYTE-IDENTITY GATE ───────────────────────
// Stamping rev/hlc — and, critically, turning `removeItem` into a tombstone — CHANGES
// localStorage bytes. Doing that unconditionally would break the dormant portfolio build's
// byte-identity and risk the delete-all-stays-empty guarantee (a tombstone
// must not leave `plans` non-empty). So the ENTIRE Sync-v2 behavior is GATED on
// `isRemoteConfigured()`:
// - DORMANT (no firebase env): `syncEnabled()` is false. `removeItem` physically removes
// exactly as today, and NO rev/hlc is stamped. The dormant build is byte-for-byte
// unchanged; the persistence pack + hold verbatim.
// - CONFIGURED (sync on): the tombstone + rev/hlc path activates, and the exposed `plans`
// selector filters `deleted` items so the UI still shows a normal delete.
// The `actor` is sourced synchronously + firebase-free from the active traveler token
// (`getActiveTraveler().name` — Powan/Sushil/Uttam, distinct per friend, spirit),
// falling back to the display name, then ''. The anon-auth uid would be strictly-better as
// the actor but is only available async inside the remote handle; the per-friend token is a
// stable, synchronous, dormant-safe id sufficient for the HLC tie-break (distinct across the
// three clients). Recorded as a judgment call for.
function syncEnabled(): boolean {
  return isRemoteConfigured();
}

function syncActor(): string {
  return getActiveTraveler()?.name ?? getUserName() ?? '';
}

// A FRESH-ID copy of an item's CONTENT: strip the per-placement identity and all sync
// ordering fields (`id`/`deleted`/`rev`/`hlc`) and mint a new `id`, keeping `sourceId`
// and everything else. Used by BOTH the sync-on `moveItem` target step AND the sync-on
// `restoreItem` (undo-of-delete) — the tombstone-source + fresh-id pattern. A fresh
// id is what lets the copy coexist with the source's own tombstone without colliding, and
// sidesteps `resolvePair`'s HLC-tie tombstone bias (merge-day.ts:79) entirely.
//
// EXPORTED for duplicate-item: the "same dinner, another day" UI builds its copy with
// THIS exact stripper (no divergent hand-rolled one) then hands it to `addItem`, so a
// duplicate is byte-for-byte the same fresh-id-copy mechanics as a sync-on move target —
// always a new id, never the source id.
export function freshCopyOf(item: ItineraryItem): ItineraryItem {
  const { id: _id, deleted: _deleted, rev: _rev, hlc: _hlc, ...content } = item;
  return { ...content, id: generateItemId() } as ItineraryItem;
}

// The shared hydrate/listen/commit skeleton, instantiated once for the itinerary
// domain. This is the ONE synced domain, so it passes its EXISTING remote as the factory's
// optional `sync?` seam: the factory's commit tail fires `itinerarySyncPort.push(prev, next)`
// fire-and-forget AFTER the local save + dispatch, byte-for-byte the former inline push.
// The push self-gates on `isRemoteConfigured()` behind a dynamic import, so the dormant build
// still pulls no firebase onto the hot path; echo-suppression (push only from
// commit, never the snapshot path) is unchanged. The StoragePort impl owns the
// key-presence / []-survives / quarantine contract — the factory is agnostic ( reads the
// freshest base via `load()`, so chained mutations in one handler compose).
const useItineraryStore = createReactiveStore<DayPlan[]>({
  eventName: ITINERARY_CHANGED_EVENT,
  // the itinerary Vault is trip-scoped, so its on-disk key depends on the
  // ACTIVE pack — `keyFor('itinerary')` is the default literal on the grandfathered pack
  // (byte-identical cross-tab behavior) and `trip:{id}:itinerary` on any other pack. Pass it
  // as a function so the cross-tab `storage` match reads the live pack key, closing the
  // non-default-pack cross-tab gap flagged (same-tab reactivity already worked via the
  // CustomEvent). Read per event, never cached — the pack only changes across a full reload.
  storageKeys: () => [keyFor('itinerary')],
  storage: itineraryStoragePort,
  sync: itinerarySyncPort,
});

export function useItinerary(): ItineraryStore {
  // `plans` here is the RAW persisted value (tombstones INCLUDED under sync); the exposed value
  // is filtered by `visiblePlans` below. `commit` is the factory's single write
  // choke-point.
  const { value: plans, hydrated, commit } = useItineraryStore();

  const addItem = useCallback(
    (date: string, item: ItineraryItem) => {
      // Stamp createdBy/updatedBy/updatedAt from the identity module at the
      // boundary — no-op when no name is set — then, when sync is on, stamp
      // rev=1/hlc via the pure core helper. Both ride on the same MERGED item; the
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
      // bumps rev + advances hlc from the item's PREVIOUS hlc. The core stamps the
      // MERGED item via the injected stamper; no-op attribution when no name is set.
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
      // DORMANT: physically remove exactly as today — the dormant build
      // stays byte-for-byte identical and delete-all-stays-empty holds verbatim.
      // SYNC ON: a delete is a content event that must PROPAGATE + win, so instead of
      // removing we write a TOMBSTONE via
      // updateItem's edit path. The exposed `plans` selector filters `deleted` items, so the
      // UI still shows the item gone; the
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
  // back. `removeItem` was UNCHANGED — it already did the right thing per mode — so restore
  // is the mirror image, gated the same way:
  // - DORMANT: the delete PHYSICALLY removed the item, so restore is a plain SAME-ID re-add
  // via addItem.
  // - SYNC ON: the delete left a TOMBSTONE (removeItem's sync path). A same-id re-add would be
  // SILENTLY RE-KILLED by resolvePair's tombstone bias on an HLC tie (merge-day.ts:79), so we
  // restore a FRESH-ID copy into the same day — the exact mechanics as moveItem part (b):
  // fresh createdBy + rev=1 + fresh hlc, same sourceId; it can never collide with the tombstone,
  // and the original tombstone still propagates the delete to peers. Reuses `addItem` (its sync
  // path already stamps stampSyncCreated(stampCreated(...))), so there is ONE stamping code path.
  const restoreItem = useCallback(
    (date: string, item: ItineraryItem) => {
      addItem(date, syncEnabled() ? freshCopyOf(item) : item);
    },
    [addItem],
  );

  // Clear a WHOLE day in one operation. Same mode-gating as removeItem:
  // - DORMANT: physically empty the day via the pure core clearDay — byte-identical, no
  // stamping; the cleared day is a legitimate empty state that never reseeds.
  // - SYNC ON: a clear is N deletes that must PROPAGATE + win, so we TOMBSTONE every LIVE
  // item on the day inside ONE commit() — the SAME stamp removeItem's sync path applies,
  // folded over the day's live ids. One commit ⇒ pushPlans diffs one changed day ⇒ ONE
  // per-day doc write, not N writes. Existing tombstones are left as-is.
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

  // Clear the ENTIRE itinerary in ONE operation. Same
  // mode-gating as clearDay, folded over EVERY day:
  // - DORMANT: physically empty every day's items — a byte-identical local wipe, no stamping;
  // the emptied days are legit empty states that never reseed (the key stays present).
  // - SYNC ON: tombstone EVERY live item across EVERY day inside ONE commit() — the SAME stamp
  // clearDay/removeItem apply, folded over the whole trip (identical to restorePlans step (a)).
  // One commit ⇒ pushPlans diffs the changed days ⇒ per-day writes, and each tombstone
  // PROPAGATES + wins over a peer's still-live copy, so the clear survives the next snapshot —
  // NOT a blind local wipe that the union-merge would unwind.
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

  // Undo of a clear — restore the FULL captured live list in ONE commit. Per item this
  // is the restoreItem mechanic (fresh-id under sync via freshCopyOf + addItem's sync-path
  // stamp so it survives the tombstone bias; same-id under dormant), folded so the whole day
  // comes back in a single write. The captured list is the day's EXPOSED (live) items at clear
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

  // Whole-trip RESTORE from a backup. The backup was already
  // parsed + trust-validated by `parseBackup` (SAME schema as an import); this expresses applying it
  // as a MERGE, not an overwrite, so under sync it PROPAGATES + survives the next snapshot instead of
  // being unwound.
  // - DORMANT: a plain local overwrite — there is no sync to unwind, so this is
  // byte-identical to `importItinerary`'s `savePlans(backup)` (one commit, no stamping, no push).
  // - SYNC ON: a tombstone-replace in ONE commit (, the mechanic applied to a
  // whole restore):
  // (a) TOMBSTONE every currently-live item across every day (removeItem's sync stamp), so each
  // removal PROPAGATES + wins over a peer's still-live copy (: a backup with an
  // empty day therefore leaves that day empty — the items are tombstoned, none re-added);
  // (b) ADD every backup item as a FRESH-ID copy (freshCopyOf + addItem's sync stamp —/
  //), so a restored item can NEVER lose to an existing tombstone on an HLC tie, and a
  // concurrent peer edit that is STRICTLY-LATER still survives the next merge (not a blind
  // clobber). A backup tombstone is skipped (not re-added live).
  // One commit ⇒ pushPlans diffs the changed days ⇒ per-day writes via the normal outbox/commit
  // fan-out — the restore syncs.
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
  // DORMANT: a physical move — remove from source, append to target — exactly
  // as before, BYTE-IDENTICAL. A cross-day move IS a content edit → stamp updatedBy/
  // updatedAt on the moved item (no-op when no name set); createdBy preserved (first author wins).
  //
  // SYNC ON: a physical remove from the source day leaves NO tombstone, so the Sync-v2
  // union-merge (pushDayMerged / snapshot mergeDays) resurrects the source copy — the item ends up
  // live on BOTH days for everyone. So under sync a move is, in ONE commit, the SAME mechanics as
  // the dialog's cross-day date-change: (a) TOMBSTONE the source copy (deleted:true, rev+1,
  // hlc advanced — identical to removeItem's sync path), then (b) ADD a FRESH-ID copy of the item
  // to the target day (identical to addItem's sync path: fresh createdBy + rev=1 + fresh hlc, same
  // `sourceId` carried so findPlacements follows the move). The fresh id is REQUIRED so a later
  // move-BACK can't collide with this item's own tombstone on the origin day.
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

  // ── Bulk ops — each is ONE commit(), the same mode-gated stamping as its
  // single-item sibling FOLDED over the selection, so one commit ⇒ pushPlans diffs a few
  // changed days ⇒ few per-day doc writes, never N commits. ────────────────────────

  // Bulk delete a SET of items (multi-select). Same mode-gating as removeItem:
  // - DORMANT: physically remove every target via the pure core deleteItems (fold of
  // removeItem) — byte-identical, no stamping; an emptied day is a legit empty state.
  // - SYNC ON: tombstone every selected item in ONE commit — the SAME stamp removeItem's sync
  // path applies, folded over the selection (identical mechanic to clearDay, but a subset).
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

  // Bulk move a SET of items to `toDate` (multi-select move-to-day). Same mode-gating as
  // moveItem, folded over the selection in ONE commit:
  // - DORMANT: physical move via the pure core moveItems (fold of moveItem) — remove from
  // source, append to target, same ids; stamp updatedBy (no-op when no name set).
  // - SYNC ON: per item, tombstone-source + fresh-id-target — IDENTICAL to the single
  // moveItem sync path, accumulated so all moves land in one write. The fresh id is required
  // so the moved copy can never collide with its own source tombstone.
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

  // Copy a WHOLE day's live items onto `dstDate` (copy-day). Every copy is a FRESH-id copy of
  // the source item's content (freshCopyOf, reused — never a hand-rolled stripper), so a copy
  // NEVER reuses a source id, in BOTH modes (a same-id copy would collide with the source, and
  // under sync would be re-killed by the tombstone bias). One commit via the pure core copyDay
  // (fold of addItem): dormant stamps attribution only; sync additionally stamps rev=1/hlc —
  // the SAME stamper addItem's sync path uses, so there is one stamping code path.
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
      // `orderedIds` comes from the UI, which only ever sees LIVE items (the tombstone
      // filter). Core `reorderItems` drops any item not listed — so, when sync is on, we
      // must APPEND this day's tombstone ids so the reorder does not silently drop pending
      // deletes (which would stop them propagating). Reorder is order-only: it does NOT bump
      // rev/hlc — the tombstones keep their existing stamps and simply trail the live
      // items. Dormant: no tombstones
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
  // The MERGE sees tombstones; the UI does not. The internal `plans` state (and the
  // persisted localStorage layer beneath it) RETAIN `deleted:true` items so a delete can
  // propagate + win over a concurrent edit. The value handed to consumers — and every
  // selector below — is filtered to `!deleted` items ONLY, so the calendar, dashboard,
  // timeline, findPlacements, and every card render live items exactly as before, with ZERO
  // consumer edits (this is the ONLY selector change the whole slice makes). Dormant items
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

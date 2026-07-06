'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { DayPlan, ItineraryItem } from '@/lib/trip-data';
import { ITINERARY_STORAGE_KEY } from '@/lib/itinerary-storage';
import { getUserName } from '@/lib/identity';
import { getActiveTraveler } from '@/lib/token-auth';
import { isRemoteConfigured } from '@/lib/firebase-config';
import { clock } from '@/lib/trip-now';
import { stampCreated, stampUpdated } from '@/lib/attribution';
import { stampSyncCreated, stampSyncUpdated, stampSyncDeleted } from '@/core/sync/stamp';
import { itineraryStoragePort, itinerarySyncPort } from '@/lib/itinerary-ports';
import { generateItemId } from '@/lib/item-id';
import * as itinerary from '@/core/itinerary';

/**
 * Shared reactive itinerary store.
 *
 * This hook owns the live `plans: DayPlan[]` and is the SINGLE read/write path for the
 * itinerary. It is a THIN React adapter: the array-manipulation CRUD lives in the
 * framework-free `core/itinerary` (pure `DayPlan[]` transforms), persistence is expressed as
 * the `StoragePort` (production impl = the Vault gateway `loadPlans`/`savePlans`/
 * `hasStoredPlans`), and the local→remote fan-out is the `SyncPort` (production impl =
 * the lazy-gated `pushPlans`). This hook only owns React state + effects + the same-tab/
 * cross-tab event wiring + attribution stamping at the boundary. It does NOT re-implement or
 * alter the persistence contract (key-presence, never a length gate; always writes, incl.
 * `[]`) — those all live in the StoragePort impl.
 *
 * Reactivity (both layers, by design):
 *  - Every mutator writes via the StoragePort `save()` AND dispatches a same-tab
 *    `CustomEvent` (`ITINERARY_CHANGED_EVENT`) on `window`.
 *  - The hook listens for that CustomEvent (same-tab liveness)
 *    AND the cross-tab `storage` event, re-reading from the StoragePort on either.
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
  moveItem(itemId: string, fromDate: string, toDate: string): void;
  reorderItems(date: string, orderedIds: string[]): void;
  getDayPlan(date: string): DayPlan;
  findPlacements(sourceId: string): Array<{ date: string; item: ItineraryItem }>;
}

// Cross-friend attribution stamping lives in lib/attribution.ts —
// a single named, unit-testable place. The mutators below pass bound `stampCreated` /
// `stampUpdated` closures (name source = `getUserName`) INTO the pure core, so:
//   - stamping fires ONLY when a name is set (dormant / no-name ⇒ fields stay undefined,
//     items valid — persistence holds);
//   - it runs ONLY in these local mutators (at the adapter boundary), so the snapshot-ingest
//     path (which writes via savePlans() directly) PRESERVES a remote author's attribution
//     (echo-suppression). Keeping the identity read here — not in core — is what lets
//     `core/itinerary` stay pure while the attribution behavior is byte-identical.

// ── Sync v2 rev/hlc stamping ──────────────────────────────────────────────────────────────
// The mutators additionally stamp the two ordering fields via the pure `core/sync/stamp`
// helpers — riding ALONGSIDE attribution (no duplication). These take an
// injected `physicalNow` (ClockPort) and `actor`, so they stay pure/testable and
// never import firebase.
//
// ── THE DORMANT-BUILD BYTE-IDENTITY GUARANTEE (the biggest risk) ─────────────────────────
// Stamping rev/hlc — and, critically, turning `removeItem` into a tombstone — CHANGES
// localStorage bytes. Doing that unconditionally would break the dormant portfolio build's
// byte-identity and risk the delete-all-stays-empty guarantee (a tombstone
// must not leave `plans` non-empty). So the ENTIRE Sync-v2 behavior is CONDITIONAL on
// `isRemoteConfigured()`:
//   - DORMANT (no firebase env): `syncEnabled()` is false. `removeItem` physically removes
//     exactly as today, and NO rev/hlc is stamped. The dormant build is byte-for-byte
//     unchanged; the persistence guarantees hold verbatim.
//   - CONFIGURED (sync on): the tombstone + rev/hlc path activates, and the exposed `plans`
//     selector filters `deleted` items so the UI still shows a normal delete.
// The `actor` is sourced synchronously + firebase-free from the active traveler token
// (`getActiveTraveler().name` — distinct per friend),
// falling back to the display name, then ''. The anon-auth uid would be strictly-better as
// the actor but is only available async inside the remote handle; the per-friend token is a
// stable, synchronous, dormant-safe id sufficient for the HLC tie-break (distinct across the
// three clients).
function syncEnabled(): boolean {
  return isRemoteConfigured();
}

function syncActor(): string {
  return getActiveTraveler()?.name ?? getUserName() ?? '';
}

export function useItinerary(): ItineraryStore {
  const [plans, setPlans] = useState<DayPlan[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Mirror of the latest plans for the dispatch/listen path: re-reads triggered by
  // the CustomEvent/storage event read straight from storage (the source of truth),
  // so they don't depend on a stale closure.
  const hydratedRef = useRef(false);

  // Load from localStorage on mount (key-present check lives in the StoragePort impl).
  // SSR-safe: `itineraryStoragePort.load()` returns SAMPLE_ITINERARY under no-window,
  // matching first paint; the real read happens here after mount.
  useEffect(() => {
    setPlans(itineraryStoragePort.load());
    setHydrated(true);
    hydratedRef.current = true;
  }, []);

  // Re-read on a same-tab CustomEvent OR a cross-tab `storage` event, so every store
  // instance (and any non-Context reader) stays in sync within and across tabs.
  useEffect(() => {
    const reread = () => {
      // Only re-read once we've hydrated, so a same-tab event can't pull data in
      // before the initial load (it can't anyway — events fire from our own writes —
      // but the guard keeps SSR/first-paint semantics clean).
      if (!hydratedRef.current) return;
      setPlans(itineraryStoragePort.load());
    };
    const onCustom = () => reread();
    const onStorage = (e: StorageEvent) => {
      // ITINERARY_STORAGE_KEY change, or a full clear (key === null), triggers a re-read.
      // Route through the exported key constant — NOT a hardcoded literal — so the
      // cross-tab listener can never silently stop matching if the on-disk key changes.
      if (e.key === ITINERARY_STORAGE_KEY || e.key === null) reread();
    };
    window.addEventListener(ITINERARY_CHANGED_EVENT, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(ITINERARY_CHANGED_EVENT, onCustom);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Single commit path: derive `next` from the freshest persisted state (the StoragePort
  // is the source of truth), then write through `save()` (always writes, never
  // length-gates), update React state, and dispatch the same-tab CustomEvent so other
  // store instances re-read.
  //
  // Reading the base from `itineraryStoragePort.load()` (NOT the React `plans` closure)
  // makes multiple mutations chained in ONE event handler compose correctly: each call
  // sees the prior call's already-persisted write, so e.g. moveItem()+reorderItems() in
  // handleDragEnd don't clobber each other on a stale render snapshot.
  // Gated on `hydrated` so the first-render plans=[] can't clobber storage before load.
  //
  // Remote push: this is the single write choke-point, so it is also where
  // local mutations fan out to the remote via the SyncPort. We capture `prev = load()`
  // BEFORE the compute (it's free — the commit path already reads it), then AFTER the local save +
  // dispatch (offline cache + instant same-tab echo first), push the per-day delta —
  // ONLY when remote is configured, behind the SyncPort's DYNAMIC conditional import so the
  // dormant build never pulls firebase onto the hot path. `push` is invoked
  // ONLY here (genuine local mutations), never from the snapshot-ingest path — the
  // echo-suppression rule. It is best-effort and self-degrading; it never throws
  // (the SyncPort swallows failures), so a remote failure can't break the local edit.
  const commit = useCallback((compute: (current: DayPlan[]) => DayPlan[]) => {
    if (!hydratedRef.current) return;
    const prev = itineraryStoragePort.load();
    const next = compute(prev);
    itineraryStoragePort.save(next);
    setPlans(next);
    window.dispatchEvent(new CustomEvent(ITINERARY_CHANGED_EVENT));

    // Fire-and-forget: the local save + dispatch above already happened; the remote push
    // is best-effort on top and never throws (the SyncPort swallows its own failures).
    void itinerarySyncPort.push(prev, next);
  }, []);

  const addItem = useCallback(
    (date: string, item: ItineraryItem) => {
      // Stamp createdBy/updatedBy/updatedAt from the identity module at the
      // boundary — no-op when no name is set — then, when sync is on (gated), stamp
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
      // DORMANT (sync off): physically remove exactly as today — the dormant build
      // stays byte-for-byte identical and delete-all-stays-empty holds verbatim.
      // SYNC ON: a delete is a content event that must PROPAGATE + win, so instead of
      // removing we write a TOMBSTONE (deleted:true, rev+1, hlc advanced) via
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

  // Move an item between days (drag-between-days semantics).
  //
  // DORMANT (sync off): a physical move — remove from source, append to target — exactly
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
        const { id: _oldId, deleted: _wasDeleted, rev: _oldRev, hlc: _oldHlc, ...content } = original;
        const freshCopy = { ...content, id: generateItemId() } as ItineraryItem;
        return itinerary.addItem(tombstoned, toDate, freshCopy, (i) =>
          stampSyncCreated(stampCreated(i, getUserName), clock.now().getTime(), syncActor()),
        );
      });
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

  // ── The exposed-`plans` tombstone filter ───────────────────────────────────
  // The MERGE sees tombstones; the UI does not. The internal `plans` state (and the
  // persisted localStorage layer beneath it) RETAIN `deleted:true` items so a delete can
  // propagate + win over a concurrent edit. The value handed to consumers — and every
  // selector below — is filtered to `!deleted` items ONLY, so the calendar, dashboard,
  // timeline, findPlacements, and every card render live items exactly as before, with ZERO
  // consumer edits (this is the ONLY selector change made here). Dormant items
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
    moveItem,
    reorderItems,
    getDayPlan,
    findPlacements,
  };
}

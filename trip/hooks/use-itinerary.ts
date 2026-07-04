'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { DayPlan, ItineraryItem, getCountryForDate } from '@/lib/trip-data';
import { loadPlans, savePlans } from '@/lib/itinerary-storage';
import { isRemoteConfigured } from '@/lib/firebase-config';
import { getUserName } from '@/lib/identity';
import { stampCreated, stampUpdated } from '@/lib/attribution';

/**
 * Shared reactive itinerary store.
 *
 * This hook owns the live `plans: DayPlan[]` and is the SINGLE read/write path for
 * the itinerary. It wraps the storage module (`loadPlans`/`savePlans`) — it
 * does NOT re-implement or alter the persistence contract (key-presence, never a
 * length gate; always writes, incl. `[]`).
 *
 * Reactivity (both layers, by design):
 *  - Every mutator writes via `savePlans()` AND dispatches a same-tab `CustomEvent`
 *    (`ITINERARY_CHANGED_EVENT`) on `window`.
 *  - The hook listens for that CustomEvent (same-tab liveness) AND the cross-tab
 *    `storage` event, re-reading from storage on either.
 *
 * Instantiated ONCE at the app root by `itinerary-provider.tsx`; consumers read the
 * one shared instance via `useItineraryContext()`. The raw hook is exported for the
 * provider and for tests.
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

// Cross-friend attribution stamping lives in lib/attribution.ts — a single named,
// unit-testable place. The mutators below call stampCreated / stampUpdated with
// `getUserName` as the name source, so:
//   - stamping fires ONLY when a name is set (dormant / no-name ⇒ fields stay undefined,
//     items valid);
//   - it runs ONLY in these local mutators, so the snapshot-ingest path (which writes via
//     savePlans() directly) PRESERVES a remote author's attribution (echo-suppression).

// Synthesize an empty day for a date with no stored plan. Lifted verbatim from
// `calendar-planner.tsx`'s former `getDayPlan`/`updateDayPlan` so there is zero
// behavior change in the calendar after the migration.
function synthesizeDay(dateStr: string): DayPlan {
  return {
    date: dateStr,
    city: getCountryForDate(dateStr) === 'nepal' ? 'Kathmandu' : 'Tokyo',
    country: getCountryForDate(dateStr),
    items: [],
  };
}

export function useItinerary(): ItineraryStore {
  const [plans, setPlans] = useState<DayPlan[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Mirror of the latest plans for the dispatch/listen path: re-reads triggered by
  // the CustomEvent/storage event read straight from storage (the source of truth),
  // so they don't depend on a stale closure.
  const hydratedRef = useRef(false);

  // Load from localStorage on mount (key-present check lives in the shared helper).
  // SSR-safe: `loadPlans()` returns SAMPLE_ITINERARY under no-window, matching first
  // paint; the real read happens here after mount.
  useEffect(() => {
    setPlans(loadPlans());
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
      setPlans(loadPlans());
    };
    const onCustom = () => reread();
    const onStorage = (e: StorageEvent) => {
      // ITINERARY_STORAGE_KEY change, or a full clear (key === null), triggers a re-read.
      if (e.key === 'nepal_japan_itinerary' || e.key === null) reread();
    };
    window.addEventListener(ITINERARY_CHANGED_EVENT, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(ITINERARY_CHANGED_EVENT, onCustom);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Single commit path: derive `next` from the freshest persisted state (storage
  // is the source of truth), then write through savePlans (always writes,
  // never length-gates), update React state, and dispatch the same-tab CustomEvent
  // so other store instances re-read.
  //
  // Reading the base from `loadPlans()` (not the React `plans` closure) makes
  // multiple mutations chained in ONE event handler compose correctly: each call
  // sees the prior call's already-persisted write, so e.g. moveItem()+reorderItems()
  // in handleDragEnd don't clobber each other on a stale render snapshot.
  // Gated on `hydrated` so the first-render plans=[] can't clobber storage before load.
  //
  // Remote push: this is the single write choke-point, so it is also where
  // local mutations fan out to the remote. We capture `prev = loadPlans()` BEFORE the
  // compute (it's free — we already read it), then AFTER the local savePlans+dispatch
  // (offline cache + instant same-tab echo first), push the per-day delta to Firestore —
  // ONLY when remote is configured, behind a DYNAMIC import so a build with no remote
  // config never pulls firebase onto the hot path. `pushPlans` is invoked ONLY here
  // (genuine local mutations), never from the snapshot-ingest path — that is the
  // echo-suppression rule. Push is best-effort and self-degrading; it never
  // throws, so a remote failure can't break the local edit.
  const commit = useCallback((compute: (current: DayPlan[]) => DayPlan[]) => {
    if (!hydratedRef.current) return;
    const prev = loadPlans();
    const next = compute(prev);
    savePlans(next);
    setPlans(next);
    window.dispatchEvent(new CustomEvent(ITINERARY_CHANGED_EVENT));

    if (isRemoteConfigured()) {
      import('@/lib/itinerary-remote')
        .then(({ pushPlans }) => pushPlans(prev, next))
        .catch((err) => {
          // Degrade to local-only; never let a remote-push path break a local edit.
          console.warn('[use-itinerary] remote push unavailable:', err);
        });
    }
  }, []);

  // Upsert helper mirroring the calendar's former `updateDayPlan`: if a DayPlan
  // exists for `date`, map over it; otherwise synthesize an empty day and apply the
  // updater.
  const upsertDay = useCallback(
    (date: string, updater: (plan: DayPlan) => DayPlan) => {
      commit((current) => {
        const existing = current.find((p) => p.date === date);
        return existing
          ? current.map((p) => (p.date === date ? updater(p) : p))
          : [...current, updater(synthesizeDay(date))];
      });
    },
    [commit],
  );

  const addItem = useCallback(
    (date: string, item: ItineraryItem) => {
      // Stamp createdBy/updatedBy/updatedAt from the identity module — no-op
      // when no name is set, so dormant/no-name items keep undefined attribution.
      const stamped = stampCreated(item, getUserName);
      upsertDay(date, (plan) => ({ ...plan, items: [...(plan.items ?? []), stamped] }));
    },
    [upsertDay],
  );

  const updateItem = useCallback(
    (date: string, itemId: string, patch: Partial<ItineraryItem>) => {
      // A content edit stamps updatedBy/updatedAt. Stamp the MERGED item so a
      // patch that itself carries attribution (none today) can't be overwritten oddly;
      // no-op when no name is set.
      upsertDay(date, (plan) => ({
        ...plan,
        items: (plan.items ?? []).map((i) =>
          i.id === itemId ? stampUpdated({ ...i, ...patch }, getUserName) : i,
        ),
      }));
    },
    [upsertDay],
  );

  const removeItem = useCallback(
    (date: string, itemId: string) => {
      upsertDay(date, (plan) => ({
        ...plan,
        items: (plan.items ?? []).filter((i) => i.id !== itemId),
      }));
    },
    [upsertDay],
  );

  // Move an item between days. Reproduces the calendar's drag-between-days semantics:
  // remove from the source day, append to the (upserted) target day. Computed as one
  // atomic commit against the freshest persisted state.
  const moveItem = useCallback(
    (itemId: string, fromDate: string, toDate: string) => {
      if (fromDate === toDate) return;
      commit((current) => {
        const sourcePlan = current.find((p) => p.date === fromDate);
        const item = (sourcePlan?.items ?? []).find((i) => i.id === itemId);
        if (!item) return current;

        // A cross-day move IS a content edit → stamp updatedBy/updatedAt on the
        // moved item (no-op when no name set). createdBy is preserved (first author wins).
        const moved = stampUpdated(item, getUserName);

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
      });
    },
    [commit],
  );

  // Reorder items within a day to match `orderedIds`. Items not present in
  // `orderedIds` are dropped (callers pass the full set), and unknown ids are
  // ignored. Pure id-driven reorder so the caller doesn't need item references.
  const reorderItems = useCallback(
    (date: string, orderedIds: string[]) => {
      upsertDay(date, (plan) => {
        const byId = new Map((plan.items ?? []).map((i) => [i.id, i]));
        const reordered = orderedIds
          .map((id) => byId.get(id))
          .filter((i): i is ItineraryItem => i !== undefined);
        return { ...plan, items: reordered };
      });
    },
    [upsertDay],
  );

  // Selectors (pure, derived from plans).
  const getDayPlan = useCallback(
    (date: string): DayPlan => plans.find((p) => p.date === date) ?? synthesizeDay(date),
    [plans],
  );

  const findPlacements = useCallback(
    (sourceId: string): Array<{ date: string; item: ItineraryItem }> => {
      const out: Array<{ date: string; item: ItineraryItem }> = [];
      for (const plan of plans) {
        for (const item of plan.items ?? []) {
          if (item.sourceId === sourceId) out.push({ date: plan.date, item });
        }
      }
      return out;
    },
    [plans],
  );

  return {
    plans,
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

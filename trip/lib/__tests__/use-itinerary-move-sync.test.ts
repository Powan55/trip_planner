// @vitest-environment jsdom
//
// S110-FIX / F19a — regression suite for the cross-day `moveItem` fix (F1) in
// hooks/use-itinerary.ts, exercised by RENDERING the real hook (the same tiny renderHook shim
// over react-dom/client + act that use-itinerary-sync.test.ts uses — no new dependency). This
// closes the sync-ON blind spot: the old physical-remove move left NO tombstone on the source
// day, so the Sync-v2 union-merge resurrected the source copy and the item ended up live on BOTH
// days for everyone. The fix makes a move under sync a tombstone-source + fresh-id-target (D-032)
// in ONE commit; dormant stays a byte-identical physical move (D-038).
//
// Proven on a real run:
//   SYNC ON:
//     - after a cross-day move, the SOURCE day carries a TOMBSTONE (deleted:true) and NO live
//       copy; the TARGET day has exactly ONE live copy with a FRESH id (!= the original id).
//     - a subsequent mergeDays snapshot that still carries the PRE-move source item does NOT
//       resurrect it on the source day (the tombstone wins by hlc/rev).
//     - move-then-move-back works (fresh ids dodge the tombstones — no id collision).
//   DORMANT:
//     - moveItem output is BYTE-EQUAL to the old physical move: source loses the item, target
//       gains it, and NO sync fields (rev/hlc/deleted) are stamped anywhere.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { ItineraryStore } from '@/hooks/use-itinerary';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';

// Controllable config gate — flip `remoteOn` per-suite to exercise sync-on vs dormant on the REAL hook.
const state = vi.hoisted(() => ({ remoteOn: false }));
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => state.remoteOn,
  getTripId: () => 'nepal-japan-2026',
}));
// Never let the sync fan-out touch firebase here: stub the SyncPort to no-ops (the push/subscribe
// wiring is covered by the fake-Firestore suites; here we exercise only the STORE's local move).
vi.mock('@/lib/itinerary-ports', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/itinerary-ports')>();
  return {
    ...orig,
    itinerarySyncPort: {
      push: async () => {},
      subscribe: () => () => {},
      isConfigured: () => state.remoteOn,
    },
  };
});
// A signed-in traveler so syncActor()/the guest gate resolve to a real identified traveler.
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }) };
});

import { useItinerary } from '@/hooks/use-itinerary';
import { ITINERARY_STORAGE_KEY, savePlans } from '@/lib/itinerary-storage';
import { mergeDays } from '@/core/sync/merge-day';

// ── Minimal renderHook over react-dom/client + act (mirrors use-itinerary-sync.test.ts). ──────
interface HookHandle {
  current: ItineraryStore;
  run: (fn: (store: ItineraryStore) => void) => Promise<void>;
  rerenderFresh: () => Promise<void>;
  unmount: () => void;
}

function renderItinerary(): HookHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root = createRoot(container);
  const ref: { current: ItineraryStore } = { current: null as unknown as ItineraryStore };

  function Probe() {
    ref.current = useItinerary();
    return null;
  }
  act(() => {
    root.render(createElement(Probe));
  });

  return {
    get current() {
      return ref.current;
    },
    async run(fn) {
      await act(async () => {
        fn(ref.current);
        await Promise.resolve();
      });
    },
    async rerenderFresh() {
      act(() => root.unmount());
      root = createRoot(container);
      act(() => {
        root.render(createElement(Probe));
      });
      await act(async () => {
        await Promise.resolve();
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const FROM_DATE = '2027-01-05';
const TO_DATE = '2027-01-06';

// Read RAW on-disk plans (with tombstones), bypassing the exposed filter.
function rawOnDisk(): DayPlan[] {
  const blob = localStorage.getItem(ITINERARY_STORAGE_KEY);
  if (!blob) return [];
  const parsed = JSON.parse(blob);
  return Array.isArray(parsed) ? parsed : parsed.payload;
}
function rawDayItems(date: string): ItineraryItem[] {
  return rawOnDisk().find((d) => d.date === date)?.items ?? [];
}
function exposedDayItems(store: ItineraryStore, date: string): ItineraryItem[] {
  return store.plans.find((d) => d.date === date)?.items ?? [];
}

beforeEach(() => {
  localStorage.clear();
  savePlans([]); // key present → the store loads [] and never reseeds the sample.
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('SYNC ON — moveItem = tombstone-source + fresh-id-target (F1, D-032)', () => {
  beforeEach(() => {
    state.remoteOn = true;
  });

  it('leaves a tombstone (no live copy) on the source day and one FRESH-id live copy on the target', async () => {
    const h = renderItinerary();
    await h.run((s) => s.addItem(FROM_DATE, { id: 'a', title: 'Temple', category: 'cultural', sourceId: 'src-1' }));
    await h.run((s) => s.moveItem('a', FROM_DATE, TO_DATE));

    // Exposed (UI) view: gone from source, present once on target.
    expect(exposedDayItems(h.current, FROM_DATE).map((i) => i.id)).toEqual([]);
    const exposedTarget = exposedDayItems(h.current, TO_DATE);
    expect(exposedTarget).toHaveLength(1);

    // Raw on disk: SOURCE has the original id as a tombstone, NO live copy.
    const rawSource = rawDayItems(FROM_DATE);
    const srcOriginal = rawSource.find((i) => i.id === 'a');
    expect(srcOriginal?.deleted).toBe(true);
    expect(rawSource.some((i) => i.deleted !== true)).toBe(false); // no live item left on the source

    // TARGET has exactly one LIVE copy with a FRESH id (!= 'a') and the SAME sourceId (findPlacements follows).
    const rawTarget = rawDayItems(TO_DATE);
    const liveTarget = rawTarget.filter((i) => i.deleted !== true);
    expect(liveTarget).toHaveLength(1);
    expect(liveTarget[0].id).not.toBe('a');
    expect(liveTarget[0].sourceId).toBe('src-1');
    expect(liveTarget[0].title).toBe('Temple');
    expect(liveTarget[0].rev).toBe(1); // fresh placement, rev resets to 1 (addItem sync path)
    expect(typeof liveTarget[0].hlc).toBe('string');
    h.unmount();
  });

  it('a subsequent mergeDays snapshot carrying the PRE-move source item does NOT resurrect it', async () => {
    const h = renderItinerary();
    await h.run((s) => s.addItem(FROM_DATE, { id: 'a', title: 'Temple', category: 'cultural' }));
    // Capture the PRE-move state as a stand-in for what a peer's remote snapshot still holds.
    const remotePreMove: DayPlan[] = JSON.parse(JSON.stringify(rawOnDisk()));

    await h.run((s) => s.moveItem('a', FROM_DATE, TO_DATE));
    const localAfterMove = rawOnDisk();

    // The snapshot ingest path is mergeDays(local, remote). The tombstone (higher rev/hlc) must win
    // over the remote's still-live source copy, so the item stays deleted on the source day.
    const merged = mergeDays(localAfterMove, remotePreMove);
    const mergedSource = merged.find((d) => d.date === FROM_DATE)?.items ?? [];
    expect(mergedSource.some((i) => i.id === 'a' && i.deleted !== true)).toBe(false);
    // And the fresh-id target copy survives the merge (still exactly one live item on the target).
    const mergedTarget = merged.find((d) => d.date === TO_DATE)?.items ?? [];
    expect(mergedTarget.filter((i) => i.deleted !== true)).toHaveLength(1);
    h.unmount();
  });

  it('move-then-move-back works (fresh ids dodge the tombstones — no collision)', async () => {
    const h = renderItinerary();
    await h.run((s) => s.addItem(FROM_DATE, { id: 'a', title: 'Temple', category: 'cultural' }));
    await h.run((s) => s.moveItem('a', FROM_DATE, TO_DATE));

    // Grab the fresh id now living on the target, then move it BACK to the source day.
    const targetId = rawDayItems(TO_DATE).find((i) => i.deleted !== true)!.id;
    await h.run((s) => s.moveItem(targetId, TO_DATE, FROM_DATE));

    // Exposed: exactly one live item, back on the source day; none on the target.
    expect(exposedDayItems(h.current, TO_DATE)).toEqual([]);
    expect(exposedDayItems(h.current, FROM_DATE)).toHaveLength(1);

    // Raw source: the ORIGINAL tombstone 'a' still exists AND a NEW live copy (fresh id) coexists —
    // the fresh id is exactly what stops the move-back colliding with 'a''s own tombstone.
    const rawSource = rawDayItems(FROM_DATE);
    expect(rawSource.find((i) => i.id === 'a')?.deleted).toBe(true);
    const liveOnSource = rawSource.filter((i) => i.deleted !== true);
    expect(liveOnSource).toHaveLength(1);
    expect(liveOnSource[0].id).not.toBe('a');
    expect(liveOnSource[0].id).not.toBe(targetId); // a brand-new id again
    h.unmount();
  });
});

describe('DORMANT — moveItem is a byte-identical physical move (D-038)', () => {
  beforeEach(() => {
    state.remoteOn = false;
  });

  it('removes from source + appends to target with NO sync fields anywhere', async () => {
    const h = renderItinerary();
    await h.run((s) => s.addItem(FROM_DATE, { id: 'a', title: 'Temple', category: 'cultural' }));
    await h.run((s) => s.moveItem('a', FROM_DATE, TO_DATE));

    // Physically gone from source, present (same id 'a') on target — the classic physical move.
    expect(rawDayItems(FROM_DATE).map((i) => i.id)).toEqual([]);
    const rawTarget = rawDayItems(TO_DATE);
    expect(rawTarget.map((i) => i.id)).toEqual(['a']);

    // No tombstone, no rev/hlc/deleted stamped ANYWHERE (byte-identical to pre-fix behavior).
    for (const d of rawOnDisk()) {
      for (const it of d.items) {
        expect(it).not.toHaveProperty('rev');
        expect(it).not.toHaveProperty('hlc');
        expect(it).not.toHaveProperty('deleted');
      }
    }
    // The moved item on the target is exactly the original item shape (title/category preserved).
    expect(rawTarget[0]).toEqual({ id: 'a', title: 'Temple', category: 'cultural' });
    h.unmount();
  });
});

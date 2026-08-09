// @vitest-environment jsdom
//
// S127 — regression suite for delete-UNDO (`restoreItem`) in hooks/use-itinerary.ts, the #1
// correctness trap of the Phase-1 planner-CRUD tier: a restore that is silently re-killed by
// the tombstone bias in the day-doc merge. Exercised by RENDERING the real hook (the same tiny
// renderHook shim over react-dom/client + act as use-itinerary-move-sync.test.ts — no new dep).
//
// The delete path is UNCHANGED (removeItem still tombstones under sync / physically removes under
// dormant). S127 only ADDS the undo: capture the removed item → restoreItem(date, item).
//
// Proven on a real run:
//   SYNC ON (D-032 fresh-id restore):
//     - after delete+undo, the day carries the ORIGINAL id as a TOMBSTONE (deleted:true) AND
//       exactly ONE live copy with a FRESH id (!= the deleted id), rev===1, fresh hlc.
//     - a subsequent mergeDays snapshot that still carries the item LIVE (a peer that hasn't seen
//       the delete) does NOT resurrect a duplicate and does NOT lose the restore: exactly one live
//       copy survives and the original id stays dead.
//     - NON-VACUOUS: the SAME merge, fed a same-id-same-HLC restore (the WRONG design), re-kills it
//       (resolvePair biases the tombstone on an HLC tie, merge-day.ts:79) — so the fresh-id assertion
//       genuinely bites; it is not a guard that would pass either way.
//   DORMANT (D-038 byte-identity):
//     - delete+undo restores the SAME id, byte-identical, with NO deleted/rev/hlc stamped anywhere.

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
// Never let the sync fan-out touch firebase here: stub the SyncPort to no-ops.
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
// A signed-in traveler so syncActor() resolves to a real identified traveler.
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }) };
});

import { useItinerary } from '@/hooks/use-itinerary';
import { ITINERARY_STORAGE_KEY, savePlans } from '@/lib/itinerary-storage';
import { mergeDays } from '@/core/sync/merge-day';

// ── Minimal renderHook over react-dom/client + act (mirrors use-itinerary-move-sync.test.ts). ──
interface HookHandle {
  current: ItineraryStore;
  run: (fn: (store: ItineraryStore) => void) => Promise<void>;
  unmount: () => void;
}

function renderItinerary(): HookHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
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
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const DATE = '2027-01-05';

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

describe('SYNC ON — restoreItem = fresh-id restore that survives the tombstone bias (S127, D-032)', () => {
  beforeEach(() => {
    state.remoteOn = true;
  });

  it('after delete+undo the day has the original id as a tombstone AND one FRESH-id live copy', async () => {
    const h = renderItinerary();
    const item: ItineraryItem = { id: 'a', title: 'Temple', category: 'cultural', sourceId: 'src-1' };
    await h.run((s) => s.addItem(DATE, item));

    // Capture the exact item the UI would hand the undo handler (the exposed, live item).
    const captured = { ...exposedDayItems(h.current, DATE)[0] };
    await h.run((s) => s.removeItem(DATE, 'a')); // delete → tombstone (unchanged path)

    // Post-delete: UI shows it gone; on disk 'a' is a tombstone with no live copy.
    expect(exposedDayItems(h.current, DATE)).toEqual([]);
    expect(rawDayItems(DATE).find((i) => i.id === 'a')?.deleted).toBe(true);
    expect(rawDayItems(DATE).some((i) => i.deleted !== true)).toBe(false);

    await h.run((s) => s.restoreItem(DATE, captured)); // UNDO

    // Exposed: exactly one live item back.
    const exposed = exposedDayItems(h.current, DATE);
    expect(exposed).toHaveLength(1);

    // Raw on disk: 'a' STILL a tombstone AND exactly one FRESH-id live copy.
    const raw = rawDayItems(DATE);
    expect(raw.find((i) => i.id === 'a')?.deleted).toBe(true);
    const live = raw.filter((i) => i.deleted !== true);
    expect(live).toHaveLength(1);
    expect(live[0].id).not.toBe('a'); // FRESH id — the whole point
    expect(live[0].sourceId).toBe('src-1'); // content preserved (findPlacements follows)
    expect(live[0].title).toBe('Temple');
    expect(live[0].rev).toBe(1); // fresh placement, rev resets to 1 (addItem sync path)
    expect(typeof live[0].hlc).toBe('string');
    // No inherited tombstone flag on the restored copy.
    expect(live[0].deleted).toBeUndefined();
    h.unmount();
  });

  it('a peer snapshot that still holds the item LIVE does not resurrect a duplicate or lose the restore', async () => {
    const h = renderItinerary();
    const item: ItineraryItem = { id: 'a', title: 'Temple', category: 'cultural', sourceId: 'src-1' };
    await h.run((s) => s.addItem(DATE, item));

    // A peer's snapshot captured BEFORE the delete — it still has 'a' live.
    const remoteStillLive: DayPlan[] = JSON.parse(JSON.stringify(rawOnDisk()));

    const captured = { ...exposedDayItems(h.current, DATE)[0] };
    await h.run((s) => s.removeItem(DATE, 'a'));
    await h.run((s) => s.restoreItem(DATE, captured));
    const localAfterUndo = rawOnDisk();

    // The snapshot-ingest path is mergeDays(local, remote). The tombstone (higher rev/hlc) must win
    // over the peer's still-live 'a', and the fresh-id restore has no peer counterpart, so it survives.
    const merged = mergeDays(localAfterUndo, remoteStillLive);
    const mergedDay = merged.find((d) => d.date === DATE)?.items ?? [];

    // 'a' stays dead (not resurrected by the peer's live copy).
    expect(mergedDay.some((i) => i.id === 'a' && i.deleted !== true)).toBe(false);
    // Exactly ONE live item survives — the fresh-id restore, not a duplicate.
    const mergedLive = mergedDay.filter((i) => i.deleted !== true);
    expect(mergedLive).toHaveLength(1);
    expect(mergedLive[0].id).not.toBe('a');
    expect(mergedLive[0].title).toBe('Temple');
    h.unmount();
  });

  it('NON-VACUOUS: a same-id-same-HLC restore (the WRONG design) IS silently re-killed by the merge', async () => {
    const h = renderItinerary();
    await h.run((s) => s.addItem(DATE, { id: 'a', title: 'Temple', category: 'cultural' }));
    await h.run((s) => s.removeItem(DATE, 'a'));

    // The real tombstone left on disk (deleted:true, its own hlc).
    const tombstone = rawDayItems(DATE).find((i) => i.id === 'a')!;
    expect(tombstone.deleted).toBe(true);

    // Counterfactual restore: SAME id, SAME hlc, just un-deleted — what a naive same-id undo would produce.
    const sameIdRestore: ItineraryItem = { ...tombstone, deleted: false };
    const localWrong: DayPlan[] = [{ date: DATE, city: '', country: 'nepal', items: [sameIdRestore] }];
    const remoteTomb: DayPlan[] = [{ date: DATE, city: '', country: 'nepal', items: [tombstone] }];

    // resolvePair (deleteWins:'hlc') hits an exact HLC tie → biases the tombstone (merge-day.ts:79).
    const mergedWrong = mergeDays(localWrong, remoteTomb).find((d) => d.date === DATE)!.items;
    const survivor = mergedWrong.find((i) => i.id === 'a')!;
    expect(survivor.deleted).toBe(true); // the same-id restore LOST — proving the fresh-id design is necessary
    expect(mergedWrong.filter((i) => i.deleted !== true)).toHaveLength(0);
    h.unmount();
  });
});

describe('DORMANT — restoreItem is a byte-identical same-id re-add (S127, D-038)', () => {
  beforeEach(() => {
    state.remoteOn = false;
  });

  it('delete+undo restores the SAME id, byte-identical, with NO sync fields anywhere', async () => {
    const h = renderItinerary();
    const item: ItineraryItem = { id: 'a', title: 'Temple', category: 'cultural' };
    await h.run((s) => s.addItem(DATE, item));

    const captured = { ...exposedDayItems(h.current, DATE)[0] };
    await h.run((s) => s.removeItem(DATE, 'a')); // physical remove (dormant)
    expect(rawDayItems(DATE)).toEqual([]); // truly gone, no tombstone

    await h.run((s) => s.restoreItem(DATE, captured)); // UNDO — same-id re-add

    // Back with the SAME id and the exact original shape.
    const raw = rawDayItems(DATE);
    expect(raw.map((i) => i.id)).toEqual(['a']);
    expect(raw[0]).toEqual({ id: 'a', title: 'Temple', category: 'cultural' });

    // No tombstone / rev / hlc / deleted stamped ANYWHERE (byte-identical to a plain add).
    for (const d of rawOnDisk()) {
      for (const it of d.items) {
        expect(it).not.toHaveProperty('rev');
        expect(it).not.toHaveProperty('hlc');
        expect(it).not.toHaveProperty('deleted');
      }
    }
    h.unmount();
  });
});

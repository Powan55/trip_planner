// @vitest-environment jsdom
//
// S130 — regression suite for the BULK itinerary ops (`deleteItems` / `moveItems` / `copyDay`)
// in hooks/use-itinerary.ts, exercised by RENDERING the real hook (the same renderHook shim over
// react-dom/client + act as use-itinerary-clearday-sync.test.ts — no new dependency). Each bulk
// op must be exactly ONE commit() → ONE SyncPort.push (D-088 one-or-few per-day doc writes), with
// the correct sync stamping FOLDED over the selection:
//
//   SYNC ON:
//     - deleteItems tombstones EVERY selected id and leaves the UNSELECTED ones live, in ONE push.
//     - copyDay adds FRESH-id live copies of the source day's live items to the target, ONE push;
//       ids differ from the source (D-032), tombstones on the source are NOT copied.
//     - moveItems tombstones each source copy and adds a FRESH-id target copy, in ONE push.
//     - bulk-delete undo (restoreDay over the captured selection) restores FRESH-id live copies.
//   DORMANT (D-038 byte-identity):
//     - deleteItems physically removes; moveItems physically moves (same ids); copyDay physically
//       copies with FRESH ids — and NO deleted/rev/hlc is stamped anywhere.
//
// S396 (open item B) — bulk move gained an Undo, so this file also carries the DISCRIMINATING
// proof for it. Sync-on is the only branch where the defect can exist (D-248: sync is configured
// in production): `moveItems` tombstones the source and mints a FRESH id at the target, so an
// inverse addressed by the ORIGINAL ids resolves tombstones and silently does nothing. Two tests
// pin it — one on the store contract (originals ARE refused), one driving the REAL production
// inverse (`lib/bulk-move-undo.ts`, which is what `handleBulkMove` calls) and asserting the items
// actually come back. Both assert RESULTING STATE read back through the StoragePort, never call
// args — a call-args assertion against a stateless fake is what let S389-A ship green.
//
// 🔴 The e2e round trip (`e2e/multi-select.spec.ts`) canNOT discriminate this: the `out/` build is
// DORMANT, where a move preserves ids, so an original-id inverse works there. It proves the UX;
// this file proves the mechanic.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { ItineraryStore } from '@/hooks/use-itinerary';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';

const state = vi.hoisted(() => ({
  remoteOn: false,
  pushCalls: [] as Array<{ prev: DayPlan[]; next: DayPlan[] }>,
}));
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => state.remoteOn,
  // #10: mirrors isRemoteConfigured — every mocked getTripId here is non-empty, so the two gates agree.
  isTripRemoteConfigured: () => state.remoteOn,
  getTripId: () => 'nepal-japan-2026',
}));
vi.mock('@/lib/itinerary-ports', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/itinerary-ports')>();
  return {
    ...orig,
    itinerarySyncPort: {
      push: async (prev: DayPlan[], next: DayPlan[]) => {
        state.pushCalls.push({ prev, next });
      },
      subscribe: () => () => {},
      isConfigured: () => state.remoteOn,
    },
  };
});
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }) };
});

// S396: spy on the ONE undo helper so the test can grab the real onUndo closure and run it,
// exactly as the S389-A concierge proof does. Mocking also keeps sonner/JSX out of this suite.
const undoSpy = vi.hoisted(() => vi.fn());
vi.mock('@/lib/undo-toast', () => ({ showUndoToast: undoSpy }));

import { useItinerary } from '@/hooks/use-itinerary';
import { bulkMoveWithUndo } from '@/lib/bulk-move-undo';
import { ITINERARY_STORAGE_KEY, savePlans } from '@/lib/itinerary-storage';

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
const DST = '2027-01-06';

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
function changedDayCount(prev: DayPlan[], next: DayPlan[]): number {
  const prevById = new Map(prev.map((d) => [d.date, JSON.stringify(d.items ?? [])]));
  let changed = 0;
  for (const d of next) {
    if (prevById.get(d.date) !== JSON.stringify(d.items ?? [])) changed++;
  }
  return changed;
}

async function seedDay(h: HookHandle, date: string, items: ItineraryItem[]) {
  for (const it of items) {
    await h.run((s) => s.addItem(date, it));
  }
}

beforeEach(() => {
  localStorage.clear();
  savePlans([]); // key present → store loads [] and never reseeds the sample.
  state.pushCalls = [];
  undoSpy.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('SYNC ON — bulk ops are ONE commit each with folded sync stamping (S130)', () => {
  beforeEach(() => {
    state.remoteOn = true;
  });

  it('deleteItems tombstones the SELECTED subset, leaves unselected LIVE, in ONE push / ONE changed day', async () => {
    const h = renderItinerary();
    await seedDay(h, DATE, [
      { id: 'a', title: 'Temple', category: 'cultural', sourceId: 's-a' },
      { id: 'b', title: 'Ramen', category: 'food', sourceId: 's-b' },
      { id: 'c', title: 'Shrine', category: 'cultural', sourceId: 's-c' },
    ]);

    state.pushCalls = [];
    await h.run((s) =>
      s.deleteItems([
        { date: DATE, itemId: 'a' },
        { date: DATE, itemId: 'c' },
      ]),
    );

    // ONE commit → exactly ONE push, changed exactly ONE day (D-088).
    expect(state.pushCalls).toHaveLength(1);
    expect(changedDayCount(state.pushCalls[0].prev, state.pushCalls[0].next)).toBe(1);

    const raw = rawDayItems(DATE);
    // Selected a/c tombstoned; b still live.
    expect(raw.find((i) => i.id === 'a')?.deleted).toBe(true);
    expect(raw.find((i) => i.id === 'c')?.deleted).toBe(true);
    expect(raw.find((i) => i.id === 'b')?.deleted).toBeUndefined();
    // Exposed shows only the unselected 'b'.
    expect(exposedDayItems(h.current, DATE).map((i) => i.id)).toEqual(['b']);
    h.unmount();
  });

  it('copyDay adds FRESH-id live copies of the source day (ids differ from source), in ONE push', async () => {
    const h = renderItinerary();
    await seedDay(h, DATE, [
      { id: 'a', title: 'Temple', category: 'cultural', sourceId: 's-a' },
      { id: 'b', title: 'Ramen', category: 'food', sourceId: 's-b' },
    ]);

    state.pushCalls = [];
    await h.run((s) => s.copyDay(DATE, DST));

    expect(state.pushCalls).toHaveLength(1);

    const dst = rawDayItems(DST);
    const live = dst.filter((i) => i.deleted !== true);
    expect(live).toHaveLength(2);
    const ids = live.map((i) => i.id);
    expect(ids).not.toContain('a');
    expect(ids).not.toContain('b');
    expect(new Set(ids).size).toBe(2); // distinct fresh ids
    expect(live.map((i) => i.sourceId).sort()).toEqual(['s-a', 's-b']);
    for (const c of live) {
      expect(c.rev).toBe(1); // fresh placement
      expect(c.deleted).toBeUndefined();
      expect(typeof c.hlc).toBe('string');
    }
    // Source day untouched (still live a/b).
    expect(exposedDayItems(h.current, DATE).map((i) => i.id).sort()).toEqual(['a', 'b']);
    h.unmount();
  });

  it('moveItems tombstones each source copy and adds a FRESH-id target copy, in ONE push', async () => {
    const h = renderItinerary();
    await seedDay(h, DATE, [
      { id: 'a', title: 'Temple', category: 'cultural', sourceId: 's-a' },
      { id: 'b', title: 'Ramen', category: 'food', sourceId: 's-b' },
      { id: 'c', title: 'Shrine', category: 'cultural', sourceId: 's-c' },
    ]);

    state.pushCalls = [];
    await h.run((s) =>
      s.moveItems(
        [
          { itemId: 'a', fromDate: DATE },
          { itemId: 'c', fromDate: DATE },
        ],
        DST,
      ),
    );

    expect(state.pushCalls).toHaveLength(1);
    // Two changed days (source + target).
    expect(changedDayCount(state.pushCalls[0].prev, state.pushCalls[0].next)).toBe(2);

    const src = rawDayItems(DATE);
    // Moved sources tombstoned; 'b' still live on source.
    expect(src.find((i) => i.id === 'a')?.deleted).toBe(true);
    expect(src.find((i) => i.id === 'c')?.deleted).toBe(true);
    expect(src.find((i) => i.id === 'b')?.deleted).toBeUndefined();

    const dstLive = rawDayItems(DST).filter((i) => i.deleted !== true);
    expect(dstLive).toHaveLength(2);
    const ids = dstLive.map((i) => i.id);
    expect(ids).not.toContain('a');
    expect(ids).not.toContain('c');
    expect(new Set(ids).size).toBe(2);
    // sourceId carried so findPlacements follows the move.
    expect(dstLive.map((i) => i.sourceId).sort()).toEqual(['s-a', 's-c']);
    for (const c of dstLive) expect(c.rev).toBe(1);

    // Exposed: source shows only 'b', target shows the two fresh copies.
    expect(exposedDayItems(h.current, DATE).map((i) => i.id)).toEqual(['b']);
    expect(exposedDayItems(h.current, DST)).toHaveLength(2);
    h.unmount();
  });

  // ── S396 (open item B) ──────────────────────────────────────────────────────────────────
  // Half one: the STORE CONTRACT. `moveItems` reports the ids the write really produced, and the
  // original ids are, demonstrably, dead addresses afterwards.
  it('SYNC ON: moveItems returns the LANDED fresh ids, and re-addressing the ORIGINAL ids is a silent no-op (S396)', async () => {
    const h = renderItinerary();
    await seedDay(h, DATE, [
      { id: 'a', title: 'Temple', category: 'cultural', sourceId: 's-a' },
      { id: 'c', title: 'Shrine', category: 'cultural', sourceId: 's-c' },
    ]);

    let landed: string[] = [];
    await h.run((s) => {
      landed = s.moveItems(
        [
          { itemId: 'a', fromDate: DATE },
          { itemId: 'c', fromDate: DATE },
        ],
        DST,
      );
    });

    // The returned ids ARE the ids now live on the target — and are NOT the originals.
    expect(landed).toHaveLength(2);
    expect(landed).not.toContain('a');
    expect(landed).not.toContain('c');
    expect([...landed].sort()).toEqual(
      rawDayItems(DST)
        .filter((i) => i.deleted !== true)
        .map((i) => i.id)
        .sort(),
    );

    // THE TRAP, pinned: inverting by the ORIGINAL ids addresses the source-day tombstones, so the
    // store refuses every target (empty return) and NOTHING moves. This is why an inverse built
    // from the selection would show a toast over unchanged data (S389-A, one file over).
    let refused: string[] = ['not-run'];
    await h.run((s) => {
      refused = s.moveItems(
        [
          { itemId: 'a', fromDate: DST },
          { itemId: 'c', fromDate: DST },
        ],
        DATE,
      );
    });
    expect(refused).toEqual([]);
    expect(rawDayItems(DST).filter((i) => i.deleted !== true)).toHaveLength(2); // still on DST
    expect(rawDayItems(DATE).filter((i) => i.deleted !== true)).toHaveLength(0);
    h.unmount();
  });

  // Half two: the PRODUCTION INVERSE. `bulkMoveWithUndo` is exactly what `handleBulkMove` calls,
  // so this fails if that construction is ever switched back to the selected (original) ids.
  it('SYNC ON: bulk-move Undo actually moves the items BACK (S396 — discriminating)', async () => {
    const h = renderItinerary();
    await seedDay(h, DATE, [
      { id: 'a', title: 'Temple', category: 'cultural', sourceId: 's-a' },
      { id: 'b', title: 'Ramen', category: 'food', sourceId: 's-b' },
      { id: 'c', title: 'Shrine', category: 'cultural', sourceId: 's-c' },
    ]);

    // The selection the UI hands over: the ORIGINAL ids on the visible day.
    await h.run((s) => bulkMoveWithUndo(s.moveItems, ['a', 'c'], DATE, DST));

    // (a) the move landed, under FRESH ids — the mechanic that makes the wrong inverse a no-op.
    expect(exposedDayItems(h.current, DATE).map((i) => i.id)).toEqual(['b']);
    const onTarget = exposedDayItems(h.current, DST);
    expect(onTarget).toHaveLength(2);
    expect(onTarget.map((i) => i.id)).not.toContain('a');
    expect(onTarget.map((i) => i.id)).not.toContain('c');

    // The sibling copy, matched exactly.
    expect(undoSpy).toHaveBeenCalledTimes(1);
    expect(undoSpy.mock.calls[0][0]).toBe('Moved 2 items');

    // (b) THE POINT: Undo puts them back on the day they came from.
    const onUndo = undoSpy.mock.calls[0][1] as () => void;
    await h.run(() => onUndo());

    expect(exposedDayItems(h.current, DST)).toHaveLength(0);
    const back = exposedDayItems(h.current, DATE);
    expect(back).toHaveLength(3);
    expect(back.map((i) => i.sourceId).sort()).toEqual(['s-a', 's-b', 's-c']);
    // Read back through the StoragePort too — this is what a reload would show.
    expect(rawDayItems(DATE).filter((i) => i.deleted !== true)).toHaveLength(3);
    expect(rawDayItems(DST).filter((i) => i.deleted !== true)).toHaveLength(0);
    h.unmount();
  });

  it('bulk-delete undo (restoreDay over the captured selection) restores FRESH-id live copies, originals tombstoned', async () => {
    const h = renderItinerary();
    await seedDay(h, DATE, [
      { id: 'a', title: 'Temple', category: 'cultural', sourceId: 's-a' },
      { id: 'b', title: 'Ramen', category: 'food', sourceId: 's-b' },
      { id: 'c', title: 'Shrine', category: 'cultural', sourceId: 's-c' },
    ]);

    // Capture the selected (a, c) as the UI would before deleting.
    const captured = exposedDayItems(h.current, DATE)
      .filter((i) => i.id === 'a' || i.id === 'c')
      .map((i) => ({ ...i }));

    await h.run((s) =>
      s.deleteItems([
        { date: DATE, itemId: 'a' },
        { date: DATE, itemId: 'c' },
      ]),
    );
    expect(exposedDayItems(h.current, DATE).map((i) => i.id)).toEqual(['b']);

    state.pushCalls = [];
    await h.run((s) => s.restoreDay(DATE, captured)); // UNDO — one commit
    expect(state.pushCalls).toHaveLength(1);

    const live = rawDayItems(DATE).filter((i) => i.deleted !== true);
    // b (untouched) + two fresh-id restores of a/c.
    expect(live.map((i) => i.id).includes('b')).toBe(true);
    const restored = live.filter((i) => i.id !== 'b');
    expect(restored).toHaveLength(2);
    expect(restored.map((i) => i.id)).not.toContain('a');
    expect(restored.map((i) => i.id)).not.toContain('c');
    expect(restored.map((i) => i.sourceId).sort()).toEqual(['s-a', 's-c']);
    // Originals still tombstoned.
    expect(rawDayItems(DATE).find((i) => i.id === 'a')?.deleted).toBe(true);
    expect(rawDayItems(DATE).find((i) => i.id === 'c')?.deleted).toBe(true);
    h.unmount();
  });
});

describe('DORMANT — bulk ops physical, no stamping (S130, D-038)', () => {
  beforeEach(() => {
    state.remoteOn = false;
  });

  it('deleteItems physically removes the subset; moveItems physically moves (same ids); NO stamps', async () => {
    const h = renderItinerary();
    await seedDay(h, DATE, [
      { id: 'a', title: 'Temple', category: 'cultural' },
      { id: 'b', title: 'Ramen', category: 'food' },
      { id: 'c', title: 'Shrine', category: 'cultural' },
    ]);

    await h.run((s) => s.deleteItems([{ date: DATE, itemId: 'a' }]));
    // Physically gone — no tombstone left behind.
    expect(rawDayItems(DATE).map((i) => i.id)).toEqual(['b', 'c']);

    let landed: string[] = [];
    await h.run((s) => {
      // S396: a refused target ('nope' does not exist) must be OMITTED from the landed ids.
      landed = s.moveItems(
        [
          { itemId: 'b', fromDate: DATE },
          { itemId: 'nope', fromDate: DATE },
        ],
        DST,
      );
    });
    expect(landed).toEqual(['b']); // dormant preserves the id, and only 'b' actually moved
    expect(rawDayItems(DATE).map((i) => i.id)).toEqual(['c']);
    // Moved copy keeps its SAME id under dormant (physical move).
    expect(rawDayItems(DST).map((i) => i.id)).toEqual(['b']);

    for (const d of rawOnDisk()) {
      for (const it of d.items) {
        expect(it).not.toHaveProperty('rev');
        expect(it).not.toHaveProperty('hlc');
        expect(it).not.toHaveProperty('deleted');
      }
    }
    h.unmount();
  });

  it('copyDay physically copies with FRESH ids; NO deleted/rev/hlc stamped', async () => {
    const h = renderItinerary();
    await seedDay(h, DATE, [
      { id: 'a', title: 'Temple', category: 'cultural', sourceId: 's-a' },
      { id: 'b', title: 'Ramen', category: 'food', sourceId: 's-b' },
    ]);

    await h.run((s) => s.copyDay(DATE, DST));

    const dst = rawDayItems(DST);
    expect(dst).toHaveLength(2);
    const ids = dst.map((i) => i.id);
    expect(ids).not.toContain('a');
    expect(ids).not.toContain('b');
    expect(new Set(ids).size).toBe(2);
    expect(dst.map((i) => i.sourceId).sort()).toEqual(['s-a', 's-b']);
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

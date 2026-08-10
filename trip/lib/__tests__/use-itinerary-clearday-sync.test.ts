// @vitest-environment jsdom
//
// S129 — regression suite for clear-WHOLE-day (`clearDay` + `restoreDay`) in
// hooks/use-itinerary.ts, exercised by RENDERING the real hook (the same renderHook shim over
// react-dom/client + act as use-itinerary-restore-sync.test.ts / use-itinerary-move-sync.test.ts
// — no new dependency). This proves the three correctness traps of a whole-day clear under sync:
//
//   SYNC ON:
//     - clearDay tombstones EVERY previously-live item and leaves ZERO live, produced by exactly
//       ONE commit → ONE SyncPort.push → ONE changed day (D-088 one per-day doc write).
//     - the CONCURRENT-ADD merge property (non-vacuous): a friend's STRICTLY-LATER add (higher
//       HLC) survives the clear (stays live), while an earlier/equal-HLC add stays tombstoned —
//       the clear never nukes a legitimate concurrent add.
//     - clear+undo (restoreDay) restores N FRESH-id live copies (ids all differ) and the
//       originals remain tombstoned.
//   DORMANT (D-038 byte-identity):
//     - clearDay physically empties the day; NO deleted/rev/hlc stamped anywhere.
//     - clear+undo restores the SAME ids byte-identically.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { ItineraryStore } from '@/hooks/use-itinerary';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';

// Controllable config gate — flip `remoteOn` per-suite. `pushCalls` records every SyncPort.push
// (prev,next) so the test can assert ONE push per commit and count changed days (D-088).
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

import { useItinerary } from '@/hooks/use-itinerary';
import { ITINERARY_STORAGE_KEY, savePlans } from '@/lib/itinerary-storage';
import { mergeDay } from '@/core/sync/merge-day';
import type { Hlc } from '@/core/sync/hlc';
import { serialize, parse } from '@/core/sync/hlc';

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
// How many days differ (by JSON identity of their items) between two snapshots.
function changedDayCount(prev: DayPlan[], next: DayPlan[]): number {
  const prevById = new Map(prev.map((d) => [d.date, JSON.stringify(d.items ?? [])]));
  let changed = 0;
  for (const d of next) {
    if (prevById.get(d.date) !== JSON.stringify(d.items ?? [])) changed++;
  }
  return changed;
}

beforeEach(() => {
  localStorage.clear();
  savePlans([]); // key present → store loads [] and never reseeds the sample.
  state.pushCalls = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('SYNC ON — clearDay tombstones ALL in ONE write; concurrent-add survives; undo = fresh ids (S129)', () => {
  beforeEach(() => {
    state.remoteOn = true;
  });

  it('tombstones every previously-live item, zero live, produced by ONE commit / ONE push / ONE changed day', async () => {
    const h = renderItinerary();
    await h.run((s) => s.addItem(DATE, { id: 'a', title: 'Temple', category: 'cultural', sourceId: 's-a' }));
    await h.run((s) => s.addItem(DATE, { id: 'b', title: 'Ramen', category: 'food', sourceId: 's-b' }));
    await h.run((s) => s.addItem(DATE, { id: 'c', title: 'Shrine', category: 'cultural', sourceId: 's-c' }));

    const liveBefore = exposedDayItems(h.current, DATE);
    expect(liveBefore.map((i) => i.id).sort()).toEqual(['a', 'b', 'c']);

    state.pushCalls = []; // isolate the clear's write(s)
    await h.run((s) => s.clearDay(DATE));

    // ONE commit → exactly ONE push, and that push changed exactly ONE day (D-088 Spark quota).
    expect(state.pushCalls).toHaveLength(1);
    expect(changedDayCount(state.pushCalls[0].prev, state.pushCalls[0].next)).toBe(1);

    // Raw on-disk: a tombstone for EVERY previously-live id, and ZERO live.
    const raw = rawDayItems(DATE);
    const tombstones = raw.filter((i) => i.deleted === true);
    expect(tombstones.map((i) => i.id).sort()).toEqual(['a', 'b', 'c']);
    expect(raw.some((i) => i.deleted !== true)).toBe(false);
    for (const t of tombstones) {
      expect(t.rev).toBe(2); // add stamped rev=1, the clear tombstone bumps to 2
      expect(typeof t.hlc).toBe('string');
    }
    // UI shows the day empty (exposed filter drops tombstones).
    expect(exposedDayItems(h.current, DATE)).toEqual([]);
    h.unmount();
  });

  it('NON-VACUOUS concurrent-add property: a STRICTLY-LATER friend add survives the clear; an earlier/equal one stays dead', async () => {
    const h = renderItinerary();
    await h.run((s) => s.addItem(DATE, { id: 'a', title: 'Temple', category: 'cultural' }));
    await h.run((s) => s.clearDay(DATE));

    const tombstone = rawDayItems(DATE).find((i) => i.id === 'a')!;
    expect(tombstone.deleted).toBe(true);
    const clearedLocal: DayPlan = { date: DATE, city: '', country: 'nepal', items: [tombstone] };

    // Build a friend's concurrent add to the SAME id 'a' at a controllable HLC.
    // Build a friend's concurrent add to the SAME id 'a' at a controllable HLC (pt offset
    // relative to the tombstone). `actor` defaults to a DIFFERENT friend for the strict cases;
    // the equal-tie case reuses the tombstone's OWN actor to force an EXACT HLC tie.
    const tombHlc: Hlc = parse(tombstone.hlc!);
    const friendAddAt = (ptDelta: number, actor = 'Sushil'): ItineraryItem => ({
      ...tombstone,
      deleted: false,
      hlc: serialize({ pt: tombHlc.pt + ptDelta, ct: tombHlc.ct, actor }),
    });

    // STRICTLY-LATER add (higher pt) → resurrects: it survives the clear.
    const later: DayPlan = { date: DATE, city: '', country: 'nepal', items: [friendAddAt(1000)] };
    const mergedLater = mergeDay(clearedLocal, later).items;
    const survivor = mergedLater.find((i) => i.id === 'a')!;
    expect(survivor.deleted).toBe(false); // friend's later add wins → LIVE (survives the clear)
    expect(mergedLater.filter((i) => i.deleted !== true)).toHaveLength(1);

    // EARLIER add (lower pt) → stays tombstoned (the clear wins).
    const earlier: DayPlan = { date: DATE, city: '', country: 'nepal', items: [friendAddAt(-1000)] };
    const mergedEarlier = mergeDay(clearedLocal, earlier).items;
    expect(mergedEarlier.find((i) => i.id === 'a')!.deleted).toBe(true);
    expect(mergedEarlier.filter((i) => i.deleted !== true)).toHaveLength(0);

    // EXACT HLC TIE (same pt/ct/actor as the tombstone) → tombstone bias holds
    // (merge-day.ts:79) → stays dead. Proves the property is HLC-STRICT (">", not ">="):
    // an equal-HLC add does NOT resurrect, so the clear is only lost to a genuinely-later add.
    const equal: DayPlan = { date: DATE, city: '', country: 'nepal', items: [friendAddAt(0, tombHlc.actor)] };
    const mergedEqual = mergeDay(clearedLocal, equal).items;
    expect(mergedEqual.find((i) => i.id === 'a')!.deleted).toBe(true);
    expect(mergedEqual.filter((i) => i.deleted !== true)).toHaveLength(0);
    h.unmount();
  });

  it('clear+undo restores N FRESH-id live copies (ids all differ) with originals still tombstoned', async () => {
    const h = renderItinerary();
    await h.run((s) => s.addItem(DATE, { id: 'a', title: 'Temple', category: 'cultural', sourceId: 's-a' }));
    await h.run((s) => s.addItem(DATE, { id: 'b', title: 'Ramen', category: 'food', sourceId: 's-b' }));

    // Capture the exposed live items (what the UI hands the undo handler) BEFORE clearing.
    const captured = exposedDayItems(h.current, DATE).map((i) => ({ ...i }));
    await h.run((s) => s.clearDay(DATE));
    expect(exposedDayItems(h.current, DATE)).toEqual([]);

    state.pushCalls = [];
    await h.run((s) => s.restoreDay(DATE, captured)); // UNDO — one commit

    // One commit → one push for the whole restore.
    expect(state.pushCalls).toHaveLength(1);

    const raw = rawDayItems(DATE);
    const live = raw.filter((i) => i.deleted !== true);
    // Two fresh-id live copies, ids all distinct from the originals.
    expect(live).toHaveLength(2);
    const liveIds = live.map((i) => i.id);
    expect(liveIds).not.toContain('a');
    expect(liveIds).not.toContain('b');
    expect(new Set(liveIds).size).toBe(2); // distinct
    expect(live.map((i) => i.sourceId).sort()).toEqual(['s-a', 's-b']);
    for (const l of live) {
      expect(l.rev).toBe(1); // fresh placement
      expect(l.deleted).toBeUndefined();
    }
    // Originals still tombstoned.
    expect(raw.find((i) => i.id === 'a')?.deleted).toBe(true);
    expect(raw.find((i) => i.id === 'b')?.deleted).toBe(true);
    // Exposed shows exactly the two restored items live.
    expect(exposedDayItems(h.current, DATE)).toHaveLength(2);
    h.unmount();
  });
});

describe('DORMANT — clearDay physically empties; undo restores same ids byte-identically (S129, D-038)', () => {
  beforeEach(() => {
    state.remoteOn = false;
  });

  it('clearDay empties the day physically — NO deleted/rev/hlc anywhere', async () => {
    const h = renderItinerary();
    await h.run((s) => s.addItem(DATE, { id: 'a', title: 'Temple', category: 'cultural' }));
    await h.run((s) => s.addItem(DATE, { id: 'b', title: 'Ramen', category: 'food' }));

    await h.run((s) => s.clearDay(DATE));

    expect(rawDayItems(DATE)).toEqual([]); // truly empty — no tombstones
    for (const d of rawOnDisk()) {
      for (const it of d.items) {
        expect(it).not.toHaveProperty('rev');
        expect(it).not.toHaveProperty('hlc');
        expect(it).not.toHaveProperty('deleted');
      }
    }
    h.unmount();
  });

  it('clear+undo restores the SAME ids byte-identically', async () => {
    const h = renderItinerary();
    const items: ItineraryItem[] = [
      { id: 'a', title: 'Temple', category: 'cultural' },
      { id: 'b', title: 'Ramen', category: 'food' },
    ];
    await h.run((s) => s.addItem(DATE, items[0]));
    await h.run((s) => s.addItem(DATE, items[1]));

    const captured = exposedDayItems(h.current, DATE).map((i) => ({ ...i }));
    await h.run((s) => s.clearDay(DATE));
    expect(rawDayItems(DATE)).toEqual([]);

    await h.run((s) => s.restoreDay(DATE, captured)); // UNDO

    const raw = rawDayItems(DATE);
    expect(raw.map((i) => i.id).sort()).toEqual(['a', 'b']);
    expect(raw.find((i) => i.id === 'a')).toEqual({ id: 'a', title: 'Temple', category: 'cultural' });
    expect(raw.find((i) => i.id === 'b')).toEqual({ id: 'b', title: 'Ramen', category: 'food' });
    for (const it of raw) {
      expect(it).not.toHaveProperty('rev');
      expect(it).not.toHaveProperty('hlc');
      expect(it).not.toHaveProperty('deleted');
    }
    h.unmount();
  });
});

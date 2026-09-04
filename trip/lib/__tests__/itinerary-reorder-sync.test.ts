// @vitest-environment jsdom
//
// Drag-to-reorder inside a day, with sync ON, must survive the round trip.
//
// The chain under test is the real one, composed exactly as production composes it:
//   1. `useItinerary().reorderItems` writes the new order to localStorage (the real hook).
//   2. `pushDayMerged` (lib/itinerary-remote.ts) writes `mergeDay(localDay, remoteNow)`.
//   3. the server-acked snapshot reaches `applyRemoteMerged`, which persists
//      `mergeDays(loadPlans(), remoteDays)`.
// Steps 2 and 3 are the REAL `mergeDay`/`mergeDays`, called with the same arguments those two
// functions pass them; only the firebase transport in between is elided (it is covered by
// itinerary-remote-sync.test.ts against a fake Firestore, and it moves no items).
//
// Order is user-visible: components/calendar-planner.tsx renders `visiblePlan.items` verbatim
// and lib/phase-of-day.ts preserves array order inside its timed/untimed partition.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { ItineraryStore } from '@/hooks/use-itinerary';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';

// A controllable injected clock so every stamp in this suite is deterministic and distinct.
const state = vi.hoisted(() => ({ nowMs: 1_700_000_000_000 }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => true,
  isTripRemoteConfigured: () => true,
  getTripId: () => 'nepal-japan-2026',
}));

// The push/subscribe transport is not what this suite proves — stub it, then drive the merge
// boundaries directly with the real merge core (see the header).
vi.mock('@/lib/itinerary-ports', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/itinerary-ports')>();
  return {
    ...orig,
    itinerarySyncPort: { push: async () => {}, subscribe: () => () => {}, isConfigured: () => true },
  };
});

vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }) };
});

vi.mock('@/lib/trip-now', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/trip-now')>();
  return { ...orig, realClock: { now: () => new Date(state.nowMs) } };
});

import { useItinerary } from '@/hooks/use-itinerary';
import { loadPlans, savePlans } from '@/lib/itinerary-storage';
import { mergeDay, mergeDays } from '@/core/sync/merge-day';
import { nextSyncStamp, reorderSyncStamps } from '@/core/sync/stamp';

const DATE = '2026-12-10';

function mkItem(id: string): ItineraryItem {
  return { id, title: `Item ${id}`, category: 'sightseeing' };
}
function ids(items: ItineraryItem[] | undefined): string[] {
  return (items ?? []).filter((i) => i.deleted !== true).map((i) => i.id);
}
function dayOf(plans: DayPlan[]): DayPlan {
  const d = plans.find((p) => p.date === DATE);
  if (!d) throw new Error(`no day ${DATE}`);
  return d;
}

// ── Minimal renderHook over react-dom/client + act (mirrors use-itinerary-sync.test.ts). ──
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

let handle: HookHandle | null = null;

beforeEach(() => {
  localStorage.clear();
  state.nowMs = 1_700_000_000_000;
});

afterEach(() => {
  handle?.unmount();
  handle = null;
  vi.restoreAllMocks();
});

async function seedThreeItems(): Promise<HookHandle> {
  // Start from an EMPTY stored day, not the sample pack, so the ids under test are the only rows.
  savePlans([{ date: DATE, city: 'Kathmandu', country: 'nepal', items: [] }]);
  const h = renderItinerary();
  handle = h;
  for (const id of ['a', 'b', 'c']) {
    state.nowMs += 1000; // distinct, ascending hlc per add
    await h.run((s) => s.addItem(DATE, mkItem(id)));
  }
  return h;
}

describe('drag-to-reorder inside a day survives the sync round trip', () => {
  it('the user order survives push (mergeDay) + the server-acked snapshot (mergeDays)', async () => {
    const h = await seedThreeItems();
    const remoteNow = dayOf(loadPlans()); // remote and local agree before the reorder
    expect(ids(remoteNow.items)).toEqual(['a', 'b', 'c']);

    state.nowMs += 1000;
    await h.run((s) => s.reorderItems(DATE, ['c', 'a', 'b']));

    // Local state is what the user sees immediately.
    expect(ids(dayOf(h.current.plans).items)).toEqual(['c', 'a', 'b']);

    // 2. what pushDayMerged writes to Firestore: mergeDay(localDay, remoteNow).
    const localDay = dayOf(loadPlans());
    const written = mergeDay(localDay, remoteNow);
    expect(ids(written.items)).toEqual(['c', 'a', 'b']);

    // 3. the server-acked snapshot: applyRemoteMerged persists mergeDays(loadPlans(), remoteDays).
    const applied = mergeDays(loadPlans(), [written]);
    expect(ids(dayOf(applied).items)).toEqual(['c', 'a', 'b']);
  });

  // DOCUMENTATION, NOT A PIN. Every other case in this file passes in either argument order
  // because `mergeItems` is commutative; this one shows what the order actually decides —
  // `mergeDay` resolves day metadata to its FIRST argument, and all three production call sites
  // pass the local day, so a stale value on the remote doc is corrected by this device's push.
  // It spells that order in its OWN body and never calls `pushDayMerged`, so flipping the
  // production call leaves this GREEN — only the two lines below can turn it red. The real pin
  // is `itinerary-remote-sync.test.ts` → "day metadata resolves to LOCAL on the push, matching
  // the snapshot merge", which drives the real `pushDayMerged` against a fake Firestore and
  // reads the written doc back. Change the order there, not here, to see a failure.
  it('composes the day-metadata precedence both boundaries use (the item merge hides it elsewhere)', async () => {
    const h = await seedThreeItems();
    // The remote doc was written by an older build: coerced leg id, stale city.
    const remoteNow: DayPlan = { ...dayOf(loadPlans()), city: 'Kathmandu', country: 'nepal' };

    state.nowMs += 1000;
    await h.run((s) => s.reorderItems(DATE, ['c', 'a', 'b']));
    const localDay: DayPlan = { ...dayOf(loadPlans()), city: 'New York', country: 'main' };

    const written = mergeDay(localDay, remoteNow); // 2. pushDayMerged
    expect(written.country).toBe('main');
    expect(written.city).toBe('New York');
    expect(ids(written.items)).toEqual(['c', 'a', 'b']); // the item merge is unchanged

    const applied = dayOf(mergeDays([localDay], [remoteNow])); // 3. applyRemoteMerged
    expect(applied.country).toBe('main');
    expect(applied.city).toBe('New York');
  });

  it('a pending tombstone still propagates and is not restamped by the reorder', async () => {
    const h = await seedThreeItems();
    state.nowMs += 1000;
    await h.run((s) => s.removeItem(DATE, 'b'));
    const tombstoneBefore = dayOf(loadPlans()).items.find((i) => i.id === 'b');

    state.nowMs += 1000;
    await h.run((s) => s.reorderItems(DATE, ['c', 'a']));

    const localDay = dayOf(loadPlans());
    const tombstoneAfter = localDay.items.find((i) => i.id === 'b');
    expect(tombstoneAfter).toEqual(tombstoneBefore); // delete ordering untouched by a reorder
    expect(ids(mergeDays(loadPlans(), [mergeDay(localDay, localDay)])[0].items)).toEqual(['c', 'a']);
  });

  it('checking off the FIRST row leaves it first — an edit advances the conflict key, not the order key', async () => {
    // The done toggle (components/travel-agenda-card.tsx) is a plain `updateItem`, so it takes
    // the same stamping path as the item editor and the rename-and-claim pass. When one field
    // did both jobs the edit made the row the day maximum and the very next merge dropped it to
    // the bottom of the day — from the user's side, ticking a box moved the row.
    const h = await seedThreeItems();
    const remoteNow = dayOf(loadPlans());

    state.nowMs += 1000;
    await h.run((s) => s.updateItem(DATE, 'a', { done: true }));
    expect(ids(dayOf(h.current.plans).items)).toEqual(['a', 'b', 'c']);

    const written = mergeDay(dayOf(loadPlans()), remoteNow);
    expect(ids(written.items)).toEqual(['a', 'b', 'c']);
    expect(written.items.find((i) => i.id === 'a')!.done).toBe(true);

    expect(ids(dayOf(mergeDays(loadPlans(), [written])).items)).toEqual(['a', 'b', 'c']);
  });

  it("a peer's newer edit survives this device's drag — a reorder writes position, not content", async () => {
    const h = await seedThreeItems();
    const before = dayOf(loadPlans());

    // The peer edits `b`'s notes and pushes. This device has NOT received that snapshot.
    const peerAt = state.nowMs + 1000;
    const remoteAfterPeer: DayPlan = {
      ...before,
      items: before.items.map((i) =>
        i.id === 'b' ? { ...i, notes: 'peer note', ...nextSyncStamp(i, peerAt, 'Bee') } : i,
      ),
    };

    // LATER, still unaware, this device drags. A reorder that re-stamped the merge key would
    // make every local row win its resolve carrying this device's stale body, so the peer's
    // note would be replaced by a copy that never had it.
    state.nowMs += 5000;
    await h.run((s) => s.reorderItems(DATE, ['c', 'a', 'b']));

    const written = mergeDay(dayOf(loadPlans()), remoteAfterPeer);
    expect(ids(written.items)).toEqual(['c', 'a', 'b']); // the drag lands
    expect(written.items.find((i) => i.id === 'b')!.notes).toBe('peer note'); // and costs nothing
  });
});

describe('reorderSyncStamps — the ordering stamp is convergent', () => {
  type Row = { id: string; title: string; rev?: number; hlc?: string; ord?: string; deleted?: boolean };
  // Fixture stamps are PT_WIDTH=15 wide, exactly what `serialize` emits. A wider literal here
  // still parses to the right `pt`, but the raw string compares below (and the one inside
  // `reorderSyncStamps`) would then be comparing mismatched widths and could pass on padding.
  const rows = (): Row[] => [
    { id: 'a', title: 'a', rev: 1, hlc: '001700000001000:000000:Powan' },
    { id: 'b', title: 'b', rev: 1, hlc: '001700000002000:000000:Powan' },
    { id: 'c', title: 'c', rev: 1, hlc: '001700000003000:000000:Powan' },
  ];
  const byId = (list: Row[]) => list.map((r) => r.id);
  const pick = (list: Row[], order: string[]): Row[] =>
    order.map((id) => list.find((r) => r.id === id)!);

  it('stamps strictly ascending ords in array order, so the merge sort reproduces that order', () => {
    const out = reorderSyncStamps(pick(rows(), ['c', 'a', 'b']), 1_700_000_005_000, 'Powan');
    expect(byId(out)).toEqual(['c', 'a', 'b']);
    expect(out[0].ord! < out[1].ord!).toBe(true);
    expect(out[1].ord! < out[2].ord!).toBe(true);
    // Every row's new stamp beats THAT ROW's old key, which is what makes it win against its own
    // pre-reorder remote copy (the merge resolves per `id`). Here `physicalNow` is also ahead of
    // every input, so the head additionally clears the tail's old stamp — that is a property of
    // this fixture, not of the function; see the docstring for the lagging-clock case.
    const before = rows();
    pick(before, ['c', 'a', 'b']).forEach((r, i) => expect(out[i].ord! > r.hlc!).toBe(true));
    expect(out[0].ord! > '001700000003000:000000:Powan').toBe(true);
    // A drag is not a revision and must not touch the CONFLICT key: leaving both alone is what
    // stops the dragging device's whole row-set from beating a peer's unseen edits.
    expect(out.map((r) => r.rev)).toEqual([1, 1, 1]);
    expect(out.map((r) => r.hlc)).toEqual(pick(rows(), ['c', 'a', 'b']).map((r) => r.hlc));
  });

  it('two devices reordering the same day concurrently converge on ONE order', () => {
    // Device A reorders first; device B a second later. Neither has seen the other.
    const a = reorderSyncStamps(pick(rows(), ['c', 'a', 'b']), 1_700_000_005_000, 'Ann');
    const b = reorderSyncStamps(pick(rows(), ['b', 'c', 'a']), 1_700_000_006_000, 'Bob');
    const dayA: DayPlan = { date: DATE, city: 'Kathmandu', country: 'nepal', items: a as ItineraryItem[] };
    const dayB: DayPlan = { date: DATE, city: 'Kathmandu', country: 'nepal', items: b as ItineraryItem[] };

    const ab = ids(mergeDay(dayA, dayB).items);
    const ba = ids(mergeDay(dayB, dayA).items);
    expect(ab).toEqual(ba); // commutative — both devices land on the same array
    expect(ab).toEqual(['b', 'c', 'a']); // the later reorder wins wholesale
    // idempotent: re-applying a merged snapshot changes nothing
    expect(ids(mergeDay(dayA, mergeDay(dayA, dayB)).items)).toEqual(ab);
  });

  it('two reorders inside ONE millisecond still converge — on an order that may be neither', () => {
    // The case the test above deliberately does not cover: same `pt`, so each device numbers its
    // own order `ct = 0,1,2` and the per-`id` maxima interleave. What is guaranteed is agreement,
    // not "the later reorder wins" — there is no later one. So assert convergence and nothing
    // about WHICH order, because the merged answer here is genuinely neither device's.
    const PT = 1_700_000_005_000;
    const a = reorderSyncStamps(pick(rows(), ['c', 'a', 'b']), PT, 'Ann');
    const b = reorderSyncStamps(pick(rows(), ['b', 'c', 'a']), PT, 'Bob');
    const dayA: DayPlan = { date: DATE, city: 'Kathmandu', country: 'nepal', items: a as ItineraryItem[] };
    const dayB: DayPlan = { date: DATE, city: 'Kathmandu', country: 'nepal', items: b as ItineraryItem[] };

    const ab = ids(mergeDay(dayA, dayB).items);
    const ba = ids(mergeDay(dayB, dayA).items);
    expect(ab).toEqual(ba); // commutative — the two devices agree, which is the whole guarantee
    expect(ids(mergeDay(dayA, mergeDay(dayA, dayB)).items)).toEqual(ab); // idempotent
    expect(ids(mergeDay(dayB, mergeDay(dayB, dayA)).items)).toEqual(ab);
    expect([...ab].sort()).toEqual(['a', 'b', 'c']); // no row lost or duplicated
    // and the documented surprise, pinned so nobody re-asserts "the later reorder wins" here:
    expect(ab).not.toEqual(byId(a));
    expect(ab).not.toEqual(byId(b));
  });

  it('a same-hlc set (items added inside one millisecond) still gets a strict order', () => {
    const tied: Row[] = ['a', 'b', 'c'].map((id) => ({
      id,
      title: id,
      hlc: '001700000001000:000000:Powan',
      rev: 1,
    }));
    const out = reorderSyncStamps([tied[2], tied[0], tied[1]], 1_700_000_001_000, 'Powan');
    expect(byId(out)).toEqual(['c', 'a', 'b']);
    expect(out[0].ord! < out[1].ord! && out[1].ord! < out[2].ord!).toBe(true);
  });
});

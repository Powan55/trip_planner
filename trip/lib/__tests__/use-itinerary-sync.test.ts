// @vitest-environment jsdom
//
// S97 — WIRED-behavior unit suite for the Sync v2 store changes in hooks/use-itinerary.ts,
// exercised by RENDERING the real hook (a tiny renderHook shim over react-dom/client + act —
// no new dependency). Two regimes are proven on a real run, and the CONTRAST between them is
// the whole point of the D-038 dormant-build byte-identity gate:
//
//   SYNC ON  (isRemoteConfigured() === true):
//     - addItem stamps rev=1 + a serialized hlc; updateItem bumps rev + advances hlc.
//     - removeItem writes a TOMBSTONE (deleted:true) in localStorage instead of physically
//       removing, but the EXPOSED `plans` filters it so the UI sees the item gone.
//     - delete-ALL leaves tombstones on disk yet exposes EMPTY plans, and after a reload the
//       exposed plans are STILL empty — the sample never resurrects (D-018/D-091).
//
//   DORMANT (isRemoteConfigured() === false):
//     - removeItem PHYSICALLY removes (no tombstone); NO rev/hlc is ever stamped, so the
//       on-disk bytes are exactly today's — the dormant portfolio build is byte-for-byte
//       unchanged (D-038) and the S81 persistence pack + D-018 hold verbatim.
//
// D-026 (the exposed-plans filter is the ONLY selector change — consumers untouched), D-018/
// D-091 (delete-all-stays-empty, tombstones never resurrect the sample), D-038 (dormant gate),
// D-041 (rev/hlc ride alongside attribution) are all cited.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { ItineraryStore } from '@/hooks/use-itinerary';
import type { DayPlan } from '@/lib/trip-data';

// A controllable config gate: the hook reads isRemoteConfigured() through this mock. Flip
// `remoteOn` per-suite to exercise the sync-on vs dormant branches on the REAL hook.
const state = vi.hoisted(() => ({ remoteOn: false }));
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => state.remoteOn,
  // #10: mirrors isRemoteConfigured — every mocked getTripId here is non-empty, so the two gates agree.
  isTripRemoteConfigured: () => state.remoteOn,
  getTripId: () => 'nepal-japan-2026',
}));
// Never let the sync fan-out touch firebase in this unit suite: stub the SyncPort to no-ops.
// (The push/subscribe wiring is covered by itinerary-remote-sync.test.ts against a fake
// Firestore; here we only exercise the STORE's local stamping/tombstone/filter behavior.)
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
// A signed-in traveler so syncActor() is a real distinct id (drives the hlc actor).
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }) };
});

import { useItinerary } from '@/hooks/use-itinerary';
import { ITINERARY_STORAGE_KEY, savePlans } from '@/lib/itinerary-storage';

// ── Minimal renderHook over react-dom/client + act (no @testing-library dep). Renders a probe
//    component that captures the hook's latest return into `ref.current`, and exposes an
//    `act`-wrapped `run` to drive mutators + flush effects. ────────────────────────────────
interface HookHandle {
  current: ItineraryStore;
  run: (fn: (store: ItineraryStore) => void) => Promise<void>;
  rerenderFresh: () => Promise<void>; // unmount + remount = a "reload" (re-reads localStorage)
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

  const handle: HookHandle = {
    get current() {
      return ref.current;
    },
    async run(fn) {
      await act(async () => {
        fn(ref.current);
        // let the commit's setState + dispatch + the reread effect settle.
        await Promise.resolve();
      });
    },
    async rerenderFresh() {
      act(() => root.unmount());
      root = createRoot(container);
      act(() => {
        root.render(createElement(Probe));
      });
      // hydrate effect (useEffect load) runs on mount.
      await act(async () => {
        await Promise.resolve();
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
  return handle;
}

// A Japan-leg date with NO sample-itinerary items, so the store starts EMPTY for this date
// (we also seed an explicit empty itinerary in beforeEach → key present, no sample reseed).
const TEST_DATE = '2027-01-05';

// Read the RAW on-disk plans (with tombstones) straight from localStorage, bypassing the
// exposed filter, to prove what physically persists.
function rawOnDisk(): DayPlan[] {
  const blob = localStorage.getItem(ITINERARY_STORAGE_KEY);
  if (!blob) return [];
  const parsed = JSON.parse(blob);
  // Vault envelope { schemaVersion, updatedAt, payload } OR a legacy bare array.
  return Array.isArray(parsed) ? parsed : parsed.payload;
}

function dayItems(plans: DayPlan[], date: string) {
  return plans.find((d) => d.date === date)?.items ?? [];
}

beforeEach(() => {
  localStorage.clear();
  // Seed an explicit EMPTY itinerary (key present → the store loads [] and never reseeds the
  // sample). This isolates the wired stamping/tombstone/filter behavior from sample data.
  savePlans([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SYNC ON — rev/hlc stamping + tombstone removeItem + exposed-plans filter', () => {
  beforeEach(() => {
    state.remoteOn = true;
  });

  it('addItem stamps rev=1 and a serialized hlc; updateItem bumps rev and advances hlc', async () => {
    const h = renderItinerary();
    await h.run((s) => s.addItem(TEST_DATE, { id: 'x', title: 'Temple', category: 'cultural' }));

    let it = dayItems(h.current.plans, TEST_DATE).find((i) => i.id === 'x')!;
    expect(it.rev).toBe(1);
    expect(typeof it.hlc).toBe('string');
    expect(it.hlc!.length).toBeGreaterThan(0);
    const firstHlc = it.hlc!;

    await h.run((s) => s.updateItem(TEST_DATE, 'x', { title: 'Temple (edited)' }));
    it = dayItems(h.current.plans, TEST_DATE).find((i) => i.id === 'x')!;
    expect(it.rev).toBe(2); // bumped
    expect(it.hlc! > firstHlc).toBe(true); // hlc strictly advanced (monotonic)
    h.unmount();
  });

  it('removeItem writes a TOMBSTONE on disk but the EXPOSED plans hide it (D-026)', async () => {
    const h = renderItinerary();
    await h.run((s) => {
      s.addItem(TEST_DATE, { id: 'a', title: 'A', category: 'food' });
      s.addItem(TEST_DATE, { id: 'b', title: 'B', category: 'food' });
    });
    await h.run((s) => s.removeItem(TEST_DATE, 'a'));

    // Exposed plans: only the live item 'b' — the UI sees a normal delete.
    expect(dayItems(h.current.plans, TEST_DATE).map((i) => i.id)).toEqual(['b']);
    // On disk: 'a' RETAINED as a tombstone (deleted:true) so the delete can propagate + win.
    const rawA = dayItems(rawOnDisk(), TEST_DATE).find((i) => i.id === 'a');
    expect(rawA?.deleted).toBe(true);
    expect(rawA?.rev).toBe(2); // delete bumped the rev
    h.unmount();
  });

  it('delete-ALL leaves tombstones on disk yet exposes EMPTY plans, and STAYS empty after reload (D-018/D-091)', async () => {
    const h = renderItinerary();
    await h.run((s) => {
      s.addItem(TEST_DATE, { id: 'a', title: 'A', category: 'food' });
      s.addItem(TEST_DATE, { id: 'b', title: 'B', category: 'food' });
    });
    await h.run((s) => {
      s.removeItem(TEST_DATE, 'a');
      s.removeItem(TEST_DATE, 'b');
    });

    // Exposed: the day has NO live items.
    expect(dayItems(h.current.plans, TEST_DATE)).toEqual([]);
    // On disk: two tombstones retained (they must propagate the deletes).
    const rawDay = dayItems(rawOnDisk(), TEST_DATE);
    expect(rawDay.filter((i) => i.deleted === true).map((i) => i.id).sort()).toEqual(['a', 'b']);

    // RELOAD (fresh mount, re-reads localStorage): exposed plans still show NO live items on
    // that day — the tombstones did NOT resurrect and the sample was NOT reseeded (key present).
    await h.rerenderFresh();
    expect(dayItems(h.current.plans, TEST_DATE)).toEqual([]);
    h.unmount();
  });
});

describe('DORMANT — no stamping, physical remove, byte-for-byte today (D-038)', () => {
  beforeEach(() => {
    state.remoteOn = false;
  });

  it('addItem stamps NO rev/hlc (dormant items are byte-identical to today)', async () => {
    const h = renderItinerary();
    await h.run((s) => s.addItem(TEST_DATE, { id: 'x', title: 'Temple', category: 'cultural' }));
    const it = dayItems(h.current.plans, TEST_DATE).find((i) => i.id === 'x')!;
    expect(it).not.toHaveProperty('rev');
    expect(it).not.toHaveProperty('hlc');
    expect(it).not.toHaveProperty('deleted');
    // On disk too — no sync fields anywhere.
    const rawIt = dayItems(rawOnDisk(), TEST_DATE).find((i) => i.id === 'x')!;
    expect(rawIt).toEqual({ id: 'x', title: 'Temple', category: 'cultural' });
    h.unmount();
  });

  it('removeItem PHYSICALLY removes (no tombstone) — exactly today; delete-all stays empty on reload', async () => {
    const h = renderItinerary();
    await h.run((s) => {
      s.addItem(TEST_DATE, { id: 'a', title: 'A', category: 'food' });
      s.addItem(TEST_DATE, { id: 'b', title: 'B', category: 'food' });
    });
    await h.run((s) => s.removeItem(TEST_DATE, 'a'));

    // Physically gone from BOTH exposed and disk — no tombstone.
    expect(dayItems(h.current.plans, TEST_DATE).map((i) => i.id)).toEqual(['b']);
    const rawDay = dayItems(rawOnDisk(), TEST_DATE);
    expect(rawDay.map((i) => i.id)).toEqual(['b']); // 'a' is truly gone, no deleted:true ghost
    expect(rawDay.some((i) => 'deleted' in i)).toBe(false);

    // delete the rest → empty day, survives reload (the S81/D-018 guarantee, unchanged).
    await h.run((s) => s.removeItem(TEST_DATE, 'b'));
    expect(dayItems(rawOnDisk(), TEST_DATE)).toEqual([]);
    await h.rerenderFresh();
    expect(dayItems(h.current.plans, TEST_DATE)).toEqual([]);
    h.unmount();
  });
});

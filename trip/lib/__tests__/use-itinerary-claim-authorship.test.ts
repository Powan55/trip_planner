// @vitest-environment jsdom
//
// S396 (Q3) — `claimAuthorship` in hooks/use-itinerary.ts: the owner-initiated rewrite of stored
// attribution from a name he used to go by onto his current one. Exercised by RENDERING the real
// hook (the same renderHook shim the sibling use-itinerary-*-sync suites use — no new dependency)
// and reading the result back through the StoragePort, i.e. what a reload would show.
//
// What is pinned here:
//   - ALL THREE author fields are rewritten (`createdBy` / `updatedBy` / `doneBy`) — `itemAuthors`
//     in lib/author-filter.ts reads exactly those three, and a missing `doneBy` was the S390-B bug.
//   - Per FIELD, not per item: an item where only `doneBy` matches keeps its other authors.
//   - Items stamped with anybody else's name are untouched.
//   - 🔴 `updatedAt` is PRESERVED. components/activity-feed.tsx derives "Recent changes" from
//     `updatedBy` + `updatedAt` and sorts on the timestamp alone, so re-stamping it would dump
//     every claimed item to the top of the feed and date an old edit to now. This assertion is
//     the guard on that deliberate choice.
//   - ONE commit → ONE SyncPort push (D-088), with rev/hlc advanced under sync so the rewrite
//     wins the LWW resolve instead of being unwound by the next snapshot.
//   - The loud no-op cases return 0 and write nothing.
//
// OUT OF SCOPE, deliberately and stated here so the gap is not mistaken for coverage: `Expense`
// (createdBy/updatedBy/paidBy/split[]) and `DocItem.updatedBy` carry the same names and have no
// equivalent mechanism. They are NOT rewritten.

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

import { useItinerary } from '@/hooks/use-itinerary';
import { ITINERARY_STORAGE_KEY, savePlans } from '@/lib/itinerary-storage';
import { setUserName } from '@/lib/identity';

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

const DATE = '2026-12-20';
const OLD = 'Traveler'; // the login placeholder AND, ambiguously, the owner's pre-rename name
const ME = 'Powan';
const STAMP = '2026-12-01T08:00:00.000Z';

/** Seeded stamps written straight to disk, so the test controls them exactly. */
function seed(): DayPlan[] {
  const items: ItineraryItem[] = [
    // Fully the old name: all three fields must flip.
    {
      id: 'all-three',
      title: 'Boudhanath Stupa',
      category: 'sightseeing',
      createdBy: OLD,
      updatedBy: OLD,
      updatedAt: STAMP,
      doneBy: OLD,
      doneAt: STAMP,
      done: true,
    },
    // Only `doneBy` matches — the S390-B field. The other two belong to somebody else and stay.
    {
      id: 'done-only',
      title: 'Thamel walk',
      category: 'sightseeing',
      createdBy: 'Sushil',
      updatedBy: 'Sushil',
      updatedAt: STAMP,
      doneBy: OLD,
      done: true,
    },
    // Nobody else's item may be touched.
    {
      id: 'other',
      title: 'Momo crawl',
      category: 'food',
      createdBy: 'Uttam',
      updatedBy: 'Uttam',
      updatedAt: STAMP,
    },
    // A tombstone stamped with the old name: invisible to the filter, the feed and the count the
    // user approved, so it must be skipped (and must not be resurrected or re-stamped).
    {
      id: 'dead',
      title: 'Cancelled trek',
      category: 'sightseeing',
      createdBy: OLD,
      updatedBy: OLD,
      updatedAt: STAMP,
      deleted: true,
      rev: 2,
      hlc: '2026-12-01T08:00:00.000Z-0000-x',
    },
  ];
  return [{ date: DATE, city: 'Kathmandu', country: 'nepal', items }];
}

function rawOnDisk(): DayPlan[] {
  const blob = localStorage.getItem(ITINERARY_STORAGE_KEY);
  if (!blob) return [];
  const parsed = JSON.parse(blob);
  return Array.isArray(parsed) ? parsed : parsed.payload;
}
function stored(id: string): ItineraryItem | undefined {
  return (rawOnDisk().find((d) => d.date === DATE)?.items ?? []).find((i) => i.id === id);
}

beforeEach(() => {
  localStorage.clear();
  setUserName(ME); // the rename already happened; this is who he is now
  savePlans(seed());
  state.pushCalls = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('claimAuthorship — SYNC ON (S396 Q3)', () => {
  beforeEach(() => {
    state.remoteOn = true;
  });

  it('rewrites ALL THREE author fields on matching items, per field, leaving everyone else alone', async () => {
    const h = renderItinerary();
    let claimed = -1;
    await h.run((s) => {
      claimed = s.claimAuthorship(OLD);
    });

    // Two LIVE items carry the old name (the tombstone is skipped) — the number the user approved.
    expect(claimed).toBe(2);

    const all = stored('all-three');
    expect(all?.createdBy).toBe(ME);
    expect(all?.updatedBy).toBe(ME);
    expect(all?.doneBy).toBe(ME);

    // Per FIELD: only `doneBy` matched, so Sushil keeps the authorship that is genuinely his.
    const doneOnly = stored('done-only');
    expect(doneOnly?.doneBy).toBe(ME);
    expect(doneOnly?.createdBy).toBe('Sushil');
    expect(doneOnly?.updatedBy).toBe('Sushil');

    // Untouched, byte for byte.
    expect(stored('other')).toEqual(seed()[0].items[2]);

    // The tombstone is skipped entirely — not rewritten, not revived, not re-stamped.
    const dead = stored('dead');
    expect(dead?.deleted).toBe(true);
    expect(dead?.updatedBy).toBe(OLD);
    expect(dead?.rev).toBe(2);
    h.unmount();
  });

  it('PRESERVES updatedAt / doneAt so the claim never floats old items to the top of the activity feed', async () => {
    const h = renderItinerary();
    await h.run((s) => s.claimAuthorship(OLD));

    // components/activity-feed.tsx sorts strictly on `updatedAt`; re-stamping it here would
    // reorder "Recent changes" and misdate every claimed edit.
    expect(stored('all-three')?.updatedAt).toBe(STAMP);
    expect(stored('all-three')?.doneAt).toBe(STAMP);
    expect(stored('done-only')?.updatedAt).toBe(STAMP);
    h.unmount();
  });

  it('is ONE commit → ONE push, and advances rev/hlc so the rewrite survives the next merge', async () => {
    const h = renderItinerary();
    await h.run((s) => s.claimAuthorship(OLD));

    expect(state.pushCalls).toHaveLength(1);
    // Both rewritten items carry a fresh ordering stamp (they had none on disk → rev 1+1).
    for (const id of ['all-three', 'done-only']) {
      expect(stored(id)?.rev).toBe(2);
      expect(typeof stored(id)?.hlc).toBe('string');
    }
    h.unmount();
  });

  it('refuses the no-op cases: your own current name, and a name nobody is stamped with', async () => {
    const h = renderItinerary();
    let own = -1;
    let unknown = -1;
    let blank = -1;
    await h.run((s) => {
      own = s.claimAuthorship(ME);
      unknown = s.claimAuthorship('Nobody');
      blank = s.claimAuthorship('   ');
    });
    expect([own, unknown, blank]).toEqual([0, 0, 0]);
    // Nothing was written at all.
    expect(state.pushCalls).toHaveLength(0);
    expect(rawOnDisk()).toEqual(seed());
    h.unmount();
  });
});

describe('claimAuthorship — DORMANT (S396 Q3, D-038)', () => {
  beforeEach(() => {
    state.remoteOn = false;
  });

  it('rewrites the names with NO rev/hlc/deleted stamped anywhere', async () => {
    const h = renderItinerary();
    let claimed = -1;
    await h.run((s) => {
      claimed = s.claimAuthorship(OLD);
    });
    expect(claimed).toBe(2);
    expect(stored('all-three')?.createdBy).toBe(ME);
    expect(stored('done-only')?.doneBy).toBe(ME);
    expect(stored('all-three')).not.toHaveProperty('rev');
    expect(stored('all-three')).not.toHaveProperty('hlc');
    expect(stored('all-three')).not.toHaveProperty('deleted');
    h.unmount();
  });
});

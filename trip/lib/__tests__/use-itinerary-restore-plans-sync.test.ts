// @vitest-environment jsdom
//
// S145 — regression suite for whole-trip RESTORE under sync (`restorePlans`, D-156 — supersedes the
// D-121 local-only disable, FU-20). A Backup Restore is expressed as a TOMBSTONE-REPLACE MERGE (not
// an ingest-overwrite the next snapshot would unwind): tombstone every currently-live item, re-add
// the backup's items as FRESH-ID copies, all in ONE commit through the normal push fan-out. Proves
// the MERGE MECHANICS at the unit level (the real cross-client "Restore converges" is
// emulator-gated). Exercised by RENDERING the real hook (the same renderHook shim as
// use-itinerary-restore-sync.test.ts — no new dep).
//
// Proven on a real run (SYNC ON):
//   - tombstone-replace: after restore, the backup's items are LIVE (fresh ids) and every prior live
//     item is a tombstone; a day the backup omits/empties ends up empty (D-018/D-091, no reseed).
//   - a concurrent peer edit with a STRICTLY-LATER hlc SURVIVES the next merge (restore is not a
//     blind clobber).
//   - a peer that still holds the old items LIVE does NOT resurrect them (the restore's tombstones
//     win — older-hlc live loses).
//   - NON-VACUOUS: the fresh-id/fresh-stamp is load-bearing — a same-id-same-hlc "restore" (the WRONG
//     design) is re-killed by the tombstone bias, while the real fresh-id copy survives.
// DORMANT: restorePlans is a plain local overwrite (byte-identical to the local path's savePlans).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { ItineraryStore } from '@/hooks/use-itinerary';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';

const state = vi.hoisted(() => ({ remoteOn: false }));
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
      push: async () => {},
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
import { mergeDays } from '@/core/sync/merge-day';
import { parse } from '@/core/sync/hlc';
import { nextSyncStamp } from '@/core/sync/stamp';

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
  act(() => root.render(createElement(Probe)));
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

const D1 = '2027-01-05';
const D2 = '2027-01-06';

function rawOnDisk(): DayPlan[] {
  const blob = localStorage.getItem(ITINERARY_STORAGE_KEY);
  if (!blob) return [];
  const parsed = JSON.parse(blob);
  return Array.isArray(parsed) ? parsed : parsed.payload;
}
function rawDay(date: string): ItineraryItem[] {
  return rawOnDisk().find((d) => d.date === date)?.items ?? [];
}
function exposed(store: ItineraryStore, date: string): ItineraryItem[] {
  return store.plans.find((d) => d.date === date)?.items ?? [];
}
function day(date: string, items: ItineraryItem[]): DayPlan {
  return { date, city: '', country: 'nepal', items };
}

beforeEach(() => {
  localStorage.clear();
  savePlans([]); // key present → the store never reseeds the sample.
});
afterEach(() => vi.restoreAllMocks());

describe('SYNC ON — restorePlans is a tombstone-replace merge (S145, D-156)', () => {
  beforeEach(() => {
    state.remoteOn = true;
  });

  it('backup WINS: its items become live (fresh ids), prior live items tombstoned, omitted day emptied', async () => {
    const h = renderItinerary();
    await h.run((s) => s.addItem(D1, { id: 'a', title: 'A', category: 'food' }));
    await h.run((s) => s.addItem(D1, { id: 'b', title: 'B', category: 'food' }));
    await h.run((s) => s.addItem(D2, { id: 'c', title: 'C', category: 'food' }));

    // Restore a backup that has D1 = {X, Y} and NO D2.
    const backup: DayPlan[] = [
      day(D1, [
        { id: 'x', title: 'X', category: 'cultural', sourceId: 'src-x' },
        { id: 'y', title: 'Y', category: 'cultural' },
      ]),
    ];
    await h.run((s) => s.restorePlans(backup));

    // Exposed: D1 shows exactly the backup's two items (fresh ids), D2 is empty.
    const d1 = exposed(h.current, D1);
    expect(d1.map((i) => i.title)).toEqual(['X', 'Y']);
    expect(d1.map((i) => i.id).sort()).not.toContain('a');
    expect(d1.map((i) => i.id).sort()).not.toContain('b');
    expect(d1.every((i) => i.rev === 1 && typeof i.hlc === 'string' && i.deleted === undefined)).toBe(true);
    expect(d1.find((i) => i.title === 'X')?.sourceId).toBe('src-x'); // content preserved
    expect(exposed(h.current, D2)).toEqual([]); // omitted day → emptied (tombstoned)

    // Raw: a & b are tombstones on D1, c is a tombstone on D2.
    expect(rawDay(D1).find((i) => i.id === 'a')?.deleted).toBe(true);
    expect(rawDay(D1).find((i) => i.id === 'b')?.deleted).toBe(true);
    expect(rawDay(D2).find((i) => i.id === 'c')?.deleted).toBe(true);
    expect(rawDay(D2).some((i) => i.deleted !== true)).toBe(false);
    h.unmount();
  });

  it('a concurrent peer edit with a STRICTLY-LATER hlc survives the next merge (not a blind clobber)', async () => {
    const h = renderItinerary();
    await h.run((s) => s.addItem(D1, { id: 'a', title: 'A', category: 'food' }));
    await h.run((s) => s.restorePlans([])); // restore-to-empty → 'a' tombstoned

    const tomb = rawDay(D1).find((i) => i.id === 'a')!;
    expect(tomb.deleted).toBe(true);

    // A peer edited 'a' concurrently with an hlc STRICTLY LATER than the restore's tombstone.
    const laterPt = parse(tomb.hlc!).pt + 1000;
    const peerEdit: ItineraryItem = {
      ...tomb,
      deleted: false,
      title: 'Peer edit',
      ...nextSyncStamp(tomb, laterPt, 'peer'),
    };
    const merged = mergeDays(rawOnDisk(), [day(D1, [peerEdit])]).find((d) => d.date === D1)!.items;
    const survivor = merged.find((i) => i.id === 'a')!;
    expect(survivor.deleted).not.toBe(true); // resurrected by the strictly-later peer edit
    expect(survivor.title).toBe('Peer edit');
    h.unmount();
  });

  it('restore-to-empty STAYS empty — a peer still holding the items live does not resurrect them', async () => {
    const h = renderItinerary();
    await h.run((s) => s.addItem(D1, { id: 'a', title: 'A', category: 'food' }));
    await h.run((s) => s.addItem(D1, { id: 'b', title: 'B', category: 'food' }));

    // A peer snapshot captured BEFORE the restore — still has a, b LIVE (their original, older hlc).
    const peerStillLive: DayPlan[] = JSON.parse(JSON.stringify(rawOnDisk()));

    await h.run((s) => s.restorePlans([])); // empty backup → tombstone everything
    expect(exposed(h.current, D1)).toEqual([]);

    // The restore's fresh-hlc tombstones beat the peer's older-hlc live copies → stays empty.
    const merged = mergeDays(rawOnDisk(), peerStillLive).find((d) => d.date === D1)!.items;
    expect(merged.some((i) => i.deleted !== true)).toBe(false);
    h.unmount();
  });

  it('NON-VACUOUS: fresh-id restore survives an existing remote tombstone; a same-id-same-hlc restore would be re-killed', async () => {
    const h = renderItinerary();
    await h.run((s) => s.addItem(D1, { id: 'a', title: 'A', category: 'food' }));
    // Backup carries an item with the SAME id 'a' (freshCopyOf will strip it to a NEW id).
    await h.run((s) => s.restorePlans([day(D1, [{ id: 'a', title: 'Restored', category: 'cultural' }])]));

    // The restore left: 'a' tombstoned + one FRESH-id live copy titled 'Restored'.
    const restoredLive = rawDay(D1).filter((i) => i.deleted !== true);
    expect(restoredLive).toHaveLength(1);
    expect(restoredLive[0].id).not.toBe('a');
    expect(restoredLive[0].title).toBe('Restored');

    // A peer that ALSO deleted 'a' (remote tombstone for id 'a'). The fresh-id copy has no peer
    // counterpart → survives; the ORIGINAL id stays dead.
    const remoteTombOfA: ItineraryItem = { ...rawDay(D1).find((i) => i.id === 'a')! };
    const merged = mergeDays(rawOnDisk(), [day(D1, [remoteTombOfA])]).find((d) => d.date === D1)!.items;
    const live = merged.filter((i) => i.deleted !== true);
    expect(live).toHaveLength(1);
    expect(live[0].title).toBe('Restored');

    // Counterfactual (the WRONG design): had the restore re-used id 'a' with the tombstone's own
    // hlc, resolvePair's tombstone bias on an HLC tie would RE-KILL it — proving fresh-id is load-bearing.
    const tomb = rawDay(D1).find((i) => i.id === 'a')!;
    const sameIdRestore: ItineraryItem = { ...tomb, deleted: false, title: 'Restored' };
    const wrong = mergeDays([day(D1, [sameIdRestore])], [day(D1, [tomb])]).find((d) => d.date === D1)!.items;
    expect(wrong.filter((i) => i.deleted !== true)).toHaveLength(0); // re-killed
    h.unmount();
  });
});

describe('DORMANT — restorePlans is a plain local overwrite (S145, D-038 byte-identity)', () => {
  beforeEach(() => {
    state.remoteOn = false;
  });

  it('overwrites the trip with the backup verbatim, with NO sync fields stamped', async () => {
    const h = renderItinerary();
    await h.run((s) => s.addItem(D1, { id: 'old', title: 'Old', category: 'food' }));

    const backup: DayPlan[] = [day(D2, [{ id: 'z', title: 'Z', category: 'cultural' }])];
    await h.run((s) => s.restorePlans(backup));

    // On disk == the backup, no tombstone for the old day, no rev/hlc/deleted anywhere.
    expect(rawOnDisk()).toEqual(backup);
    for (const d of rawOnDisk()) {
      for (const it of d.items) {
        expect(it).not.toHaveProperty('rev');
        expect(it).not.toHaveProperty('hlc');
        expect(it).not.toHaveProperty('deleted');
      }
    }
    expect(exposed(h.current, D2).map((i) => i.id)).toEqual(['z']);
    h.unmount();
  });
});

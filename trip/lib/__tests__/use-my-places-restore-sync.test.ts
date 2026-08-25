// @vitest-environment jsdom
//
// Issue #239, myPlaces half — regression suite for whole-store places RESTORE under sync
// (`restoreMyPlaces`, mirroring `use-expenses-restore-sync.test.ts`'s `restoreExpenses` proof and
// `use-itinerary-restore-plans-sync.test.ts`'s `restorePlans` proof, over the FLAT places row-set).
// Exercised by RENDERING the real hook (the same renderHook shim — no new dep).
//
// Proven on a real run (SYNC ON):
//   - the headline case: a row ADDED AFTER the backup was taken does not survive `restoreMyPlaces` —
//     it is tombstoned, not silently merged back in by the next snapshot.
//   - tombstone-replace: after restore, the backup's rows are LIVE (fresh ids) and every prior live
//     row is a tombstone.
//   - a peer that still holds an old row LIVE does not resurrect it (the restore's tombstone wins).
// DORMANT: restoreMyPlaces is a plain local overwrite (byte-identical, no sync fields stamped).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { MyPlacesStore } from '@/hooks/use-my-places';
import type { MyPlace } from '@/core/places/model';

const state = vi.hoisted(() => ({ remoteOn: false }));
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => state.remoteOn,
  isTripRemoteConfigured: () => state.remoteOn,
  getTripId: () => 'nepal-japan-2026',
}));
vi.mock('@/lib/places-ports', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/places-ports')>();
  return {
    ...orig,
    placesSyncPort: {
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

import { useMyPlaces } from '@/hooks/use-my-places';
import { mergeItems } from '@/core/sync/merge-items';

const KEY = 'nepal_japan_my_places';

interface HookHandle {
  current: MyPlacesStore;
  run: (fn: (store: MyPlacesStore) => void) => Promise<void>;
  unmount: () => void;
}

function renderMyPlaces(): HookHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const ref: { current: MyPlacesStore } = { current: null as unknown as MyPlacesStore };
  function Probe() {
    ref.current = useMyPlaces();
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

function rawOnDisk(): MyPlace[] {
  const blob = localStorage.getItem(KEY);
  if (!blob) return [];
  const parsed = JSON.parse(blob);
  return Array.isArray(parsed) ? parsed : [];
}

const backupRow = (id: string, name: string): MyPlace => ({
  id,
  name,
  legId: 'nepal',
  addedAt: '2026-12-10T00:00:00.000Z',
});

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('SYNC ON — restoreMyPlaces is a tombstone-replace merge (issue #239)', () => {
  beforeEach(() => {
    state.remoteOn = true;
  });

  it('a row added AFTER the backup was taken does not survive restore — tombstoned, not merged back', async () => {
    const h = renderMyPlaces();
    await h.run((s) => s.addPlace({ name: 'Old place', legId: 'nepal' }));
    // Snapshot the store "as of backup time" — before the later add below.
    const backup: MyPlace[] = JSON.parse(JSON.stringify(rawOnDisk()));

    // A row added AFTER the backup was taken.
    await h.run((s) => s.addPlace({ name: 'Added after backup', legId: 'japan' }));
    expect(h.current.places).toHaveLength(2);

    await h.run((s) => s.restoreMyPlaces(backup));

    // The restore replaced the store: only the backup's content is live.
    expect(h.current.places.map((p) => p.name)).toEqual(['Old place']);

    // Root-cause proof: the row added after the backup is a TOMBSTONE on disk, not merely absent —
    // so a peer that still has it live cannot resurrect it on the next merge.
    const addedRow = rawOnDisk().find((p) => p.name === 'Added after backup');
    expect(addedRow?.deleted).toBe(true);

    const peerStillHoldingIt: MyPlace = { ...addedRow!, deleted: false };
    const merged = mergeItems(rawOnDisk(), [peerStillHoldingIt]);
    expect(merged.find((p) => p.name === 'Added after backup')?.deleted).toBe(true);
  });

  it('backup WINS: its rows become live (fresh ids), prior live rows tombstoned', async () => {
    const h = renderMyPlaces();
    await h.run((s) => s.addPlace({ name: 'A', legId: 'nepal' }));
    await h.run((s) => s.addPlace({ name: 'B', legId: 'japan' }));
    const priorIds = h.current.places.map((p) => p.id);
    expect(priorIds).toHaveLength(2);

    const backup: MyPlace[] = [backupRow('x', 'X'), backupRow('y', 'Y')];
    await h.run((s) => s.restoreMyPlaces(backup));

    expect(h.current.places.map((p) => p.name).sort()).toEqual(['X', 'Y']);
    expect(h.current.places.every((p) => !priorIds.includes(p.id))).toBe(true);
    expect(h.current.places.every((p) => p.rev === 1 && typeof p.hlc === 'string')).toBe(true);

    const raw = rawOnDisk();
    for (const id of priorIds) {
      expect(raw.find((p) => p.id === id)?.deleted).toBe(true);
    }
    h.unmount();
  });

  it('restore-to-empty STAYS empty — a peer still holding a row live does not resurrect it', async () => {
    const h = renderMyPlaces();
    await h.run((s) => s.addPlace({ name: 'A', legId: 'nepal' }));
    const peerStillLive: MyPlace[] = JSON.parse(JSON.stringify(rawOnDisk()));

    await h.run((s) => s.restoreMyPlaces([]));
    expect(h.current.places).toEqual([]);

    const merged = mergeItems(rawOnDisk(), peerStillLive);
    expect(merged.some((p) => p.deleted !== true)).toBe(false);
    h.unmount();
  });
});

describe('DORMANT — restoreMyPlaces is a plain local overwrite (byte-identity)', () => {
  beforeEach(() => {
    state.remoteOn = false;
  });

  it('overwrites the store with the backup verbatim, with NO sync fields stamped', async () => {
    const h = renderMyPlaces();
    await h.run((s) => s.addPlace({ name: 'A', legId: 'nepal' }));

    const backup: MyPlace[] = [backupRow('z', 'Z')];
    await h.run((s) => s.restoreMyPlaces(backup));

    expect(rawOnDisk()).toEqual(backup);
    for (const p of rawOnDisk()) {
      expect(p).not.toHaveProperty('rev');
      expect(p).not.toHaveProperty('hlc');
      expect(p).not.toHaveProperty('deleted');
    }
    expect(h.current.places.map((p) => p.id)).toEqual(['z']);
    h.unmount();
  });
});

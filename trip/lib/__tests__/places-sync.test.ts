// @vitest-environment jsdom
//
// Issue #17 (D-229 addendum) — WIRED-behavior suite for the My-Places sync seam
// (`lib/places-remote.ts` + `lib/places-ports.ts` + `hooks/use-my-places.ts`), against a FAKE
// Firestore (the firebase SDK modules are vi.mock'd) + the real merge core. This is the "the
// wiring is correct off a live server" proof the two-phone E2E cannot run in the dormant sandbox.
// Proves, on a real run:
//
//   1. `pushPlacesMerged` composes the transactional read→merge→set on
//      `trips/{tripId}/places/list`, in the `{version, items:[…]}` container the existing
//      `boundedWrite()` rule already bounds — so NO firestore.rules change ships with this.
//   2. A place imported on the OTHER phone is not clobbered: both survive (the issue's headline).
//   3. The hook's delete writes a TOMBSTONE under sync, the UI stops showing it, and a peer's
//      stale live copy cannot resurrect it (crux 1, end to end through the real store).
//   4. Undo-of-delete still restores the place — including in the SAME millisecond as the delete,
//      which is the case a `firstSyncStamp` re-add would silently lose to the tombstone.
//   5. The new 'places' domain rides the existing outbox with no bespoke retry.
//   6. THE DEFAULT SAMPLE PACK (`getTripId() === ''`) STAYS LOCAL-ONLY: add + remove behave
//      exactly as before this slice (physical delete, no sync stamps), nothing is enqueued, no
//      Firestore write is attempted, and nothing throws.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { MyPlace } from '@/core/places/model';
import { mergePlaces } from '@/core/places/merge';

const CAP_TOKEN = 'cap-token-17';

// The active trip id is flipped per-describe so ONE file can cover both a synced custom trip and
// the local-only default pack. The three exports mirror the real module's composition exactly:
// `isTripRemoteConfigured() === isRemoteConfigured() && getTripId() !== ''`.
const { tripId } = vi.hoisted(() => ({ tripId: { value: 'cap-token-17' } }));
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => true,
  getTripId: () => tripId.value,
  isTripRemoteConfigured: () => tripId.value !== '',
}));
// The outbox-decorated push gates on an active traveler; mock one in.
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }) };
});

const DOC_PATH = `trips/${CAP_TOKEN}/places/list`;
type DocData = Record<string, unknown>;

class FakeFirestore {
  docs = new Map<string, DocData>();
  failWrites = false; // when true, tx.set throws → push rejects → outbox keeps the chunk dirty
  setDocData(path: string, data: DocData) {
    this.docs.set(path, JSON.parse(JSON.stringify(data)));
  }
}
const fake = new FakeFirestore();
const writeLog: string[] = [];

function pathOf(segments: string[]): string {
  return segments.join('/');
}

// `getRemote()` signs the device in anonymously before it resolves (the rules have an auth floor),
// so the auth module is faked here too — same shape as docs-remote-sync.test.ts.
vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: { uid: 'device-uid-fake', getIdToken: async () => 'fake-id-token' } }),
  onAuthStateChanged: (_auth: unknown, next: (u: unknown) => void) => {
    queueMicrotask(() => next(null));
    return () => {};
  },
  signInAnonymously: async () => ({ user: { uid: 'device-uid-fake' } }),
}));

vi.mock('firebase/app', () => ({
  initializeApp: () => ({ name: 'fake' }),
  getApps: () => [],
  getApp: () => ({ name: 'fake' }),
}));
vi.mock('firebase/firestore', () => ({
  getFirestore: () => fake,
  initializeFirestore: () => fake,
  persistentLocalCache: () => ({}),
  collection: (_db: unknown, ...segs: string[]) => ({ __type: 'collection', path: pathOf(segs) }),
  doc: (_db: unknown, ...segs: string[]) => ({ __type: 'doc', path: pathOf(segs) }),
  runTransaction: async (
    _db: unknown,
    update: (tx: {
      get: (ref: { path: string }) => Promise<{ exists: () => boolean; data: () => DocData | undefined }>;
      set: (ref: { path: string }, data: DocData) => void;
    }) => Promise<void>,
  ) => {
    const tx = {
      get: async (ref: { path: string }) => {
        const data = fake.docs.get(ref.path);
        return { exists: () => data !== undefined, data: () => data };
      },
      set: (ref: { path: string }, data: DocData) => {
        if (fake.failWrites) throw new Error('transport down');
        writeLog.push(`tx-set:${ref.path}`);
        fake.setDocData(ref.path, data);
      },
    };
    await update(tx);
  },
}));

import { pushPlacesMerged } from '@/lib/places-remote';
import { placesSyncPort } from '@/lib/places-ports';
import { outboxSnapshot } from '@/core/sync/outbox';
import { setActiveTripId, STORAGE_KEYS } from '@/core/storage/gateway';
import { useMyPlaces, type MyPlacesStore } from '@/hooks/use-my-places';
import type { Firestore } from 'firebase/firestore';
import * as fs from 'firebase/firestore';

function place(id: string, over: Partial<MyPlace> = {}): MyPlace {
  return {
    id,
    name: id,
    legId: 'main',
    addedAt: '2026-07-24T10:00:00.000Z',
    rev: 1,
    hlc: `000000000001000:000000:${id}`,
    ...over,
  };
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

// The same createRoot/act shim the other hook suites use (no @testing-library dependency).
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

/** The on-disk rows for the ACTIVE pack, straight from localStorage (byte-transport proof). */
function storedRows(key: string): MyPlace[] {
  return JSON.parse(window.localStorage.getItem(key) ?? '[]') as MyPlace[];
}

beforeEach(() => {
  localStorage.clear();
  fake.docs.clear();
  writeLog.length = 0;
  fake.failWrites = false;
  tripId.value = CAP_TOKEN;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('pushPlacesMerged — the transactional read→merge→set on trips/{id}/places/list', () => {
  it('a place imported on the OTHER phone is not clobbered (both survive)', async () => {
    fake.setDocData(DOC_PATH, {
      version: 1,
      items: [place('fushimi', { addedAt: '2026-07-20T10:00:00.000Z', hlc: '000000000002000:000000:phoneB' })],
    });
    await pushPlacesMerged(fake as unknown as Firestore, fs, [
      place('boudhanath', { addedAt: '2026-07-24T10:00:00.000Z', hlc: '000000000003000:000000:phoneA' }),
    ]);

    const written = fake.docs.get(DOC_PATH) as { version: number; items: MyPlace[] };
    expect(written.items.map((p) => p.id).sort()).toEqual(['boudhanath', 'fushimi']);
    expect(writeLog).toEqual([`tx-set:${DOC_PATH}`]);
  });

  it('writes the rules-compatible {version, items} container (no firestore.rules change needed)', async () => {
    await pushPlacesMerged(fake as unknown as Firestore, fs, [place('a')]);
    const written = fake.docs.get(DOC_PATH) as DocData;
    expect(Object.keys(written).sort()).toEqual(['items', 'version']);
    expect(written.version).toBe(1);
    expect(Array.isArray(written.items)).toBe(true);
  });

  it('a poison row from a peer does not wedge the outbox forever', async () => {
    // The remote array is UNTRUSTED bytes. A null/garbage element (an older build, or anything
    // else with write access) used to reach `mergePlaces`, which dereferences `p.hlc` and throws —
    // rejecting the transaction, leaving the 'list' chunk dirty, and retrying forever. One bad row
    // written once would have silently wedged this device's sync for good. `docToPlaceRows` now
    // sanitises at the read boundary, so the junk is dropped and the good rows still converge.
    fake.setDocData(DOC_PATH, {
      version: 1,
      items: [null, 'not-a-place', { noIdAtAll: true }, place('fushimi', { addedAt: '2026-07-20T10:00:00.000Z' })],
    });

    await expect(
      pushPlacesMerged(fake as unknown as Firestore, fs, [place('boudhanath', { addedAt: '2026-07-24T10:00:00.000Z' })]),
    ).resolves.not.toThrow();

    const written = fake.docs.get(DOC_PATH) as { items: MyPlace[] };
    expect(written.items.map((p) => p.id).sort()).toEqual(['boudhanath', 'fushimi']);
    expect(writeLog).toEqual([`tx-set:${DOC_PATH}`]);
  });

  it('a same-id collision converges by HLC, and matches what the pure merge predicts', async () => {
    const remote = place('cafe', { name: 'renamed on B', hlc: '000000000009000:000000:phoneB', rev: 2 });
    const local = place('cafe', { name: 'renamed on A', hlc: '000000000004000:000000:phoneA', rev: 2 });
    fake.setDocData(DOC_PATH, { version: 1, items: [remote] });
    await pushPlacesMerged(fake as unknown as Firestore, fs, [local]);
    const written = fake.docs.get(DOC_PATH) as { items: MyPlace[] };
    expect(written.items).toHaveLength(1);
    expect(written.items[0].name).toBe('renamed on B');
    expect(written.items[0].name).toBe(mergePlaces([remote], [local], Date.now())[0].name);
  });
});

describe('the hook under sync — delete is a TOMBSTONE (crux 1, end to end)', () => {
  const KEY = `trip:${CAP_TOKEN}:myPlaces`;
  beforeEach(() => setActiveTripId(CAP_TOKEN));

  it('removePlace keeps the row with deleted:true, and the UI stops showing it', async () => {
    const h = renderMyPlaces();
    await h.run(() => {});
    await h.run((s) => s.addPlace({ id: 'boudhanath', name: 'Boudhanath', legId: 'main' }));
    expect(storedRows(KEY)[0].hlc).toEqual(expect.any(String)); // stamped, because sync is on
    await h.run((s) => s.removePlace('boudhanath'));

    expect(h.current.places).toEqual([]); // gone from the card grid
    const rows = storedRows(KEY);
    expect(rows).toHaveLength(1); // but NOT gone from the wire
    expect(rows[0]).toMatchObject({ id: 'boudhanath', deleted: true });
    expect(rows[0].hlc! > '0').toBe(true);
    h.unmount();
  });

  it('the peer\'s stale live copy does not resurrect it (this is the whole point of the tombstone)', async () => {
    const h = renderMyPlaces();
    await h.run(() => {});
    await h.run((s) => s.addPlace({ id: 'boudhanath', name: 'Boudhanath', legId: 'main' }));
    const beforeDelete = storedRows(KEY);
    await h.run((s) => s.removePlace('boudhanath'));
    const afterDelete = storedRows(KEY);

    // What the other phone still holds is exactly the pre-delete row.
    const merged = mergePlaces(afterDelete, beforeDelete, Date.now());
    expect(merged.filter((p) => p.deleted !== true)).toEqual([]);
    // The tombstone must SURVIVE the merge, not merely suppress the row once: it is the only
    // thing that keeps the peer's live copy out on the NEXT round trip. Dropping it here reads
    // identical on this snapshot and resurrects the place on the following one.
    expect(merged.filter((p) => p.deleted === true)).toHaveLength(1);
    expect(mergePlaces(merged, beforeDelete, Date.now()).filter((p) => p.deleted !== true)).toEqual([]);
    h.unmount();
  });

  it('undo-of-delete restores the place even in the SAME millisecond as the delete', async () => {
    // Date is frozen (timers are NOT — the act shim still needs real scheduling) so "same
    // millisecond" is literal rather than a race the suite usually wins. This is the case a
    // `firstSyncStamp` on the re-add loses: it mints {pt:now, ct:0} while the tombstone already
    // holds {pt:now, ct:1}, so the tombstone wins the compare and the undo silently bounces.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-14T12:00:00.000Z'));
    const h = renderMyPlaces();
    await h.run(() => {});
    await h.run((s) => s.addPlace({ id: 'boudhanath', name: 'Boudhanath', legId: 'main' }));
    const original = h.current.places[0];
    await h.run((s) => s.removePlace('boudhanath'));
    const tombstone = storedRows(KEY); // exactly what the peer may already have pulled down
    // Exactly what `MyPlacesSection`'s undo toast does: re-add the captured place verbatim.
    await h.run((s) => s.addPlace(original));

    expect(h.current.places.map((p) => p.id)).toEqual(['boudhanath']);
    const rows = storedRows(KEY);
    expect(rows).toHaveLength(1);
    expect(rows[0].deleted).toBeUndefined();
    // And the restore must WIN the merge against that tombstone, in either argument order.
    expect(mergePlaces(rows, tombstone, Date.now()).filter((p) => p.deleted !== true)).toHaveLength(1);
    expect(mergePlaces(tombstone, rows, Date.now()).filter((p) => p.deleted !== true)).toHaveLength(1);
    h.unmount();
    vi.useRealTimers();
  });
});

describe('SyncPort.push (outbox-decorated) — the new "places" domain rides the existing outbox', () => {
  it('a changed row-set issues exactly one tx-set on places/list; an unchanged one issues none', async () => {
    await placesSyncPort.push([place('a')], [place('a', { name: 'renamed', rev: 2, hlc: '000000000005000:000000:a' })]);
    await flush();
    expect(writeLog).toEqual([`tx-set:${DOC_PATH}`]);

    writeLog.length = 0;
    const same = [place('a')];
    await placesSyncPort.push(same, same);
    await flush();
    expect(writeLog).toEqual([]);
  });

  it('a failed push keeps the "list" chunk dirty under the "places" key, counted in pending', async () => {
    expect(outboxSnapshot().dirty).toEqual({});
    fake.failWrites = true; // remote unreachable → the write-ahead enqueue persists, no ack
    await placesSyncPort.push([], [place('a')]);
    await flush();
    expect(outboxSnapshot().dirty).toEqual({ places: ['list'] });
  });
});

describe('the DEFAULT sample pack (getTripId() === "") stays local-only and never errors', () => {
  // The default pack's remote id is retired, so `isTripRemoteConfigured()` is false even with a
  // full Firebase web config present. Places there must behave EXACTLY as before this slice.
  beforeEach(() => {
    tripId.value = ''; // no setActiveTripId ⇒ the default pack ⇒ the grandfathered legacy key
  });

  it('add + remove work, write NO sync stamps, and the delete is still physical', async () => {
    const KEY = STORAGE_KEYS.myPlaces;
    const h = renderMyPlaces();
    await h.run(() => {});
    await h.run((s) => s.addPlace({ id: 'a', name: 'Boudhanath', legId: 'nepal' }));

    const rows = storedRows(KEY);
    expect(rows).toHaveLength(1);
    expect(rows[0].hlc).toBeUndefined();
    expect(rows[0].rev).toBeUndefined();
    expect(rows[0].deleted).toBeUndefined();

    await h.run((s) => s.removePlace('a'));
    expect(h.current.places).toEqual([]);
    expect(storedRows(KEY)).toEqual([]); // physically gone — byte-identical to the pre-#17 slot
    h.unmount();
  });

  it('nothing is enqueued on the outbox and no Firestore write is attempted', async () => {
    const h = renderMyPlaces();
    await h.run(() => {});
    await h.run((s) => s.addPlace({ id: 'a', name: 'Boudhanath', legId: 'nepal' }));
    await h.run((s) => s.removePlace('a'));
    await flush();

    expect(outboxSnapshot().dirty).toEqual({});
    expect(writeLog).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEYS.syncOutbox)).toBeNull();
  });

  it('the subscribe is a silent no-op unsubscribe (no stream, no empty-path compose)', () => {
    const unsub = placesSyncPort.subscribe();
    expect(placesSyncPort.isConfigured()).toBe(false);
    expect(() => unsub()).not.toThrow();
    expect(writeLog).toEqual([]);
  });
});

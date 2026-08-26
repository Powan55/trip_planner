// @vitest-environment jsdom
//
// #161 — a remote trip-list merge can MOVE the active-trip pointer (an incoming tombstone for the
// active trip, `importRemoteTrips`), and the pack constants are frozen at module-evaluation time
// against whichever trip was active then. The local switch paths (home strip, settings, trips hub)
// all pair the pointer write with a full `window.location.reload()`; the remote merge did not, so
// the session kept rendering the OLD trip's dates/legs/labels under the new pointer.
//
// Two layers, both wired against a fake remote (`getRemote` mocked — no firebase):
//   A. the FLAG — `subscribeTripList`'s `onMerge(activeTripChanged)` is true only when the merge
//      actually moved the pointer, and false on an ordinary merge.
//   B. the GATE — the provider's subscription reloads on true and, critically, does NOT reload on
//      false (a reload on every sync would be worse than the drift).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DEFAULT_TRIP_ID, getActiveTripId, setSyncCode } from '@/core/storage/gateway';
import { joinTrip } from '@/core/trips/registry';
import { signIn } from '@/lib/token-auth';

vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => true,
  isTripRemoteConfigured: () => true,
  getTripId: () => 'test-trip',
}));

type DocData = Record<string, unknown>;
type DocRef = { path: string };
type SnapListener = (snap: {
  exists: () => boolean;
  data: () => DocData | undefined;
  metadata: { hasPendingWrites: boolean; fromCache: boolean };
}) => void;

const docs = new Map<string, DocData>();
const listeners = new Map<string, SnapListener>();

// Only the three `fs` members the trip-list path touches (doc / onSnapshot / runTransaction) —
// mocking `getRemote` itself keeps the whole firebase SDK out of this file.
vi.mock('@/lib/firebase-remote', () => ({
  getRemote: async () => ({
    db: {},
    uid: 'device-uid-fake',
    fs: {
      doc: (_db: unknown, ...segs: string[]): DocRef => ({ path: segs.join('/') }),
      onSnapshot: (ref: DocRef, next: SnapListener) => {
        listeners.set(ref.path, next);
        return () => listeners.delete(ref.path);
      },
      runTransaction: async (_db: unknown, body: (tx: unknown) => Promise<void>) =>
        body({
          get: async (ref: DocRef) => ({
            exists: () => docs.has(ref.path),
            data: () => docs.get(ref.path),
          }),
          set: (ref: DocRef, data: DocData) => {
            docs.set(ref.path, JSON.parse(JSON.stringify(data)) as DocData);
          },
        }),
    },
  }),
  isPermissionDenied: () => false,
}));

import { subscribeTripList } from '@/lib/trips-remote';
import { createSyncCodeTripListSync } from '@/components/itinerary-provider';

const CODE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const DOC_PATH = `trips/${CODE}/profile/tripList`;

/** Fire a SERVER snapshot carrying `data` at the listener registered for the trip-list doc. */
function fireSnapshot(data: DocData) {
  const next = listeners.get(DOC_PATH);
  if (!next) throw new Error(`no listener for ${DOC_PATH}`);
  docs.set(DOC_PATH, data);
  next({
    exists: () => true,
    data: () => data,
    metadata: { hasPendingWrites: false, fromCache: false },
  });
}

/** Let the lazy `import()` + `await getRemote()` chains settle. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

/** A tombstone that outranks the local entry's `joinedAt`, so the merge really drops it. */
function tombstoneFor(id: string): DocData {
  return { version: 1, trips: [], removed: [{ id, removedAt: Date.now() + 1_000_000 }] };
}

// jsdom throws on real navigation; the gate under test calls reload().
let restoreLocation: (() => void) | null = null;
function stubLocation() {
  const real = window.location;
  const stub = { reload: vi.fn(), replace: vi.fn(), assign: vi.fn(), href: '', search: '' };
  Object.defineProperty(window, 'location', { value: stub, configurable: true, writable: true });
  restoreLocation = () =>
    Object.defineProperty(window, 'location', { value: real, configurable: true, writable: true });
  return stub;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  docs.clear();
  listeners.clear();
});
afterEach(() => {
  if (restoreLocation) {
    restoreLocation();
    restoreLocation = null;
  }
});

describe('subscribeTripList — activeTripChanged reports a pointer move, and only a pointer move', () => {
  it('a remote forget of the ACTIVE trip reports activeTripChanged: true', async () => {
    joinTrip('t1', 'One'); // writes the entry AND the active pointer
    expect(getActiveTripId()).toBe('t1');

    const onMerge = vi.fn();
    const unsub = subscribeTripList(CODE, onMerge);
    await flush();
    fireSnapshot(tombstoneFor('t1'));

    expect(getActiveTripId()).toBe(DEFAULT_TRIP_ID); // the merge moved it
    expect(onMerge).toHaveBeenCalledWith(true);
    unsub();
  });

  it('an ordinary merge that leaves the pointer alone reports false', async () => {
    joinTrip('keep', 'Keep');

    const onMerge = vi.fn();
    const unsub = subscribeTripList(CODE, onMerge);
    await flush();
    fireSnapshot({ version: 1, trips: [{ id: 'theirs', name: 'Phone trip', joinedAt: 1 }] });

    expect(getActiveTripId()).toBe('keep');
    expect(onMerge).toHaveBeenCalledWith(false);
    unsub();
  });

  it('a remote forget of a NON-active trip reports false', async () => {
    joinTrip('t1', 'One');
    joinTrip('keep', 'Keep'); // active = keep, so t1's tombstone must not move the pointer

    const onMerge = vi.fn();
    const unsub = subscribeTripList(CODE, onMerge);
    await flush();
    fireSnapshot(tombstoneFor('t1'));

    expect(getActiveTripId()).toBe('keep');
    expect(onMerge).toHaveBeenCalledWith(false);
    unsub();
  });
});

describe('createSyncCodeTripListSync — reloads on a pointer move, never on a plain sync', () => {
  it('reloads when the merge moves the active-trip pointer', async () => {
    setSyncCode(CODE);
    signIn('Kenji'); // the subscription gate needs code + active traveler
    joinTrip('t1', 'One');
    const loc = stubLocation();

    const sync = createSyncCodeTripListSync();
    sync.activate();
    await flush();
    fireSnapshot(tombstoneFor('t1'));

    expect(loc.reload).toHaveBeenCalledTimes(1);
    sync.teardown();
  });

  it('does NOT reload on a merge that leaves the pointer where it was', async () => {
    setSyncCode(CODE);
    signIn('Kenji');
    joinTrip('keep', 'Keep');
    const loc = stubLocation();

    const sync = createSyncCodeTripListSync();
    sync.activate();
    await flush();
    fireSnapshot({ version: 1, trips: [{ id: 'theirs', name: 'Phone trip', joinedAt: 1 }] });

    expect(loc.reload).not.toHaveBeenCalled();
    sync.teardown();
  });
});

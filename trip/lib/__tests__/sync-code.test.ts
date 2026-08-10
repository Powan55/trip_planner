// @vitest-environment jsdom
//
// S255 — Sync Code suite. Two layers, mirroring trips-remote.test.ts:
//
//   A. PURE `mergeTripLists` (core/trips/registry.ts): additive union by id, name/config LWW by
//      `updatedAt` (missing loses to present), DEFAULT pack excluded BOTH directions, malformed
//      entries dropped, `localHadExtras` flag correctness.
//   B. WIRED behavior of `pushTripList` / `subscribeTripList` (lib/trips-remote.ts) against a FAKE
//      Firestore (SDK modules vi.mock'd): push writes the union to the exact doc path
//      `trips/{code}/profile/tripList`; subscribe does NOTHING on an ABSENT first snapshot (#10 —
//      the auto-seed that manufactured account docs for unknown codes is deleted), merges into the
//      local registry on a PRESENT snapshot, and pushes back when local had extras; both
//      directions are dormant-safe no-ops.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_TRIP_ID, getActiveTripId, setActiveTripId } from '@/core/storage/gateway';
import {
  mergeTripLists,
  importRemoteTrips,
  listKnownTrips,
  listRemovedTrips,
  removeKnownTrip,
  joinTrip,
  type TripMeta,
  type RemovedTrip,
} from '@/core/trips/registry';

const isRemoteConfiguredMock = vi.fn(() => true);
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => isRemoteConfiguredMock(),
  // #10: mirrors isRemoteConfigured — every mocked getTripId here is non-empty, so the two gates agree.
  isTripRemoteConfigured: () => isRemoteConfiguredMock(),
  getTripId: () => 'nepal-japan-2026',
}));

type DocData = Record<string, unknown>;
class FakeFirestore {
  docs = new Map<string, DocData>();
  setDocData(path: string, data: DocData) {
    this.docs.set(path, JSON.parse(JSON.stringify(data)));
  }
}
const fake = new FakeFirestore();
const writeLog: { path: string; data: DocData }[] = [];
type SnapListener = (snap: {
  exists: () => boolean;
  data: () => DocData | undefined;
  metadata: { hasPendingWrites: boolean; fromCache: boolean };
}) => void;
const listeners = new Map<string, SnapListener>();

/** Fire a SERVER snapshot at the listener registered for a path, from the fake store's state. */
function fireSnapshot(path: string) {
  const next = listeners.get(path);
  if (!next) throw new Error(`no listener for ${path}`);
  const data = fake.docs.get(path);
  next({
    exists: () => data !== undefined,
    data: () => data,
    metadata: { hasPendingWrites: false, fromCache: false },
  });
}

vi.mock('firebase/app', () => ({
  initializeApp: () => ({ name: 'fake' }),
  getApps: () => [],
  getApp: () => ({ name: 'fake' }),
}));
vi.mock('firebase/firestore', () => ({
  getFirestore: () => fake,
  doc: (_db: unknown, ...segs: string[]) => ({ __type: 'doc', path: segs.join('/') }),
  setDoc: async (ref: { path: string }, data: DocData) => {
    writeLog.push({ path: ref.path, data });
    fake.setDocData(ref.path, data);
  },
  getDoc: async (ref: { path: string }) => {
    const data = fake.docs.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
  },
  onSnapshot: (ref: { path: string }, next: SnapListener) => {
    listeners.set(ref.path, next);
    return () => listeners.delete(ref.path);
  },
}));

import { pushTripList, subscribeTripList } from '@/lib/trips-remote';

const CODE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const DOC_PATH = `trips/${CODE}/profile/tripList`;

function meta(id: string, over: Partial<TripMeta> = {}): TripMeta {
  return { id, name: id, joinedAt: 100, ...over };
}

function tomb(id: string, removedAt: number): RemovedTrip {
  return { id, removedAt };
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  fake.docs.clear();
  writeLog.length = 0;
  listeners.clear();
  isRemoteConfiguredMock.mockReturnValue(true);
});

// ── A. pure merge ────────────────────────────────────────────────────────────────────────────────
describe('mergeTripLists — additive union + updatedAt LWW (Plan D6)', () => {
  it('unions trips present on only one side (nothing is ever deleted)', () => {
    const { merged, localHadExtras } = mergeTripLists([meta('a')], [meta('b')]);
    expect(merged.map((t) => t.id).sort()).toEqual(['a', 'b']);
    expect(localHadExtras).toBe(true);
  });

  it('localHadExtras is false when remote already knows every local trip', () => {
    const { localHadExtras } = mergeTripLists([meta('a')], [meta('a'), meta('b')]);
    expect(localHadExtras).toBe(false);
  });

  it('rename LWW: the higher updatedAt wins in BOTH directions', () => {
    const remoteWins = mergeTripLists(
      [meta('a', { name: 'Old', updatedAt: 1 })],
      [meta('a', { name: 'New', updatedAt: 2 })],
    );
    expect(remoteWins.merged[0].name).toBe('New');

    const localWins = mergeTripLists(
      [meta('a', { name: 'Newest', updatedAt: 9 })],
      [meta('a', { name: 'Stale', updatedAt: 2 })],
    );
    expect(localWins.merged[0].name).toBe('Newest');
  });

  it('a MISSING updatedAt loses to a present one; when remote wins, local joinedAt is kept', () => {
    const { merged } = mergeTripLists(
      [meta('a', { name: 'No stamp', joinedAt: 42 })],
      [meta('a', { name: 'Stamped', joinedAt: 777, updatedAt: 5 })],
    );
    expect(merged[0].name).toBe('Stamped');
    expect(merged[0].joinedAt).toBe(42); // joinedAt is a per-device fact, never synced over
  });

  it('config conflicts resolve by the same entry-level LWW', () => {
    const cfg = (vibe: string, updatedAt: number) => ({
      start: '2027-01-01', end: '2027-01-10', destinations: ['X'], vibe, updatedAt,
    });
    const { merged } = mergeTripLists(
      [meta('a', { updatedAt: 1, config: cfg('calm', 1) })],
      [meta('a', { updatedAt: 8, config: cfg('party', 8) })],
    );
    expect(merged[0].config?.vibe).toBe('party');
  });

  it('the DEFAULT pack entry is excluded in BOTH directions (never pushed, never merged in)', () => {
    const { merged } = mergeTripLists(
      [meta(DEFAULT_TRIP_ID, { name: 'Renamed default' }), meta('a')],
      [meta(DEFAULT_TRIP_ID, { name: 'Leaked default' }), meta('b')],
    );
    expect(merged.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('malformed entries are dropped from either side', () => {
    const bad = [
      { id: '', name: 'no id', joinedAt: 1 },
      { id: 'x', name: '', joinedAt: 1 },
      { id: 'y', name: 'bad time', joinedAt: NaN },
      null,
      42,
    ] as unknown as TripMeta[];
    const { merged } = mergeTripLists([meta('good'), ...bad], bad);
    expect(merged.map((t) => t.id)).toEqual(['good']);
  });

  // ── S269 tombstones (trip forget) ──────────────────────────────────────────────────────────────
  it('a tombstoned trip is DROPPED from the union (remove → no resurrect)', () => {
    const { merged, removed } = mergeTripLists(
      [],
      [meta('x', { joinedAt: 50 })], // remote still lists x (older than the tombstone)
      [tomb('x', 100)],
      [],
    );
    expect(merged.map((t) => t.id)).toEqual([]);
    expect(removed).toEqual([tomb('x', 100)]); // the tombstone survives so x stays forgotten
  });

  it('a re-join (newer joinedAt) BEATS a stale tombstone, and discards it', () => {
    const { merged, removed } = mergeTripLists(
      [meta('x', { joinedAt: 200 })], // re-joined AFTER the forget
      [],
      [tomb('x', 100)],
      [],
    );
    expect(merged.map((t) => t.id)).toEqual(['x']);
    expect(removed).toEqual([]); // stale tombstone dropped
  });

  it('a post-forget RENAME (newer updatedAt) also beats a stale tombstone', () => {
    const { merged } = mergeTripLists(
      [meta('x', { joinedAt: 10, updatedAt: 300 })],
      [],
      [],
      [tomb('x', 100)],
    );
    expect(merged.map((t) => t.id)).toEqual(['x']);
  });

  it('tombstones fold LWW by removedAt (the later forget wins)', () => {
    const { removed } = mergeTripLists([], [], [tomb('x', 100)], [tomb('x', 250)]);
    expect(removed).toEqual([tomb('x', 250)]);
  });

  it('the DEFAULT pack is NEVER tombstoned in either direction', () => {
    const { merged, removed } = mergeTripLists(
      [meta(DEFAULT_TRIP_ID), meta('a')],
      [meta('a')],
      [tomb(DEFAULT_TRIP_ID, 999)],
      [],
    );
    expect(merged.map((t) => t.id)).toEqual(['a']); // default was stripped from the union anyway
    expect(removed).toEqual([]); // and its tombstone was dropped, never emitted
  });

  it('an old-shape doc with NO removed field is tolerated (removed defaults to [])', () => {
    const { merged, removed } = mergeTripLists([meta('a')], [meta('b')]);
    expect(merged.map((t) => t.id).sort()).toEqual(['a', 'b']);
    expect(removed).toEqual([]);
  });

  it('localHadExtras is true for a local tombstone the remote lacks, false once remote has it', () => {
    expect(mergeTripLists([], [], [tomb('x', 100)], []).localHadExtras).toBe(true);
    expect(mergeTripLists([], [], [tomb('x', 100)], [tomb('x', 100)]).localHadExtras).toBe(false);
  });
});

describe('removeKnownTrip — local forget + tombstone (S269, D-222)', () => {
  it('drops the trip from the known list and records a tombstone', () => {
    joinTrip('t1', 'One');
    setActiveTripId(DEFAULT_TRIP_ID); // not the active trip, so no self-heal re-adds it
    removeKnownTrip('t1');
    expect(listKnownTrips().map((t) => t.id)).not.toContain('t1');
    expect(listRemovedTrips().map((r) => r.id)).toEqual(['t1']);
  });

  it('REFUSES the default pack (never removable — no tombstone, still listed first)', () => {
    removeKnownTrip(DEFAULT_TRIP_ID);
    expect(listRemovedTrips()).toEqual([]);
    expect(listKnownTrips()[0].id).toBe(DEFAULT_TRIP_ID);
  });

  it('forgetting the ACTIVE trip switches the pointer to the default pack (caller reloads)', () => {
    joinTrip('active-1', 'Active'); // joinTrip writes the active pointer
    expect(getActiveTripId()).toBe('active-1');
    removeKnownTrip('active-1');
    expect(getActiveTripId()).toBe(DEFAULT_TRIP_ID);
  });

  it('a forgotten trip does NOT resurrect through importRemoteTrips when the remote still lists it', () => {
    joinTrip('t1', 'One');
    setActiveTripId(DEFAULT_TRIP_ID);
    removeKnownTrip('t1');
    importRemoteTrips([meta('t1', { joinedAt: 1 })], []); // remote still has t1, no tombstone
    expect(listKnownTrips().map((t) => t.id)).not.toContain('t1');
  });

  it('a remote re-join (newer joinedAt) revives a locally-forgotten trip through import', () => {
    joinTrip('t1', 'One');
    setActiveTripId(DEFAULT_TRIP_ID);
    removeKnownTrip('t1');
    const removedAt = listRemovedTrips()[0].removedAt;
    importRemoteTrips([meta('t1', { name: 'Re-joined', joinedAt: removedAt + 1000 })], []);
    expect(listKnownTrips().map((t) => t.id)).toContain('t1');
    expect(listRemovedTrips().map((r) => r.id)).not.toContain('t1'); // stale tombstone cleared
  });
});

describe('importRemoteTrips — merge lands in the local registry, default preserved', () => {
  it('a remote-only trip appears in listKnownTrips after import', () => {
    joinTrip('local-1', 'Mine');
    const { localHadExtras } = importRemoteTrips([meta('remote-1', { name: 'Phone trip' })]);
    expect(localHadExtras).toBe(true);
    const ids = listKnownTrips().map((t) => t.id);
    expect(ids).toContain('remote-1');
    expect(ids).toContain('local-1');
    expect(ids[0]).toBe(DEFAULT_TRIP_ID); // default still first, untouched by the merge
  });
});

// ── B. wired push/subscribe against fake firestore ───────────────────────────────────────────────
describe('pushTripList — writes the union to trips/{code}/profile/tripList', () => {
  it('writes {version:1, trips:[…]} at the exact path, WITHOUT the default pack entry', async () => {
    joinTrip('t1', 'Trip one');
    await pushTripList(CODE);
    expect(writeLog).toHaveLength(1);
    expect(writeLog[0].path).toBe(DOC_PATH);
    const data = writeLog[0].data as { version: number; trips: TripMeta[] };
    expect(data.version).toBe(1);
    expect(data.trips.map((t) => t.id)).toEqual(['t1']); // no DEFAULT_TRIP_ID leaked
  });

  it('union-merges with a present remote doc (remote-only trip survives the push)', async () => {
    joinTrip('t1', 'Trip one');
    fake.setDocData(DOC_PATH, { version: 1, trips: [meta('r1', { name: 'Remote' })] });
    await pushTripList(CODE);
    const data = writeLog[0].data as { trips: TripMeta[] };
    expect(data.trips.map((t) => t.id).sort()).toEqual(['r1', 't1']);
  });

  it('no-ops when dormant or code empty', async () => {
    isRemoteConfiguredMock.mockReturnValue(false);
    await pushTripList(CODE);
    isRemoteConfiguredMock.mockReturnValue(true);
    await pushTripList('');
    expect(writeLog).toHaveLength(0);
  });

  it('purges a forgotten trip the remote doc still lists, and writes its tombstone (S269)', async () => {
    joinTrip('t1', 'One');
    removeKnownTrip('t1'); // t1 was active → pointer switched to default; t1 forgotten + tombstoned
    fake.setDocData(DOC_PATH, { version: 1, trips: [meta('t1', { joinedAt: 1 })] }); // remote still lists it, no tombstone
    await pushTripList(CODE);
    const data = writeLog[0].data as { trips: TripMeta[]; removed: RemovedTrip[] };
    expect(data.trips.map((t) => t.id)).toEqual([]); // purged from the pushed union
    expect(data.removed.map((r) => r.id)).toEqual(['t1']);
  });
});

describe('subscribeTripList — docs-remote first-snapshot recipe', () => {
  // #10 INVERTED this case. It used to read "ABSENT first snapshot ⇒ seeds the remote doc from
  // local", and that seed is exactly what manufactured a working account doc for ANY string
  // pasted at the door — making login validation impossible. The seed branch is DELETED: an
  // absent first snapshot now does nothing, and the doc is created only by the deliberate
  // writers (the door's create path, trips-hub's pushes). This pins the deletion.
  it('ABSENT first snapshot ⇒ NO write at all (the auto-seed is deleted, #10)', async () => {
    joinTrip('seed-me', 'Seed trip');
    const unsub = subscribeTripList(CODE);
    await flush();
    fireSnapshot(DOC_PATH); // doc absent
    await flush();
    expect(writeLog).toHaveLength(0); // pushTripList was NOT called
    expect(fake.docs.has(DOC_PATH)).toBe(false); // no account doc was manufactured
    // The local registry is untouched either way.
    expect(listKnownTrips().map((t) => t.id)).toContain('seed-me');
    unsub();
  });

  it('PRESENT snapshot ⇒ merges into the local registry (remote-only trip shows up locally)', async () => {
    joinTrip('mine', 'Mine');
    fake.setDocData(DOC_PATH, { version: 1, trips: [meta('theirs', { name: 'Phone trip' })] });
    const onMerge = vi.fn();
    const unsub = subscribeTripList(CODE, onMerge);
    await flush();
    fireSnapshot(DOC_PATH);
    await flush();
    const ids = listKnownTrips().map((t) => t.id);
    expect(ids).toContain('theirs');
    expect(ids).toContain('mine');
    expect(onMerge).toHaveBeenCalled();
    // Local had 'mine' which remote lacked ⇒ pushed the union back.
    const pushed = fake.docs.get(DOC_PATH) as { trips: TripMeta[] };
    expect(pushed.trips.map((t) => t.id).sort()).toEqual(['mine', 'theirs']);
    unsub();
  });

  it('PRESENT snapshot with no local extras ⇒ NO push-back write', async () => {
    fake.setDocData(DOC_PATH, { version: 1, trips: [meta('theirs')] });
    const unsub = subscribeTripList(CODE);
    await flush();
    fireSnapshot(DOC_PATH);
    await flush();
    expect(writeLog).toHaveLength(0); // merge applied locally, nothing to push
    expect(listKnownTrips().map((t) => t.id)).toContain('theirs');
    unsub();
  });

  it('dormant / empty code ⇒ no-op unsubscribe, no listener opened', async () => {
    isRemoteConfiguredMock.mockReturnValue(false);
    const unsub = subscribeTripList(CODE);
    await flush();
    expect(listeners.size).toBe(0);
    unsub();
  });

  it('PRESENT snapshot with a tombstone purges the forgotten trip from the local registry (S269)', async () => {
    joinTrip('t1', 'One');
    joinTrip('keep', 'Keep'); // active = keep, so t1 is no longer active and self-heal will not re-add it
    const removedAt = Date.now() + 1_000_000; // newer than t1's joinedAt → the tombstone wins
    fake.setDocData(DOC_PATH, { version: 1, trips: [], removed: [{ id: 't1', removedAt }] });
    const unsub = subscribeTripList(CODE);
    await flush();
    fireSnapshot(DOC_PATH);
    await flush();
    const ids = listKnownTrips().map((t) => t.id);
    expect(ids).not.toContain('t1');
    expect(ids).toContain('keep');
    unsub();
  });
});

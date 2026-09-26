// @vitest-environment jsdom
//
// D-544 — the seed-failure wipe. Wired-behavior suite for the first-snapshot reconcile in
// lib/itinerary-remote.ts, against a FAKE Firestore + the real merge core and the real outbox.
//
// THE DEFECT THIS PINS: the seed used to write the trip-doc marker and then push the day docs
// through the bare `pushPlans`, whose failure is swallowed to a console.warn with nothing behind
// it. Marker lands + day push does not ⇒ the remote is "trip doc present, ZERO day docs", and the
// NEXT load read that as a synced-then-emptied group and saved `[]` over the user's real
// itinerary. Two things fix it and both are pinned here:
//   1. the seed pushes through the outbox-decorated port, so a failed seed stays DIRTY and is
//      retried by the normal flush — and the existing first-snapshot dirty-chunk merge exception
//      then protects those dates on the next load,
//   2. the authoritative apply REFUSES to persist an empty remote over a non-empty local and
//      reports the refusal, so the reconcile falls through to the seed and heals the remote.
//
// Also pins what must NOT change: a remote that reports day docs whose `items` are `[]` is a real
// deliberately-emptied plan and still applies verbatim (D-091 / delete-all-stays-empty).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';

const gate = vi.hoisted(() => ({
  /** Day-doc writes (runTransaction) reject — the marker setDoc still succeeds. */
  failDayWrites: false,
  /** Called at the START of every day-doc transaction, before it writes anything. */
  onTxStart: null as null | ((path: string) => void),
  /** When set, getDocFromServer waits on it before answering. */
  holdServerRead: null as null | Promise<void>,
}));

vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => true,
  isTripRemoteConfigured: () => true,
  getTripId: () => 'nepal-japan-2026',
}));

vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }) };
});

const TRIP_ID = 'nepal-japan-2026';
type DocData = Record<string, unknown>;

class FakeFirestore {
  docs = new Map<string, DocData>();
  snapshotListeners: Array<(snap: FakeQuerySnapshot) => void> = [];
  setDocData(path: string, data: DocData) {
    this.docs.set(path, JSON.parse(JSON.stringify(data)));
  }
  daysSnapshot(): FakeQuerySnapshot {
    const prefix = `trips/${TRIP_ID}/days/`;
    const docs = [...this.docs.entries()]
      .filter(([p]) => p.startsWith(prefix))
      .map(([p, data]) => ({ id: p.slice(prefix.length), data: () => data }));
    return { metadata: { fromCache: false, hasPendingWrites: false }, docs };
  }
  emitServerSnapshot() {
    const snap = this.daysSnapshot();
    for (const cb of this.snapshotListeners) cb(snap);
  }
}

interface FakeQuerySnapshot {
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
  docs: Array<{ id: string; data: () => DocData }>;
}

const fake = new FakeFirestore();
const writeLog: string[] = [];
const pathOf = (segs: string[]) => segs.join('/');

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
  onSnapshot: (_q: unknown, onNext: (snap: FakeQuerySnapshot) => void) => {
    fake.snapshotListeners.push(onNext);
    return () => {
      const i = fake.snapshotListeners.indexOf(onNext);
      if (i >= 0) fake.snapshotListeners.splice(i, 1);
    };
  },
  getDoc: async (ref: { path: string }) => {
    const data = fake.docs.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
  },
  getDocFromServer: async (ref: { path: string }) => {
    if (gate.holdServerRead) await gate.holdServerRead;
    const data = fake.docs.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
  },
  setDoc: async (ref: { path: string }, data: DocData) => {
    writeLog.push(`set:${ref.path}`);
    fake.setDocData(ref.path, data);
  },
  deleteDoc: async (ref: { path: string }) => {
    writeLog.push(`delete:${ref.path}`);
    fake.docs.delete(ref.path);
  },
  serverTimestamp: () => 'SERVER_TS',
  runTransaction: async (
    _db: unknown,
    update: (tx: {
      get: (ref: { path: string }) => Promise<{ exists: () => boolean; data: () => DocData | undefined }>;
      set: (ref: { path: string }, data: DocData) => void;
    }) => Promise<void>,
  ) => {
    gate.onTxStart?.('tx-start');
    if (gate.failDayWrites) throw new Error('offline: transport unreachable');
    const tx = {
      get: async (ref: { path: string }) => {
        const data = fake.docs.get(ref.path);
        return { exists: () => data !== undefined, data: () => data };
      },
      set: (ref: { path: string }, data: DocData) => {
        writeLog.push(`tx-set:${ref.path}`);
        fake.setDocData(ref.path, data);
      },
    };
    await update(tx);
  },
}));

import { subscribeRemote } from '@/lib/itinerary-remote';
import { itineraryStoragePort, itineraryOutboxSync } from '@/lib/itinerary-ports';
import { flushOutbox, outboxDirty } from '@/core/sync/outbox';
import { loadPlans, savePlans, hasStoredPlans } from '@/lib/itinerary-storage';
import { STORAGE_KEYS } from '@/core/storage/gateway';

function item(id: string, over: Partial<ItineraryItem> = {}): ItineraryItem {
  return { id, title: `Item ${id}`, category: 'sightseeing', ...over };
}
function day(date: string, items: ItineraryItem[]): DayPlan {
  return { date, city: 'Kathmandu', country: 'nepal', items };
}

// The user's real trip: three days of hand-built plans, already persisted locally.
const LOCAL_TRIP: DayPlan[] = [
  day('2026-12-09', [item('a1'), item('a2')]),
  day('2026-12-10', [item('b1')]),
  day('2026-12-11', [item('c1'), item('c2'), item('c3')]),
];
const localIds = (plans: DayPlan[]) => plans.flatMap((d) => d.items.map((i) => i.id)).sort();

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  localStorage.clear();
  fake.docs.clear();
  fake.snapshotListeners = [];
  writeLog.length = 0;
  gate.failDayWrites = false;
  gate.onTxStart = null;
  gate.holdServerRead = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('D-544 — an empty remote NEVER erases a non-empty local', () => {
  it('marker present + ZERO day docs + non-empty local ⇒ every local item SURVIVES', async () => {
    savePlans(LOCAL_TRIP);
    expect(hasStoredPlans()).toBe(true);
    // The exact broken remote a half-landed seed leaves behind: trip doc present, no day docs.
    fake.setDocData(`trips/${TRIP_ID}`, { schemaVersion: 1, members: { 'device-uid-fake': 'owner' } });
    expect(outboxDirty('itinerary')).toEqual([]); // no outbox entry to save us — the seed path never enqueued

    const unsub = subscribeRemote();
    await flush();
    fake.emitServerSnapshot(); // FIRST snapshot — the one that used to save [] over the trip
    await flush();

    expect(localIds(loadPlans())).toEqual(['a1', 'a2', 'b1', 'c1', 'c2', 'c3']);
    expect(loadPlans()).toHaveLength(3);
    unsub();
  });

  it('...and it HEALS the remote rather than leaving it empty forever', async () => {
    savePlans(LOCAL_TRIP);
    fake.setDocData(`trips/${TRIP_ID}`, { schemaVersion: 1, members: { 'device-uid-fake': 'owner' } });

    const unsub = subscribeRemote();
    await flush();
    fake.emitServerSnapshot();
    await flush();

    // The refused apply falls through to the seed: all three day docs are pushed up.
    for (const d of LOCAL_TRIP) {
      expect(writeLog).toContain(`tx-set:trips/${TRIP_ID}/days/${d.date}`);
    }
    // The pre-existing marker is NOT rewritten (it carries a members map a peer may have edited).
    expect(writeLog.filter((w) => w === `set:trips/${TRIP_ID}`)).toEqual([]);
    unsub();
  });

  it('a genuinely empty remote over a genuinely empty local still applies (no wipe to refuse)', async () => {
    savePlans([]); // the user really does hold an empty itinerary, and it is persisted
    expect(hasStoredPlans()).toBe(true);
    fake.setDocData(`trips/${TRIP_ID}`, { schemaVersion: 1 });

    const unsub = subscribeRemote();
    await flush();
    fake.emitServerSnapshot();
    await flush();

    expect(loadPlans()).toEqual([]); // stays empty — nothing resurrected
    expect(writeLog).toEqual([]); // nothing to seed, so no write at all
    unsub();
  });

  it('D-091 REGRESSION: day docs that exist with items:[] are a real emptied plan and still apply', async () => {
    savePlans(LOCAL_TRIP);
    fake.setDocData(`trips/${TRIP_ID}`, { schemaVersion: 1 });
    // A peer deleted every item. `clearDay`/`removeItem` keep the DAY, so the docs are present
    // with empty items — that is what a deliberate emptying looks like, and it is authoritative.
    for (const d of LOCAL_TRIP) {
      fake.setDocData(`trips/${TRIP_ID}/days/${d.date}`, { ...day(d.date, []) });
    }

    const unsub = subscribeRemote();
    await flush();
    fake.emitServerSnapshot();
    await flush();

    expect(loadPlans()).toHaveLength(3); // the days survive...
    expect(localIds(loadPlans())).toEqual([]); // ...emptied, verbatim. No resurrection.
    unsub();
  });
});

describe('D-544 — a failed seed push is retryable, not silently dropped', () => {
  it('the seed enqueues every date BEFORE any network write (write-ahead ordering)', async () => {
    savePlans(LOCAL_TRIP);
    const dirtyAtFirstWrite: string[][] = [];
    gate.onTxStart = () => dirtyAtFirstWrite.push(outboxDirty('itinerary').slice());

    const unsub = subscribeRemote(); // no marker ⇒ this client seeds
    await flush();
    fake.emitServerSnapshot();
    await flush();

    expect(dirtyAtFirstWrite.length).toBeGreaterThan(0);
    // Every date was already recorded dirty by the time the FIRST day write was attempted, so a
    // crash/close between the marker and the pushes cannot lose the record of what is unsent.
    expect(dirtyAtFirstWrite[0].sort()).toEqual(['2026-12-09', '2026-12-10', '2026-12-11']);
    unsub();
  });

  it('a failed seed leaves the dates DIRTY, survives the next load, and drains on reconnect', async () => {
    savePlans(LOCAL_TRIP);
    gate.failDayWrites = true; // the marker write lands; every day write rejects

    const unsubA = subscribeRemote();
    await flush();
    fake.emitServerSnapshot();
    await flush();

    // The exact broken remote from the report: marker written, zero day docs.
    expect(writeLog).toContain(`set:trips/${TRIP_ID}`);
    expect(fake.daysSnapshot().docs).toHaveLength(0);
    // ...but the work is RECORDED now, unlike the bare `pushPlans` this replaced.
    expect(outboxDirty('itinerary').sort()).toEqual(['2026-12-09', '2026-12-10', '2026-12-11']);
    expect(localIds(loadPlans())).toEqual(['a1', 'a2', 'b1', 'c1', 'c2', 'c3']); // local untouched
    unsubA();

    // ── NEXT LOAD, still offline: the marker is present and the remote is empty. The load that
    //    used to wipe. ────────────────────────────────────────────────────────────────────────
    const unsubB = subscribeRemote();
    await flush();
    fake.emitServerSnapshot();
    await flush();
    expect(localIds(loadPlans())).toEqual(['a1', 'a2', 'b1', 'c1', 'c2', 'c3']);
    unsubB();

    // ── RECONNECT: the ordinary flush drains the seed, no special-casing. ───────────────────
    gate.failDayWrites = false;
    await flushOutbox(itineraryOutboxSync, itineraryStoragePort);
    expect(outboxDirty('itinerary')).toEqual([]);
    expect(fake.daysSnapshot().docs.map((d) => d.id).sort()).toEqual([
      '2026-12-09',
      '2026-12-10',
      '2026-12-11',
    ]);
    const slot = JSON.parse(localStorage.getItem(STORAGE_KEYS.syncOutbox)!);
    expect(slot.dirty).toEqual({});
  });
});

describe('#542 — first-load reconcile never overwrites a newer snapshot', () => {
  it("a snapshot delivered while the marker read is in flight survives the first-load apply", async () => {
    savePlans(LOCAL_TRIP);
    fake.setDocData(`trips/${TRIP_ID}`, { schemaVersion: 1 });
    fake.setDocData(`trips/${TRIP_ID}/days/2026-12-09`, day("2026-12-09", [item("old")]) as unknown as DocData);
    let release!: () => void;
    gate.holdServerRead = new Promise<void>((r) => (release = r));

    const unsub = subscribeRemote();
    await flush();
    fake.emitServerSnapshot(); // first snapshot: [old], reconcile now blocked on the marker read
    await flush();
    fake.setDocData(`trips/${TRIP_ID}/days/2026-12-09`, day("2026-12-09", [item("new")]) as unknown as DocData);
    fake.emitServerSnapshot(); // newer snapshot lands during the await
    await flush();
    release();
    await flush();

    const ids = loadPlans().flatMap((d) => d.items.filter((i) => !i.deleted).map((i) => i.id));
    expect(ids).toContain("new");
    expect(ids).not.toContain("old");
    unsub();
  });
});

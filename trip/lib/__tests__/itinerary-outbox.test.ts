// @vitest-environment jsdom
//
// S141 — itinerary ADOPTION of the offline outbox (D-150, FU-19), against a FAKE Firestore + the
// real merge core. Proves the itinerary-specific pieces the generic outbox unit test (mocked
// pushChunk) cannot:
//   1. pushDayChunk pushes ONE present day through the merge-aware transactional write, and
//      REJECTS when the remote is unreachable (so the decorator keeps the chunk dirty).
//   2. pushDayChunk SKIPS a locally-absent day (resolve, NO write, never a deleteDoc).
//   3. The decorated itinerarySyncPort.push enqueues on an OFFLINE edit and drains on reconnect
//      via flushOutbox — the end-to-end FU-19 reload fix with the REAL pushDayChunk.
//   4. The DIRTY-CHUNK MERGE EXCEPTION on the first snapshot: a dirty date is MERGED (the offline
//      edit survives) while a non-dirty date is authoritative — and with an EMPTY outbox the first
//      snapshot is authoritative VERBATIM (the D-091/D-018 zero-commit path, byte-identical).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';

const gate = vi.hoisted(() => ({ offline: false }));

vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => true,
  // #10: mirrors isRemoteConfigured — every mocked getTripId here is non-empty, so the two gates agree.
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

vi.mock('firebase/app', () => ({
  initializeApp: () => ({ name: 'fake' }),
  getApps: () => [],
  getApp: () => ({ name: 'fake' }),
}));
vi.mock('firebase/firestore', () => ({
  getFirestore: () => fake,
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
    // Offline is modeled as a transport error: the transaction rejects (getRemote is cached
    // resolved at module scope, so a sign-in-level offline model can't re-trigger).
    if (gate.offline) throw new Error('offline: transport unreachable');
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

import { pushDayChunk, subscribeRemote } from '@/lib/itinerary-remote';
import { itinerarySyncPort } from '@/lib/itinerary-ports';
import { itineraryStoragePort, itineraryOutboxSync } from '@/lib/itinerary-ports';
import { flushOutbox, outboxDirty } from '@/core/sync/outbox';
import { loadPlans, savePlans } from '@/lib/itinerary-storage';
import { STORAGE_KEYS } from '@/core/storage/gateway';
import { serialize } from '@/core/sync/hlc';

function item(id: string, over: Partial<ItineraryItem> = {}): ItineraryItem {
  return { id, title: `Item ${id}`, category: 'sightseeing', ...over };
}
function day(date: string, items: ItineraryItem[]): DayPlan {
  return { date, city: 'Kathmandu', country: 'nepal', items };
}
const hlc = (pt: number, actor: string, ct = 0) => serialize({ pt, ct, actor });
const flush = async () => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  localStorage.clear();
  fake.docs.clear();
  fake.snapshotListeners = [];
  writeLog.length = 0;
  gate.offline = false;
});
afterEach(() => vi.restoreAllMocks());

describe('pushDayChunk — the itinerary ChunkSync write (present pushes, absent skips, offline rejects)', () => {
  it('pushes ONE present day through the merge-aware transactional write', async () => {
    const current = [day('2026-12-09', [item('A', { hlc: hlc(1000, 'me'), rev: 1 })])];
    await pushDayChunk(current, '2026-12-09');
    expect(writeLog).toContain(`tx-set:trips/${TRIP_ID}/days/2026-12-09`);
    const written = fake.docs.get(`trips/${TRIP_ID}/days/2026-12-09`) as unknown as DayPlan;
    expect(written.items.map((i) => i.id)).toEqual(['A']);
  });

  it('SKIPS a locally-absent day: resolves, issues NO write, never a deleteDoc', async () => {
    const current = [day('2026-12-09', [item('A')])];
    await expect(pushDayChunk(current, '2026-12-31')).resolves.toBeUndefined();
    expect(writeLog).toEqual([]); // no tx-set, no delete
  });

  it('REJECTS when the remote is unreachable (so the outbox decorator keeps the chunk dirty)', async () => {
    gate.offline = true;
    const current = [day('2026-12-09', [item('A')])];
    await expect(pushDayChunk(current, '2026-12-09')).rejects.toThrow();
  });
});

describe('end-to-end FU-19: offline edit → dirty slot → reconnect flush pushes once', () => {
  it('itinerarySyncPort.push enqueues while offline; flushOutbox drains on reconnect', async () => {
    savePlans([day('2026-12-09', [item('A', { hlc: hlc(1000, 'me'), rev: 1 })])]);

    // OFFLINE edit: the decorated push enqueues (write-ahead) then the real pushDayChunk rejects.
    gate.offline = true;
    await itinerarySyncPort.push([], loadPlans());
    // The offline edit is recorded, not lost.
    expect(outboxDirty('itinerary')).toEqual(['2026-12-09']);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.syncOutbox)!)).toEqual({
      version: 1,
      dirty: { itinerary: ['2026-12-09'] },
    });
    expect(writeLog).toEqual([]); // nothing reached the server

    // RECONNECT: a flush trigger drains the dirty set with the freshest local state.
    gate.offline = false;
    await flushOutbox(itineraryOutboxSync, itineraryStoragePort);

    expect(writeLog).toContain(`tx-set:trips/${TRIP_ID}/days/2026-12-09`); // pushed once
    expect(outboxDirty('itinerary')).toEqual([]); // acked → dirty cleared
    // S229: the ack stamps a lastAckAt on the slot, so the key persists (holding {dirty:{},
    // lastAckAt}) instead of being removed outright — see core-sync-outbox.test.ts for the
    // dedicated lastAckAt/outboxSnapshot() coverage.
    const slot = JSON.parse(localStorage.getItem(STORAGE_KEYS.syncOutbox)!);
    expect(slot.dirty).toEqual({});
    expect(typeof slot.lastAckAt).toBe('string');
  });
});

describe('first-snapshot dirty-chunk merge exception (the reload guard)', () => {
  it('a DIRTY date is MERGED (offline edit survives) while a non-dirty date is authoritative', async () => {
    // Local holds an unpushed offline edit on Dec 09 (item A) and nothing on Dec 10.
    savePlans([day('2026-12-09', [item('A', { title: 'A local', hlc: hlc(3000, 'me'), rev: 1 })])]);
    // Outbox marks Dec 09 dirty (the offline edit that never round-tripped).
    localStorage.setItem(
      STORAGE_KEYS.syncOutbox,
      JSON.stringify({ version: 1, dirty: { itinerary: ['2026-12-09'] } }),
    );
    // Remote (a synced group — trip marker present): peer's B on Dec 09, peer's C on Dec 10.
    fake.setDocData(`trips/${TRIP_ID}`, { schemaVersion: 1 });
    fake.setDocData(`trips/${TRIP_ID}/days/2026-12-09`, {
      ...day('2026-12-09', [item('B', { title: 'B remote', hlc: hlc(2000, 'friend'), rev: 1 })]),
    });
    fake.setDocData(`trips/${TRIP_ID}/days/2026-12-10`, {
      ...day('2026-12-10', [item('C', { title: 'C remote', hlc: hlc(2000, 'friend'), rev: 1 })]),
    });

    const unsub = subscribeRemote();
    await flush();
    fake.emitServerSnapshot(); // FIRST snapshot — authoritative, but with the dirty exception
    await flush();

    const plans = loadPlans();
    const d09 = plans.find((d) => d.date === '2026-12-09')!;
    const d10 = plans.find((d) => d.date === '2026-12-10')!;
    // Dec 09 is dirty → MERGED: the offline A AND the peer's B both survive (A was NOT clobbered).
    expect(d09.items.map((i) => i.id).sort()).toEqual(['A', 'B']);
    // Dec 10 is NOT dirty → authoritative verbatim.
    expect(d10.items.map((i) => i.id)).toEqual(['C']);
    expect(writeLog).toEqual([]); // snapshot path never pushes (echo-suppression, D-039)
    unsub();
  });

  it('with an EMPTY outbox the first snapshot is authoritative VERBATIM (D-091/D-018 zero-commit path)', async () => {
    // Same local A on Dec 09, but NO outbox entry (the delete-all-stays-empty / no-commit path).
    savePlans([day('2026-12-09', [item('A', { title: 'A local', hlc: hlc(3000, 'me'), rev: 1 })])]);
    expect(outboxDirty('itinerary')).toEqual([]); // empty outbox
    fake.setDocData(`trips/${TRIP_ID}`, { schemaVersion: 1 });
    fake.setDocData(`trips/${TRIP_ID}/days/2026-12-09`, {
      ...day('2026-12-09', [item('B', { title: 'B remote', hlc: hlc(2000, 'friend'), rev: 1 })]),
    });

    const unsub = subscribeRemote();
    await flush();
    fake.emitServerSnapshot();
    await flush();

    // Authoritative verbatim: only the remote B — the local A is NOT resurrected (byte-identical
    // to today's behavior; the merge exception did not fire because the outbox was empty).
    const d09 = loadPlans().find((d) => d.date === '2026-12-09')!;
    expect(d09.items.map((i) => i.id)).toEqual(['B']);
    unsub();
  });
});

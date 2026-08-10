// @vitest-environment jsdom
//
// S97 — WIRED-behavior unit suite for the Sync v2 seam in lib/itinerary-remote.ts, exercised
// against a FAKE Firestore (the firebase SDK modules are vi.mock'd) + the real merge core.
// This is the "the wiring is correct off a live server" proof the two-client E2E cannot run
// in the dormant sandbox (no firebase env). It proves, on a real run:
//
//   1. docToDayPlan stays BEHAVIOR-FROZEN (pure shape-mapper, no defaulting) — the S77
//      contract — while defaultDayForMerge/defaultItemSyncFields apply the default-on-
//      read separately (v1 remote item → valid mergeable v2 item).
//   2. SNAPSHOT-MERGE applies remote against the current local view WITHOUT pushing
//      (echo-suppression, D-039): two friends' edits to DIFFERENT items on the SAME day both
//      survive after a snapshot; and NO write is issued from the snapshot path.
//   3. MERGE-AWARE PUSH composes (option A): pushDayMerged reads the current
//      remote day inside a transaction, mergeDay's the local day on top, and writes the
//      merged doc — so a concurrent same-day peer item is NOT clobbered.
//   4. ECHO / idempotence: applying a snapshot equal to what we already hold is a
//      value-identical no-op.
//
// D-039 (snapshot merges+saves directly, never pushes), D-042 (per-day docs), D-106
// (item-level merge inside the day), D-107 (lazy default-on-read dual-read) are all cited.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';

// ── Turn the config gate ON for this suite. firebase-config.ts captures process.env into a
//    const at MODULE LOAD (before this file's top-level code runs, since ES imports are
//    hoisted), so setting process.env here would be too late. Instead we mock the config
//    module so isRemoteConfigured() is true and the gated remote code runs. (The pure gate is
//    covered by the config module's own tests; here we only need it ON.) The trip id literal
//    is inlined because the factory is hoisted above any module-level const (TRIP_ID below
//    mirrors it for the rest of the file).
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => true,
  // #10: mirrors isRemoteConfigured — every mocked getTripId here is non-empty, so the two gates agree.
  isTripRemoteConfigured: () => true,
  getTripId: () => 'nepal-japan-2026',
}));

// S110-FIX / F2 (D-055 LOCKED): `pushPlans` now also gates on an ACTIVE TRAVELER (a guest never
// pushes). This suite exercises the merge-aware PUSH path, which in the real app only ever runs for
// an identified traveler — so we mock a signed-in traveler here (the suite's implicit precondition).
// This is SETUP only; no existing assertion below is changed. The guest-returns-early branch itself
// is covered by the dedicated itinerary-remote-guest-gate.test.ts.
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }) };
});

const TRIP_ID = 'nepal-japan-2026';

// ── A tiny in-memory FAKE Firestore. Docs are keyed by their path string. onSnapshot
//    listeners are captured so a test can drive a synthetic server snapshot. runTransaction
//    reads/writes the same store so pushDayMerged's read-merge-write is exercised for real.
type DocData = Record<string, unknown>;

class FakeFirestore {
  docs = new Map<string, DocData>(); // path -> data
  snapshotListeners: Array<(snap: FakeQuerySnapshot) => void> = [];

  setDocData(path: string, data: DocData) {
    this.docs.set(path, JSON.parse(JSON.stringify(data)));
  }
  deleteDocData(path: string) {
    this.docs.delete(path);
  }
  // Build a query snapshot over the `days` collection.
  daysSnapshot(fromCache = false, hasPendingWrites = false): FakeQuerySnapshot {
    const daysPrefix = `trips/${TRIP_ID}/days/`;
    const docs = [...this.docs.entries()]
      .filter(([p]) => p.startsWith(daysPrefix))
      .map(([p, data]) => ({ id: p.slice(daysPrefix.length), data: () => data }));
    return { metadata: { fromCache, hasPendingWrites }, docs };
  }
  emitServerSnapshot() {
    const snap = this.daysSnapshot(false, false);
    for (const cb of this.snapshotListeners) cb(snap);
  }
}

interface FakeQuerySnapshot {
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
  docs: Array<{ id: string; data: () => DocData }>;
}

const fake = new FakeFirestore();
// Track every write so we can prove the snapshot path issues NONE (echo-suppression).
const writeLog: string[] = [];

// path helpers mirroring doc(db, 'trips', TRIP_ID, 'days', date)
function pathOf(segments: string[]): string {
  return segments.join('/');
}

vi.mock('firebase/app', () => ({
  initializeApp: () => ({ name: 'fake' }),
  getApps: () => [],
  getApp: () => ({ name: 'fake' }),
}));

vi.mock('firebase/firestore', () => {
  return {
    getFirestore: () => fake,
    collection: (_db: unknown, ...segs: string[]) => ({ __type: 'collection', path: pathOf(segs) }),
    doc: (_db: unknown, ...segs: string[]) => ({ __type: 'doc', path: pathOf(segs) }),
    onSnapshot: (
      _q: unknown,
      onNext: (snap: FakeQuerySnapshot) => void,
      _onError?: (e: unknown) => void,
    ) => {
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
      fake.deleteDocData(ref.path);
    },
    serverTimestamp: () => 'SERVER_TS',
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
          writeLog.push(`tx-set:${ref.path}`);
          fake.setDocData(ref.path, data);
        },
      };
      await update(tx);
    },
  };
});

// Import AFTER the mocks + env are set. The Vault-backed storage uses localStorage (jsdom).
import {
  docToDayPlan,
  defaultItemSyncFields,
  defaultDayForMerge,
  pushDayMerged,
  pushPlans,
  subscribeRemote,
} from '@/lib/itinerary-remote';
import { loadPlans, savePlans, ITINERARY_STORAGE_KEY } from '@/lib/itinerary-storage';
import { serialize } from '@/core/sync/hlc';
import type { Firestore } from 'firebase/firestore';
import * as fs from 'firebase/firestore';

function item(id: string, over: Partial<ItineraryItem> = {}): ItineraryItem {
  return { id, title: `Item ${id}`, category: 'sightseeing', ...over };
}
function day(date: string, items: ItineraryItem[]): DayPlan {
  return { date, city: 'Kathmandu', country: 'nepal', items };
}
// A monotonically-increasing serialized hlc for a given actor at a given pt.
function hlc(pt: number, actor: string, ct = 0): string {
  return serialize({ pt, ct, actor });
}

beforeEach(() => {
  localStorage.clear();
  fake.docs.clear();
  fake.snapshotListeners = [];
  writeLog.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('docToDayPlan stays behavior-frozen; default-on-read is a SEPARATE step (D-107)', () => {
  it('docToDayPlan is a PURE shape-mapper — it does NOT add rev/hlc/deleted (S77 freeze)', () => {
    const mapped = docToDayPlan('2026-12-09', {
      date: '2026-12-09',
      country: 'nepal',
      city: 'Kathmandu',
      items: [{ id: 'i1', title: 'Temple', category: 'cultural' }],
    });
    expect(mapped.items[0]).toEqual({ id: 'i1', title: 'Temple', category: 'cultural' });
    expect(mapped.items[0]).not.toHaveProperty('rev');
    expect(mapped.items[0]).not.toHaveProperty('hlc');
  });

  it('defaultItemSyncFields defaults a v1 item: rev=1, deleted=false, hlc derived from updatedAt', () => {
    const v1 = item('i1', { updatedAt: '2026-07-01T10:00:00.000Z' });
    const defaulted = defaultItemSyncFields(v1);
    expect(defaulted.rev).toBe(1);
    expect(defaulted.deleted).toBe(false);
    expect(defaulted.hlc).toBe(serialize({ pt: Date.parse('2026-07-01T10:00:00.000Z'), ct: 0, actor: '' }));
  });

  it('defaultDayForMerge defaults every item but KEEPS tombstones (deleted:true) for the merge', () => {
    const d = day('2026-12-09', [item('live'), item('gone', { deleted: true, hlc: hlc(5000, 'B') })]);
    const out = defaultDayForMerge(d);
    expect(out.items).toHaveLength(2); // tombstone retained — must reach mergeDay
    expect(out.items.find((i) => i.id === 'gone')!.deleted).toBe(true);
    expect(out.items.find((i) => i.id === 'live')!.deleted).toBe(false); // defaulted
  });

  it('a v2 item that already carries the fields passes through unchanged', () => {
    const v2 = item('i1', { rev: 7, hlc: hlc(9000, 'C'), deleted: false });
    expect(defaultItemSyncFields(v2)).toMatchObject({ rev: 7, hlc: hlc(9000, 'C'), deleted: false });
  });
});

describe('SNAPSHOT-MERGE applies remote against local WITHOUT pushing (echo-suppression, D-039)', () => {
  it('two friends editing DIFFERENT items on the SAME day: both survive after the snapshot', async () => {
    // Local view: this friend added item A to Dec 9 (already stamped, in localStorage).
    const local = [day('2026-12-09', [item('A', { title: 'A local', hlc: hlc(1000, 'me'), rev: 1 })])];
    savePlans(local);

    // Remote day-doc: the OTHER friend's edit added item B to the SAME Dec 9 (v1-ish + hlc).
    fake.setDocData(`trips/${TRIP_ID}/days/2026-12-09`, {
      date: '2026-12-09',
      city: 'Kathmandu',
      country: 'nepal',
      items: [item('B', { title: 'B remote', hlc: hlc(2000, 'friend'), rev: 1 })],
    });

    // Open the subscription; flush so attemptSetup awaits getRemote() and the onSnapshot
    // listener is actually attached before we drive a synthetic server snapshot.
    const unsub = subscribeRemote();
    await flush();
    // First snapshot: no trip-doc marker exists → this client seeds (pushes local up).
    fake.emitServerSnapshot();
    await flush();
    writeLog.length = 0; // ignore the seed writes; we assert on the STEADY-STATE snapshot below

    // A trip-doc now exists (seed created it); drive a steady-state snapshot → MERGE path.
    fake.emitServerSnapshot();
    await flush();

    const merged = loadPlans().find((d) => d.date === '2026-12-09')!;
    const ids = merged.items.map((i) => i.id).sort();
    expect(ids).toEqual(['A', 'B']); // BOTH edits present — the headline v2 fix
    // Echo-suppression: the steady-state snapshot path issued NO write of any kind.
    expect(writeLog).toEqual([]);
    unsub();
  });

  it('echo/idempotence: a snapshot equal to what we already hold changes nothing + writes nothing', async () => {
    const shared = [day('2026-12-09', [item('A', { hlc: hlc(1000, 'me'), rev: 1, deleted: false })])];
    savePlans(shared);
    fake.setDocData(`trips/${TRIP_ID}/days/2026-12-09`, { ...shared[0] });
    // Pretend the group already synced (trip-doc marker present) so first snapshot is authoritative.
    fake.setDocData(`trips/${TRIP_ID}`, { schemaVersion: 1 });

    const unsub = subscribeRemote();
    await flush(); // let the listener attach
    fake.emitServerSnapshot(); // authoritative apply (no merge, verbatim)
    await flush();
    const afterFirst = JSON.stringify(loadPlans());
    writeLog.length = 0;

    fake.emitServerSnapshot(); // steady-state MERGE of an identical remote → value-identical
    await flush();
    expect(JSON.stringify(loadPlans())).toEqual(afterFirst);
    expect(writeLog).toEqual([]); // no push from the snapshot path
    unsub();
  });

  it('a v1 remote doc (no sync fields) is defaulted, merged, and its item survives (dual-read, D-107)', async () => {
    savePlans([day('2026-12-09', [item('A', { hlc: hlc(1000, 'me'), rev: 1, deleted: false })])]);
    // Trip-doc marker present ⇒ authoritative first snapshot.
    fake.setDocData(`trips/${TRIP_ID}`, { schemaVersion: 1 });
    // A genuinely v1 remote day-doc: item C has NO rev/hlc/deleted at all.
    fake.setDocData(`trips/${TRIP_ID}/days/2026-12-09`, {
      date: '2026-12-09',
      city: 'Kathmandu',
      country: 'nepal',
      items: [{ id: 'C', title: 'legacy remote', category: 'food' }],
    });

    const unsub = subscribeRemote();
    await flush(); // let the listener attach
    fake.emitServerSnapshot(); // authoritative: defaults the v1 item, applies verbatim
    await flush();
    const c = loadPlans()[0].items.find((i) => i.id === 'C')!;
    expect(c).toBeDefined();
    expect(c.rev).toBe(1); // defaulted on read
    expect(c.deleted).toBe(false);
    unsub();
  });
});

describe('MERGE-AWARE PUSH composes (transactional read-merge-write, option A)', () => {
  it('pushDayMerged does NOT clobber a concurrent same-day remote item', async () => {
    // Remote already has friend-B's item on Dec 9 (committed before our push lands).
    fake.setDocData(`trips/${TRIP_ID}/days/2026-12-09`, {
      date: '2026-12-09',
      city: 'Kathmandu',
      country: 'nepal',
      items: [item('B', { title: 'B remote', hlc: hlc(2000, 'friend'), rev: 1 })],
    });
    // We push OUR local day, which only knows about item A.
    const localDay = day('2026-12-09', [item('A', { title: 'A local', hlc: hlc(3000, 'me'), rev: 1 })]);

    await pushDayMerged(fake as unknown as Firestore, fs, localDay);

    // The written doc is the MERGE of remote-now + local — both A and B present.
    const written = fake.docs.get(`trips/${TRIP_ID}/days/2026-12-09`) as unknown as DayPlan;
    expect(written.items.map((i) => i.id).sort()).toEqual(['A', 'B']);
    expect(writeLog).toContain(`tx-set:trips/${TRIP_ID}/days/2026-12-09`);
  });

  it('pushDayMerged against an ABSENT remote doc writes the local items unchanged', async () => {
    const localDay = day('2026-12-25', [item('X', { hlc: hlc(1000, 'me'), rev: 1 })]);
    await pushDayMerged(fake as unknown as Firestore, fs, localDay);
    const written = fake.docs.get(`trips/${TRIP_ID}/days/2026-12-25`) as unknown as DayPlan;
    expect(written.items.map((i) => i.id)).toEqual(['X']);
  });

  // ── S407 — the per-day DISPLAY label must survive the Firestore ROUND TRIP ────────────────
  // `DayPlan.countryLabel` is what makes the Dec-9 header read "Syracuse, USA" instead of
  // "Syracuse, Nepal". The write side was always fine (`sanitizeDayForWrite` is a JSON clone),
  // but BOTH read-shaped constructions dropped it: `docToDayPlan`'s four-field literal, and
  // `pushDayMerged`'s absent-remote fallback — and since `mergeDay(remoteNow, localDay)` takes
  // day-level fields from its FIRST argument, that fallback erased the label on the very first
  // push. Without these two cases the whole S407 fix silently reverts on any synced device
  // while every other test on the machine stays green.
  it('S407: a per-day countryLabel survives docToDayPlan, and stays ABSENT when the doc has none', () => {
    const withLabel = docToDayPlan('2026-12-09', {
      date: '2026-12-09',
      country: 'nepal',
      city: 'Syracuse',
      countryLabel: 'USA',
      items: [],
    });
    expect(withLabel.countryLabel).toBe('USA');

    // Pass-through, NOT defaulting (the S77 frozen contract): no label in ⇒ no key out.
    const without = docToDayPlan('2026-12-10', { date: '2026-12-10', country: 'nepal', city: 'Kathmandu', items: [] });
    expect(without).not.toHaveProperty('countryLabel');
    // A wrong-typed field is ignored the same way the other fields' guards ignore theirs.
    const wrongType = docToDayPlan('2026-12-11', { country: 'nepal', city: 'Kathmandu', items: [], countryLabel: 42 });
    expect(wrongType).not.toHaveProperty('countryLabel');
  });

  it('S407: countryLabel survives the full push round trip — absent remote, then present remote', async () => {
    const base = day('2026-12-09', [item('X', { hlc: hlc(1000, 'me'), rev: 1 })]);
    const localDay: DayPlan = { ...base, city: 'Syracuse', countryLabel: 'USA' };

    // 1st push: NO remote doc yet — the absent-remote fallback is the only source of the
    // day-level fields that `mergeDay` then keeps.
    await pushDayMerged(fake as unknown as Firestore, fs, localDay);
    const first = fake.docs.get(`trips/${TRIP_ID}/days/2026-12-09`) as unknown as DayPlan;
    expect(first.countryLabel).toBe('USA');

    // 2nd push: the remote doc now EXISTS, so the day-level fields come back through
    // docToDayPlan. This is the path a second device's sync actually takes.
    await pushDayMerged(fake as unknown as Firestore, fs, localDay);
    const second = fake.docs.get(`trips/${TRIP_ID}/days/2026-12-09`) as unknown as DayPlan;
    expect(second.countryLabel).toBe('USA');

    // And the READ back into a DayPlan (what the snapshot handler builds the UI from).
    const readBack = docToDayPlan('2026-12-09', second as unknown as Record<string, unknown>);
    expect(readBack.countryLabel).toBe('USA');
    expect(readBack.city).toBe('Syracuse');
  });

  it('pushPlans routes a changed day through the transactional merge-aware write (no blind setDoc)', async () => {
    // Remote has B; local changed Dec 9 to include A. pushPlans should tx-set, merging both.
    fake.setDocData(`trips/${TRIP_ID}/days/2026-12-09`, {
      date: '2026-12-09',
      city: 'Kathmandu',
      country: 'nepal',
      items: [item('B', { hlc: hlc(2000, 'friend'), rev: 1 })],
    });
    const prev: DayPlan[] = [];
    const next = [day('2026-12-09', [item('A', { hlc: hlc(3000, 'me'), rev: 1 })])];
    await pushPlans(prev, next);
    // The write went through runTransaction (tx-set), NOT a blind setDoc.
    expect(writeLog.some((w) => w.startsWith('tx-set:'))).toBe(true);
    expect(writeLog.some((w) => w.startsWith('set:'))).toBe(false);
    const written = fake.docs.get(`trips/${TRIP_ID}/days/2026-12-09`) as unknown as DayPlan;
    expect(written.items.map((i) => i.id).sort()).toEqual(['A', 'B']);
  });
});

// Flush pending microtasks (the async IIFE inside onSnapshot + the transaction promises).
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

// Keep a reference so unused-import lint never trips (the key constant is asserted implicitly).
void ITINERARY_STORAGE_KEY;

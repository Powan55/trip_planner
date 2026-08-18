// @vitest-environment jsdom
//
// SB-5 — the read side of #85, worse than its write-side description: a signed-in traveller on a
// synced CUSTOM trip (`LEGS === ['main']`) had every local expense WIPED by the first remote
// snapshot. `applySnapshot` (lib/expenses-remote.ts) built its whole persisted row-set by
// iterating a hardcoded local `LEGS = ['nepal', 'japan']` instead of the real, pack-derived
// `LEGS` (`core/budget/model.ts`, the same constant D-339 relies on) — so a `'main'`-leg trip's
// rows were never even considered by the loop, first-snapshot or not, and `persistAndDispatch([])`
// overwrote the slot. The write side (`lib/expenses-ports.ts`'s `chunkDiff`) had the identical
// hardcode, so a custom trip's expenses were never pushed to Firestore either.
//
// This suite proves, on a real run, against a FAKE Firestore (mirrors
// itinerary-remote-sync.test.ts's onSnapshot pattern) + the real `core/budget/model` LEGS
// resolution (mirrors custom-trip-config.test.ts's `vi.resetModules()` + dynamic-import pattern
// for re-resolving a module-load constant under a different active pack):
//
//   1. DEFAULT pack (regression guard): an empty first snapshot with no local rows is a benign
//      no-op, and LEGS-driven doc-id filtering is unchanged.
//   2. CUSTOM pack, chunk ABSENT (never synced): an empty first snapshot leaves local `'main'`-leg
//      rows INTACT and seeds them up — the bug's exact repro.
//   3. CUSTOM pack, chunk PRESENT + empty (`items: []`): an authoritative empty snapshot DOES
//      clear local — proving the fix distinguishes "server confirms zero" from "doc-id mismatch"
//      rather than just refusing to ever apply an empty result.
//   4. CUSTOM pack, write side: `chunkDiff` now reports `'main'` as changed, and the push reaches
//      Firestore as `trips/{id}/expenses/main`.
//
// D-339 (local-only retention, expenses/budget), D-340 (this fix; closes D-339's expenses ceiling)
// cited.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Expense } from '@/core/budget/expenses';

vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => true,
  isTripRemoteConfigured: () => true,
  getTripId: () => TRIP_ID,
}));
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }) };
});
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

const TRIP_ID = 'trip-under-test';
type DocData = Record<string, unknown>;

interface FakeQuerySnapshot {
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
  docs: Array<{ id: string; data: () => DocData }>;
}

class FakeFirestore {
  docs = new Map<string, DocData>();
  snapshotListeners: Array<(snap: FakeQuerySnapshot) => void> = [];

  setDocData(path: string, data: DocData) {
    this.docs.set(path, JSON.parse(JSON.stringify(data)));
  }
  expensesSnapshot(fromCache = false, hasPendingWrites = false): FakeQuerySnapshot {
    const prefix = `trips/${TRIP_ID}/expenses/`;
    const docs = [...this.docs.entries()]
      .filter(([p]) => p.startsWith(prefix))
      .map(([p, data]) => ({ id: p.slice(prefix.length), data: () => data }));
    return { metadata: { fromCache, hasPendingWrites }, docs };
  }
  emitServerSnapshot() {
    const snap = this.expensesSnapshot(false, false);
    for (const cb of this.snapshotListeners) cb(snap);
  }
}

const fake = new FakeFirestore();
const writeLog: string[] = [];

function pathOf(segments: string[]): string {
  return segments.join('/');
}

vi.mock('firebase/firestore', () => ({
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
}));

// Static (default-pack) imports for the regression-guard block.
import { subscribeRemoteExpenses } from '@/lib/expenses-remote';
import { loadExpenses } from '@/core/budget/storage';
import { setActiveTripId } from '@/core/storage/gateway';
import { setTripConfig, type TripConfigBlock } from '@/core/trips/registry';

const CUSTOM_TRIP_ID = 'custom-1';
const CUSTOM_CONFIG: TripConfigBlock = {
  start: '2027-03-01',
  end: '2027-03-05',
  destinations: ['Bali'],
  vibe: 'beach',
  currency: 'USD',
  updatedAt: 1000,
};

function mainExpense(id: string, over: Partial<Expense> = {}): Expense {
  return { id, leg: 'main', category: 'food', amount: 500, createdAt: 't', rev: 1, hlc: `000000000001000:000000:${id}`, ...over };
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

/** Set up localStorage as a custom-pack trip and dynamically re-import the modules under test so
 * their module-load-resolved `LEGS` (core/budget/model.ts) picks up the ['main'] pack. Mirrors
 * lib/__tests__/custom-trip-config.test.ts's pattern for the same reason: LEGS is a module-load
 * constant, not reactive, so only a fresh module graph re-resolves it. */
async function importFreshUnderCustomPack() {
  localStorage.clear();
  sessionStorage.clear();
  setActiveTripId(CUSTOM_TRIP_ID);
  setTripConfig(CUSTOM_TRIP_ID, CUSTOM_CONFIG);
  vi.resetModules();
  const remote = await import('@/lib/expenses-remote');
  const ports = await import('@/lib/expenses-ports');
  const storage = await import('@/core/budget/storage');
  const model = await import('@/core/budget/model');
  return { remote, ports, storage, model };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  fake.docs.clear();
  fake.snapshotListeners = [];
  writeLog.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('DEFAULT pack — regression guard (LEGS unchanged, byte-identical)', () => {
  it('an empty first snapshot with no local rows is a benign no-op', async () => {
    const unsub = subscribeRemoteExpenses();
    await flush();
    fake.emitServerSnapshot(); // no docs at all
    await flush();
    expect(loadExpenses()).toEqual([]);
    unsub();
  });

  it('an unrecognized doc id (not nepal/japan) is ignored by the snapshot filter', async () => {
    fake.setDocData(`trips/${TRIP_ID}/expenses/main`, { leg: 'main', items: [mainExpense('ghost')] });
    const unsub = subscribeRemoteExpenses();
    await flush();
    fake.emitServerSnapshot();
    await flush();
    // 'main' is not in the DEFAULT pack's LEGS, so it must never be read into the local store.
    expect(loadExpenses()).toEqual([]);
    unsub();
  });
});

describe('CUSTOM pack (LEGS === [\'main\']) — the bug repro and its fix', () => {
  it('sanity: LEGS re-resolves to [\'main\'] under the custom pack', async () => {
    const { model } = await importFreshUnderCustomPack();
    expect([...model.LEGS]).toEqual(['main']);
  });

  it('chunk ABSENT (never synced): an empty first snapshot leaves local main-leg rows INTACT and seeds them up', async () => {
    const { remote, storage } = await importFreshUnderCustomPack();
    const localRows = [mainExpense('m1'), mainExpense('m2', { amount: 999 })];
    storage.saveExpenses(localRows);

    const unsub = remote.subscribeRemoteExpenses();
    await flush();
    fake.emitServerSnapshot(); // no `main` doc in Firestore at all — the bug's exact trigger
    await flush();

    // THE HEADLINE ASSERTION: local rows are NOT wiped.
    expect(storage.loadExpenses().map((e) => e.id).sort()).toEqual(['m1', 'm2']);
    // And the never-synced chunk is seeded UP (best-effort push), not left stranded forever.
    expect(writeLog).toContain(`tx-set:trips/${TRIP_ID}/expenses/main`);
    const written = fake.docs.get(`trips/${TRIP_ID}/expenses/main`) as { items: Expense[] };
    expect(written.items.map((e) => e.id).sort()).toEqual(['m1', 'm2']);
    unsub();
  });

  it('chunk PRESENT + authoritative empty (items: []): DOES clear local — server-confirmed zero is real', async () => {
    const { remote, storage } = await importFreshUnderCustomPack();
    storage.saveExpenses([mainExpense('stale')]);
    // The remote doc EXISTS for 'main' and explicitly reports zero items — a deliberately emptied
    // leg (D-018/D-091 parity), not a doc-id mismatch.
    fake.setDocData(`trips/${TRIP_ID}/expenses/main`, { leg: 'main', items: [] });

    const unsub = remote.subscribeRemoteExpenses();
    await flush();
    fake.emitServerSnapshot();
    await flush();

    expect(storage.loadExpenses()).toEqual([]); // authoritative empty DOES apply
    unsub();
  });

  it('chunk PRESENT with real remote rows: applies verbatim on the authoritative first snapshot', async () => {
    const { remote, storage } = await importFreshUnderCustomPack();
    fake.setDocData(`trips/${TRIP_ID}/expenses/main`, {
      leg: 'main',
      items: [mainExpense('remote-1', { amount: 42 })],
    });

    const unsub = remote.subscribeRemoteExpenses();
    await flush();
    fake.emitServerSnapshot();
    await flush();

    expect(storage.loadExpenses().map((e) => e.id)).toEqual(['remote-1']);
    unsub();
  });

  it('write side: chunkDiff now reports \'main\' as a changed chunk (was permanently [] pre-fix)', async () => {
    const { ports } = await importFreshUnderCustomPack();
    const prev: Expense[] = [];
    const next: Expense[] = [mainExpense('new-1')];
    const changed = ports.expensesOutboxSync.chunkDiff(prev, next);
    expect(changed).toEqual(['main']);
  });

  it('write side: expensesSyncPort.push reaches Firestore as trips/{id}/expenses/main', async () => {
    const { ports } = await importFreshUnderCustomPack();
    const prev: Expense[] = [];
    const next: Expense[] = [mainExpense('pushed-1')];
    await ports.expensesSyncPort.push(prev, next);
    await flush();
    expect(writeLog).toEqual([`tx-set:trips/${TRIP_ID}/expenses/main`]);
    const written = fake.docs.get(`trips/${TRIP_ID}/expenses/main`) as { items: Expense[] };
    expect(written.items.map((e) => e.id)).toEqual(['pushed-1']);
  });

  it('pushExpenseChunk acks-and-drops a leg foreign to the active pack (never a bad write)', async () => {
    const { remote } = await importFreshUnderCustomPack();
    await remote.pushExpenseChunk([mainExpense('x', { leg: 'nepal' })], 'nepal');
    expect(fake.docs.has(`trips/${TRIP_ID}/expenses/nepal`)).toBe(false);
    expect(writeLog).toEqual([]);
  });
});


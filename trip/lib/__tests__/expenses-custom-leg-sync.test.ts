// @vitest-environment jsdom
//
// #85 — the expense sync seam on a CUSTOM trip, whose only leg is `'main'`.
//
// `lib/expenses-ports.ts` and `lib/expenses-remote.ts` used to hardcode `['nepal', 'japan']` in
// five places instead of importing `core/budget/model`'s pack-derived `LEGS`. On the DEFAULT pack
// the literal happens to equal the derived value, so the existing wired-behavior suite
// (`expenses-remote-sync.test.ts`) stayed green while every custom trip silently lost its
// expenses. That is the gap this file closes: the SAME seam, driven with a single-leg pack mocked
// in, so a literal and the derived value can never agree by accident again.
//
// The last block is the one that changes #85's severity from "expenses don't sync" to data LOSS.
// It was filed as code-read-only, explicitly NOT reproduced, because the sweep ran on a dormant
// build where `subscribeRemoteExpenses` never opens. It reproduces here.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Expense } from '@/core/budget/expenses';

// A single-leg custom pack. Everything else about `@/core/trips` stays REAL — only the active
// pack's legs are swapped, which is the one input `core/budget/model`'s `LEGS` derives from.
vi.mock('@/core/trips', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/core/trips')>();
  const real = orig.getActiveTrip();
  return {
    ...orig,
    getActiveTrip: () => ({
      ...real,
      legs: [
        {
          id: 'main',
          countryLabel: 'QA Sync Check',
          currency: 'USD',
          start: '2026-08-15',
          end: '2026-09-14',
          contentKey: 'main',
          utcOffsetMin: 0,
          fallbackCity: 'QA Sync Check',
        },
      ],
    }),
  };
});

vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => true,
  isTripRemoteConfigured: () => true,
  getTripId: () => 'custom-trip-token',
}));
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'QA Device A', token: 'QA', accent: '#000' }) };
});

const TRIP_ID = 'custom-trip-token';
type DocData = Record<string, unknown>;

const h = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  writeLog: [] as string[],
  snapshotCb: null as null | ((snap: unknown) => void),
}));

vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: { uid: 'device-uid-fake', getIdToken: async () => 'fake' } }),
  onAuthStateChanged: (_a: unknown, next: (u: unknown) => void) => {
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
  getFirestore: () => ({}),
  collection: (_db: unknown, ...segs: string[]) => ({ __type: 'collection', path: segs.join('/') }),
  doc: (_db: unknown, ...segs: string[]) => ({ __type: 'doc', path: segs.join('/') }),
  onSnapshot: (_ref: unknown, next: (snap: unknown) => void) => {
    h.snapshotCb = next;
    return () => {};
  },
  runTransaction: async (
    _db: unknown,
    update: (tx: {
      get: (ref: { path: string }) => Promise<{ exists: () => boolean; data: () => DocData | undefined }>;
      set: (ref: { path: string }, data: DocData) => void;
    }) => Promise<void>,
  ) => {
    await update({
      get: async (ref) => {
        const data = h.docs.get(ref.path) as DocData | undefined;
        return { exists: () => data !== undefined, data: () => data };
      },
      set: (ref, data) => {
        h.writeLog.push('tx-set:' + ref.path);
        h.docs.set(ref.path, JSON.parse(JSON.stringify(data)));
      },
    });
  },
}));

import { pushExpenseChunk, subscribeRemoteExpenses } from '@/lib/expenses-remote';
import { expensesOutboxSync } from '@/lib/expenses-ports';
import { LEGS } from '@/core/budget/model';
import { saveExpenses, loadExpenses } from '@/core/budget/storage';

function mainExpense(id: string, over: Partial<Expense> = {}): Expense {
  return {
    id,
    leg: 'main',
    category: 'food',
    amount: 2500,
    createdAt: 't',
    rev: 1,
    hlc: '000000000001000:000000:' + id,
    ...over,
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  localStorage.clear();
  h.docs.clear();
  h.writeLog.length = 0;
  h.snapshotCb = null;
});
afterEach(() => vi.restoreAllMocks());

describe('#85 — the seam reads the pack-derived LEGS', () => {
  it("a custom trip's LEGS is exactly ['main'] (the premise the rest of this file rests on)", () => {
    expect([...LEGS]).toEqual(['main']);
  });
});

describe("#85 — chunkDiff sees a custom trip's 'main' leg", () => {
  it("names 'main' as the changed chunk when a main-leg row is added", () => {
    // The push is outbox-decorated and the outbox only enqueues chunks chunkDiff names. With the
    // old hardcoded tuple this returned [] for EVERY possible edit on a custom trip, so nothing was
    // enqueued and pushChunk was never reached — the silent no-op at the heart of #85.
    expect(expensesOutboxSync.chunkDiff([], [mainExpense('e1')])).toEqual(['main']);
  });

  it('names nothing when the main-leg row-set is unchanged', () => {
    const rows = [mainExpense('e1')];
    expect(expensesOutboxSync.chunkDiff(rows, rows)).toEqual([]);
  });
});

describe("#85 — pushExpenseChunk writes the custom trip's 'main' chunk", () => {
  it('writes expenses/main (regression: returned silently, never writing)', async () => {
    await pushExpenseChunk([mainExpense('e1')], 'main');
    expect(h.writeLog).toEqual(['tx-set:trips/' + TRIP_ID + '/expenses/main']);
    const doc = h.docs.get('trips/' + TRIP_ID + '/expenses/main') as { leg: string; items: Expense[] };
    expect(doc.leg).toBe('main');
    expect(doc.items.map((i) => i.id)).toEqual(['e1']);
  });

  it('still refuses a chunk that is not a leg of the active pack', async () => {
    await pushExpenseChunk([mainExpense('e1')], 'nepal');
    expect(h.writeLog).toEqual([]);
  });
});

describe('#85 — the first remote snapshot must not wipe local expenses (data-loss regression)', () => {
  it('keeps local main-leg rows when the remote collection is empty', async () => {
    // The real-world state of every custom trip today: rows on disk locally and NOTHING remote,
    // because the push half of the bug meant nothing was ever written up.
    saveExpenses([mainExpense('local-1'), mainExpense('local-2')]);
    expect(loadExpenses().map((e) => e.id)).toEqual(['local-1', 'local-2']);

    subscribeRemoteExpenses();
    await flush();
    expect(h.snapshotCb).toBeTypeOf('function');

    // A real, authoritative, EMPTY server snapshot (not cache-sourced, no pending writes).
    h.snapshotCb!({ docs: [], metadata: { fromCache: false, hasPendingWrites: false } });
    await flush();

    // Before the fix applySnapshot looped the hardcoded ['nepal','japan'], built an empty result
    // and handed it to saveExpenses — deleting both rows off the device.
    expect(loadExpenses().map((e) => e.id)).toEqual(['local-1', 'local-2']);
  });

  it('seeds the never-synced main chunk UP instead of pulling an empty list down', async () => {
    saveExpenses([mainExpense('local-1')]);
    subscribeRemoteExpenses();
    await flush();
    h.snapshotCb!({ docs: [], metadata: { fromCache: false, hasPendingWrites: false } });
    await flush();
    expect(h.writeLog).toEqual(['tx-set:trips/' + TRIP_ID + '/expenses/main']);
  });

  it('merges a remote main chunk back down (the read half of two-device sync)', async () => {
    saveExpenses([mainExpense('local-1')]);
    subscribeRemoteExpenses();
    await flush();
    h.snapshotCb!({
      docs: [{ id: 'main', data: () => ({ leg: 'main', items: [mainExpense('peer-1')] }) }],
      metadata: { fromCache: false, hasPendingWrites: false },
    });
    await flush();
    // The peer's row is now on this device — before the fix the doc id 'main' was skipped outright.
    expect(loadExpenses().map((e) => e.id)).toContain('peer-1');
  });
});

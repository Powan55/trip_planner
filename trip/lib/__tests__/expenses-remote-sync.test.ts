// @vitest-environment jsdom
//
// S142 — WIRED-behavior unit suite for the expense Sync-v2 seam (lib/expenses-remote.ts +
// lib/expenses-ports.ts), against a FAKE Firestore (the firebase SDK modules are vi.mock'd) + the
// real merge core. This is the "the wiring is correct off a live server" proof the two-client E2E
// cannot run in the dormant sandbox (no firebase env / JDK ceiling). It proves, on a real run:
//
//   1. pushChunkMerged composes the transactional read→merge→set: a concurrent
//      same-leg peer row is NOT clobbered — both rows survive the merged write.
//   2. ONE merged write per CHANGED leg (the outbox-decorated SyncPort.push + chunkDiff): editing
//      only the nepal leg issues exactly ONE tx-set on expenses/nepal (japan untouched); editing
//      both legs issues one write PER leg — never a whole-collection rewrite (D-088/D-151).
//   3. An emptied leg still writes items:[] (D-018/D-091 parity — not a skip).
//
// D-039 (push only from commit/outbox), D-149/D-151 (chunked-by-leg merge), D-088 (write per
// changed chunk) cited. Two-client live convergence stays live-QA-deferred.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Expense } from '@/core/budget/expenses';

vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => true,
  // #10: mirrors isRemoteConfigured — every mocked getTripId here is non-empty, so the two gates agree.
  isTripRemoteConfigured: () => true,
  getTripId: () => 'nepal-japan-2026',
}));
// The outbox-decorated push gates on an active traveler (D-055); mock one in.
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }) };
});

const TRIP_ID = 'nepal-japan-2026';
type DocData = Record<string, unknown>;

class FakeFirestore {
  docs = new Map<string, DocData>();
  setDocData(path: string, data: DocData) {
    this.docs.set(path, JSON.parse(JSON.stringify(data)));
  }
}
const fake = new FakeFirestore();
const writeLog: string[] = [];

function pathOf(segments: string[]): string {
  return segments.join('/');
}

// #10 — `getRemote()` now signs the device in anonymously BEFORE it resolves (the rules grew an
// auth floor), so the auth module is faked here too. `queueMicrotask`, not `setTimeout`: the
// observer must resolve after the synchronous return of `onAuthStateChanged` (as the real SDK
// does) but WITHOUT depending on a timer, so a suite running under fake timers still gets a handle.
vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: { uid: 'device-uid-fake', getIdToken: async () => 'fake-id-token' } }),
  onAuthStateChanged: (_auth: unknown, next: (u: unknown) => void) => {
    queueMicrotask(() => next(null)); // no restored session ⇒ the anonymous sign-in below runs
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
        writeLog.push(`tx-set:${ref.path}`);
        fake.setDocData(ref.path, data);
      },
    };
    await update(tx);
  },
}));

import { pushChunkMerged, pushExpenseChunk } from '@/lib/expenses-remote';
import { expensesSyncPort } from '@/lib/expenses-ports';
import type { Firestore } from 'firebase/firestore';
import * as fs from 'firebase/firestore';

function exp(id: string, over: Partial<Expense> = {}): Expense {
  return { id, leg: 'nepal', category: 'food', amount: 1000, createdAt: 't', rev: 1, hlc: `000000000001000:000000:${id}`, ...over };
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  localStorage.clear();
  fake.docs.clear();
  writeLog.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('pushChunkMerged — transactional read→merge→set does NOT clobber a concurrent peer row', () => {
  it('merges a local leg-row on top of a concurrent remote leg-row (both survive)', async () => {
    // Remote already has friend-B's expense on the nepal leg.
    fake.setDocData(`trips/${TRIP_ID}/expenses/nepal`, {
      leg: 'nepal',
      items: [exp('B', { hlc: '000000000002000:000000:friend' })],
    });
    // We push OUR local nepal rows, which only know about expense A.
    await pushChunkMerged(fake as unknown as Firestore, fs, 'nepal', [exp('A', { hlc: '000000000003000:000000:me' })]);

    const written = fake.docs.get(`trips/${TRIP_ID}/expenses/nepal`) as { items: Expense[] };
    expect(written.items.map((e) => e.id).sort()).toEqual(['A', 'B']);
    expect(writeLog).toContain(`tx-set:trips/${TRIP_ID}/expenses/nepal`);
  });

  it('an emptied leg writes items:[] (D-018/D-091 parity — not a skip)', async () => {
    await pushExpenseChunk([], 'japan'); // no rows for japan → write an empty leg doc
    const written = fake.docs.get(`trips/${TRIP_ID}/expenses/japan`) as { items: Expense[] };
    expect(written.items).toEqual([]);
    expect(writeLog).toEqual([`tx-set:trips/${TRIP_ID}/expenses/japan`]);
  });
});

describe('SyncPort.push (outbox-decorated) — ONE merged write per CHANGED leg (D-088/D-151)', () => {
  it('editing ONLY the nepal leg issues exactly one tx-set on expenses/nepal (japan untouched)', async () => {
    const prev: Expense[] = [exp('n1', { leg: 'nepal' }), exp('j1', { leg: 'japan' })];
    const next: Expense[] = [exp('n1', { leg: 'nepal', amount: 9999 }), exp('j1', { leg: 'japan' })];
    await expensesSyncPort.push(prev, next);
    await flush();
    expect(writeLog).toEqual([`tx-set:trips/${TRIP_ID}/expenses/nepal`]); // exactly ONE write, nepal only
  });

  it('editing BOTH legs issues one write per leg (never a whole-collection rewrite)', async () => {
    const prev: Expense[] = [exp('n1', { leg: 'nepal' }), exp('j1', { leg: 'japan' })];
    const next: Expense[] = [
      exp('n1', { leg: 'nepal', amount: 5 }),
      exp('j1', { leg: 'japan', amount: 7 }),
    ];
    await expensesSyncPort.push(prev, next);
    await flush();
    expect(writeLog.filter((w) => w.startsWith('tx-set:')).sort()).toEqual([
      `tx-set:trips/${TRIP_ID}/expenses/japan`,
      `tx-set:trips/${TRIP_ID}/expenses/nepal`,
    ]);
  });

  it('an unchanged commit issues NO write (chunkDiff empty → no network)', async () => {
    const same: Expense[] = [exp('n1', { leg: 'nepal' })];
    await expensesSyncPort.push(same, same);
    await flush();
    expect(writeLog).toEqual([]);
  });
});

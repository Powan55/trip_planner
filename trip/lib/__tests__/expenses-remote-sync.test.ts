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
import { sanitizeExpenses, type Expense } from '@/core/budget/expenses';

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
  errorListeners: Array<(err: unknown) => void> = [];
  snapshotListeners: Array<(snap: unknown) => void> = [];
  emitServerSnapshot() {
    const prefix = `trips/${TRIP_ID}/expenses/`;
    const docs = [...this.docs.entries()]
      .filter(([p]) => p.startsWith(prefix))
      .map(([p, data]) => ({ id: p.slice(prefix.length), data: () => data }));
    for (const cb of this.snapshotListeners) cb({ metadata: { fromCache: false, hasPendingWrites: false }, docs });
  }
  setDocData(path: string, data: DocData) {
    this.docs.set(path, JSON.parse(JSON.stringify(data)));
  }
  // #345: drive the onSnapshot error callback (rules refusal / network / quota).
  emitError(err: unknown) {
    for (const cb of this.errorListeners) cb(err);
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
  onSnapshot: (
    _q: unknown,
    onNext: (snap: unknown) => void,
    onError?: (e: unknown) => void,
  ) => {
    if (onError) fake.errorListeners.push(onError);
    fake.snapshotListeners.push(onNext);
    return () => {
      fake.snapshotListeners.splice(fake.snapshotListeners.indexOf(onNext), 1);
      if (onError) {
        const i = fake.errorListeners.indexOf(onError);
        if (i >= 0) fake.errorListeners.splice(i, 1);
      }
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

import { pushChunkMerged, pushExpenseChunk, chunkDocToRows, subscribeRemoteExpenses } from '@/lib/expenses-remote';
import { expensesSyncPort } from '@/lib/expenses-ports';
import { isReadDenied, setReadDenied } from '@/core/sync/read-denied';
import type { Firestore } from 'firebase/firestore';
import * as fs from 'firebase/firestore';
import { saveExpenses, loadExpenses } from '@/core/budget/storage';
import { expensesToSpent } from '@/core/budget/expenses';

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
  fake.errorListeners = [];
  fake.snapshotListeners = [];
  writeLog.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  setReadDenied('expenses', false); // #345: module-singleton flag — reset between tests
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

  it('a poison row from a peer does not wedge the leg chunk forever (#126)', async () => {
    // The remote array is UNTRUSTED bytes. A null/garbage element used to reach `mergeItems`,
    // which dereferences `it.id` and throws — rejecting the transaction, leaving the leg chunk
    // dirty, and retrying forever. `chunkDocToRows` now sanitises at the read boundary.
    fake.setDocData(`trips/${TRIP_ID}/expenses/nepal`, {
      leg: 'nepal',
      items: [null, 'not-an-expense', { noIdAtAll: true }, exp('B', { hlc: '000000000002000:000000:friend' })],
    });

    await expect(
      pushChunkMerged(fake as unknown as Firestore, fs, 'nepal', [exp('A', { hlc: '000000000003000:000000:me' })]),
    ).resolves.not.toThrow();

    const written = fake.docs.get(`trips/${TRIP_ID}/expenses/nepal`) as { items: Expense[] };
    expect(written.items.map((e) => e.id).sort()).toEqual(['A', 'B']);
    expect(writeLog).toEqual([`tx-set:trips/${TRIP_ID}/expenses/nepal`]);
  });

  it("the read boundary retains a remote-ONLY row's forward keys AND a forward category (no id collision) (#138, #150)", async () => {
    // `sanitizeExpense` used to rebuild each row from a fixed field list, so any key a NEWER build
    // wrote was dropped — and since the sanitized row is written straight back up here, an older
    // client permanently erased the newer client's data from the server on its next sync. It also
    // hard-rejected a `category` this build doesn't recognise, dropping the WHOLE row (#150) —
    // exactly this read boundary is where a peer on a newer build hits that every sync.
    // Scope of THIS test: the read boundary only. Remote 'B'/'D' have no local counterpart, so they
    // are carried through the merge untouched. The collision case is the test below.
    fake.setDocData(`trips/${TRIP_ID}/expenses/nepal`, {
      leg: 'nepal',
      items: [
        {
          ...exp('B', { hlc: '000000000002000:000000:friend' }),
          currency: 'NPR', // fields from a future build this one has no code for
          tags: ['receipt'],
          date: 'nope', // …while a DECLARED field with a bad value is still dropped
          note: '   ',
          rev: 'not-a-number',
        },
        { id: 'D', leg: 'nepal', category: 'teleportation', amount: 1, createdAt: 't' }, // forward category, retained (#150)
        { leg: 'nepal', category: 'food', amount: 1, createdAt: 't' }, // no id — still unsalvageable
      ],
    });
    await pushChunkMerged(fake as unknown as Firestore, fs, 'nepal', [exp('A', { hlc: '000000000003000:000000:me' })]);

    const written = fake.docs.get(`trips/${TRIP_ID}/expenses/nepal`) as {
      items: Array<Expense & { currency?: string; tags?: string[] }>;
    };
    expect(written.items.map((e) => e.id).sort()).toEqual(['A', 'B', 'D']); // no-id row rejected, as before
    const b = written.items.find((e) => e.id === 'B')!;
    expect(b.currency).toBe('NPR');
    expect(b.tags).toEqual(['receipt']);
    // Validation is unchanged: the bad declared fields are gone from what went back up.
    expect(b).not.toHaveProperty('date');
    expect(b).not.toHaveProperty('note');
    expect(b).not.toHaveProperty('rev');
    // 'D's forward category survived the read→merge→write round trip intact (#150).
    expect(written.items.find((e) => e.id === 'D')!.category).toBe('teleportation');
  });

  it('a forward key survives the SAME-id, SAME-hlc collision the round trip actually creates (#138)', async () => {
    // The real path, and the one retention alone did not fix. A snapshot lands the peer's rich row;
    // `saveExpenses` sanitizes STRICT on the way to disk; `commit()` re-reads that stripped row and
    // pushes it — same id, same hlc. `mergeItems` used to break that tie on `contentFingerprint`,
    // which ranks the row with MORE keys lower, so the strip won and the key was erased upstream.
    const HLC = '000000000002000:000000:friend';
    const fromPeer = { ...exp('A', { hlc: HLC }), currency: 'NPR', tags: ['receipt'] };
    fake.setDocData(`trips/${TRIP_ID}/expenses/nepal`, { leg: 'nepal', items: [fromPeer] });
    // Exactly what the local slot holds after saveExpenses()/loadExpenses() — no hand-editing.
    const localRows = sanitizeExpenses([fromPeer]);
    expect(localRows[0]).not.toHaveProperty('currency'); // the strip really happened

    await pushChunkMerged(fake as unknown as Firestore, fs, 'nepal', localRows);

    const written = fake.docs.get(`trips/${TRIP_ID}/expenses/nepal`) as {
      items: Array<Expense & { currency?: string; tags?: string[] }>;
    };
    const a = written.items.find((e) => e.id === 'A')!;
    expect(a.currency).toBe('NPR');
    expect(a.tags).toEqual(['receipt']);
  });

  it('the LOCAL entry point stays a strict allowlist — the two directions are disjoint (D-159)', async () => {
    // The whole design of #138's fix: retention is opt-in and set ONLY at the remote read. If this
    // ever flips to strip-nothing by default, a rogue/legacy local row carrying a photo ref reaches
    // `pushChunkMerged`'s merge and gets written to Firestore, which D-159 forbids permanently.
    const rogue = { id: 'L1', leg: 'nepal', category: 'food', amount: 10, createdAt: 't', photoIds: ['ph-x'] };
    expect(sanitizeExpenses([rogue])[0]).not.toHaveProperty('photoIds'); // default = strict
    expect(sanitizeExpenses([rogue], { keepUnknownKeys: true })[0]).toHaveProperty('photoIds');
    // …and the remote read is the one caller that opts in.
    expect(chunkDocToRows({ items: [rogue] })[0]).toHaveProperty('photoIds');
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

describe('#345 — a permission-denied READ stream is classified, not endlessly retried', () => {
  it('sets isReadDenied() and does NOT arm the `online` retry listener', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');

    const unsub = subscribeRemoteExpenses();
    await flush(); // listener attaches

    expect(isReadDenied()).toBe(false);
    fake.emitError({ code: 'permission-denied', message: 'Missing or insufficient permissions.' });

    expect(isReadDenied()).toBe(true);
    expect(addSpy.mock.calls.some(([type]) => type === 'online')).toBe(false);
    unsub();
  });

  it('a non-denial stream error (network/quota) still arms the `online` retry, unaffected', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');

    const unsub = subscribeRemoteExpenses();
    await flush();

    fake.emitError({ code: 'unavailable', message: 'network blip' });

    expect(isReadDenied()).toBe(false);
    expect(addSpy.mock.calls.some(([type]) => type === 'online')).toBe(true);
    unsub();
  });
});

describe('#532 — moving an expense to another leg leaves one row, not two', () => {
  const NEPAL = `trips/${TRIP_ID}/expenses/nepal`;
  const JAPAN = `trips/${TRIP_ID}/expenses/japan`;
  // Fresh stamps: an epoch-1970 tombstone is past the GC horizon and would be pruned on write.
  const now = Date.now();
  const h = (n: number) => `${String(now + n * 1000).padStart(15, '0')}:000000:me`;
  const items = (path: string) => (fake.docs.get(path) as { items: Expense[] }).items;

  async function reload(): Promise<Expense[]> {
    const unsub = subscribeRemoteExpenses();
    await flush();
    fake.emitServerSnapshot();
    unsub();
    return loadExpenses();
  }

  it('a move tombstones the old leg on push, and a reload shows one row outside leg A', async () => {
    const before = exp('X', { leg: 'nepal', amount: 100, hlc: h(1) });
    fake.setDocData(NEPAL, { leg: 'nepal', items: [before] });
    const after = { ...before, leg: 'japan', rev: 2, hlc: h(2) };

    await expensesSyncPort.push([before], [after]);
    await flush();
    expect(items(NEPAL)).toEqual([expect.objectContaining({ id: 'X', deleted: true, hlc: after.hlc })]);
    expect(items(JAPAN)).toEqual([expect.objectContaining({ id: 'X', leg: 'japan' })]);

    saveExpenses([after]);
    const rows = await reload();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'X', leg: 'japan' });
    expect(rows[0].deleted).toBeUndefined();
    expect(expensesToSpent(rows).byLeg).toEqual({ japan: 100 });
  });

  it('already-duplicated remote data heals: newest copy wins on read, the stale leg is tombstoned on its next push', async () => {
    fake.setDocData(NEPAL, { leg: 'nepal', items: [exp('X', { leg: 'nepal', hlc: h(1) })] });
    fake.setDocData(JAPAN, { leg: 'japan', items: [exp('X', { leg: 'japan', hlc: h(2) })] });

    const rows = await reload();
    expect(rows.map((e) => [e.id, e.leg])).toEqual([['X', 'japan']]);
    expect(expensesToSpent(rows).byLeg).toEqual({ japan: 1000 });

    await pushExpenseChunk(rows, 'nepal');
    expect(items(NEPAL)).toEqual([expect.objectContaining({ id: 'X', deleted: true })]);
  });

  it('a delete after a move does not resurrect the old leg copy', async () => {
    fake.setDocData(NEPAL, { leg: 'nepal', items: [exp('X', { leg: 'nepal', hlc: h(1) })] });
    const moved = exp('X', { leg: 'japan', rev: 2, hlc: h(2) });
    fake.setDocData(JAPAN, { leg: 'japan', items: [moved] });
    const deleted = { ...moved, rev: 3, hlc: h(3), deleted: true };

    await expensesSyncPort.push([moved], [deleted]);
    await flush();
    saveExpenses([deleted]);
    const rows = await reload();
    // What useExpenses hands the budget views: the live rows of the persisted list.
    expect(expensesToSpent(rows.filter((e) => e.deleted !== true))).toEqual({});

    await pushExpenseChunk(rows, 'nepal');
    expect(items(NEPAL).every((e) => e.deleted === true)).toBe(true);
  });

  it('device A moves X to japan while device B, offline, edits X in nepal at an older hlc: exactly one live X survives, newest hlc wins, nepal stays tombstoned', async () => {
    const stale = exp('X', { leg: 'nepal', hlc: h(1) });
    fake.setDocData(NEPAL, { leg: 'nepal', items: [stale] });

    // Device A's move syncs first.
    const moved = { ...stale, leg: 'japan', rev: 2, hlc: h(3) };
    await expensesSyncPort.push([stale], [moved]);
    await flush();
    expect(items(NEPAL)).toEqual([expect.objectContaining({ id: 'X', deleted: true, hlc: moved.hlc })]);

    // Device B never learned of the move (offline since before it) and pushes its own older edit to
    // the leg it still thinks X lives in. It has no japan row locally.
    const bEdit = { ...stale, amount: 250, rev: 2, hlc: h(2) };
    await pushChunkMerged(fake as unknown as Firestore, fs, 'nepal', [bEdit]);

    // The tombstone's hlc (h3) beats B's stale edit (h2) — tombstone-wins-by-hlc — so nepal stays
    // deleted and japan is untouched.
    expect(items(NEPAL)).toEqual([expect.objectContaining({ id: 'X', deleted: true, hlc: moved.hlc })]);
    expect(items(JAPAN)).toEqual([expect.objectContaining({ id: 'X', leg: 'japan' })]);

    saveExpenses([moved]);
    const rows = await reload();
    const live = rows.filter((r) => r.deleted !== true);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ id: 'X', leg: 'japan' });
  });
});

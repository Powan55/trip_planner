// @vitest-environment jsdom
//
// S143 — WIRED-behavior unit suite for the budget Sync-v2 seam (lib/budget-remote.ts +
// lib/budget-ports.ts), against a FAKE Firestore (the firebase SDK modules are vi.mock'd) + the real
// merge/flatten core. This is the "the wiring is correct off a live server" proof the two-client E2E
// cannot run in the dormant sandbox (no firebase env / JDK ceiling). It proves, on a real run:
//
//   1. pushBudgetMerged composes the transactional read→merge→set: a concurrent
//      peer edit to a DIFFERENT field is NOT clobbered — both fields survive the merged write.
//   2. ONE merged write to the SINGLETON budget/model doc per value change (the outbox-decorated
//      SyncPort.push + chunkDiff); an unchanged commit issues NO write.
//   3. First-snapshot DOC PRESENCE: an ABSENT doc first-snapshot seeds from local (one write);
//      a PRESENT doc merges remote into local and applies it.
//
// D-039 (push only from commit/outbox), D-149 (field-LWW), D-088 (one tiny doc) cited. Two-client
// live convergence stays live-QA-deferred.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BudgetModel } from '@/core/budget/model';
import type { BudgetFields } from '@/core/sync/merge-budget';

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
const DOC_PATH = `trips/${TRIP_ID}/budget/model`;
type DocData = Record<string, unknown>;

class FakeFirestore {
  docs = new Map<string, DocData>();
  setDocData(path: string, data: DocData) {
    this.docs.set(path, JSON.parse(JSON.stringify(data)));
  }
}
const fake = new FakeFirestore();
const writeLog: string[] = [];
type SnapCb = (snap: unknown) => void;
let lastOnNext: SnapCb | null = null;
let lastOnError: ((err: unknown) => void) | null = null;

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
  onSnapshot: (_ref: unknown, onNext: SnapCb, onError?: (err: unknown) => void) => {
    lastOnNext = onNext;
    lastOnError = onError ?? null;
    return () => {};
  },
}));

import { pushBudgetMerged, subscribeRemoteBudget } from '@/lib/budget-remote';
import { budgetSyncPort } from '@/lib/budget-ports';
import { loadBudget } from '@/core/budget/storage';
import { isReadDenied, setReadDenied } from '@/core/sync/read-denied';
import type { Firestore } from 'firebase/firestore';
import * as fs from 'firebase/firestore';

function hlc(pt: number, actor = 'A'): string {
  return `${String(pt).padStart(15, '0')}:${'000000'}:${actor}`;
}

function model(over: Partial<BudgetModel> = {}): BudgetModel {
  return {
    version: 1,
    homeCurrency: 'USD',
    rates: { NPR: 138, JPY: 155 },
    legBudgets: { nepal: 0, japan: 0 },
    categoryBudgets: {},
    ...over,
  };
}

/** Deliver a fake server snapshot to the subscribed onNext. */
function deliverSnapshot(fields: BudgetFields | null): void {
  const data = fields === null ? undefined : { version: 1, fields };
  lastOnNext?.({
    metadata: { hasPendingWrites: false, fromCache: false },
    exists: () => data !== undefined,
    data: () => data,
  });
}

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  localStorage.clear();
  fake.docs.clear();
  writeLog.length = 0;
  lastOnNext = null;
  lastOnError = null;
});
afterEach(() => {
  vi.restoreAllMocks();
  setReadDenied('budget', false); // #345: module-singleton flag — reset between tests
});

describe('pushBudgetMerged — read→merge→set does NOT clobber a concurrent peer FIELD (both survive)', () => {
  it('merges our local field on top of a concurrent remote field', async () => {
    // Remote already has friend-B's japan budget.
    fake.setDocData(DOC_PATH, { version: 1, fields: { 'legBudgets.japan': { v: 31000, hlc: hlc(2000, 'B') } } });
    // We push OUR model which set the nepal budget (stamped).
    const localModel = model({ legBudgets: { nepal: 20000, japan: 0 }, sync: { fieldHlc: { 'legBudgets.nepal': hlc(3000, 'me') } } });
    await pushBudgetMerged(fake as unknown as Firestore, fs, localModel);

    const written = fake.docs.get(DOC_PATH) as { fields: BudgetFields };
    expect(written.fields['legBudgets.nepal'].v).toBe(20000); // ours survived
    expect(written.fields['legBudgets.japan'].v).toBe(31000); // peer's survived
    expect(writeLog).toContain(`tx-set:${DOC_PATH}`);
  });
});

describe('budgetDocToFields — a poison field entry does not wedge the outbox forever', () => {
  it('an entry with no hlc (or a non-string one) is dropped at the read; the transaction still commits', async () => {
    // `fields` is UNTRUSTED bytes: the trip id IS the capability, so an older/other client can put
    // anything here. `mergeBudget` calls `parse(entry.hlc)` unguarded, so one entry like this threw
    // a TypeError INSIDE runTransaction — rejecting the push, leaving the 'model' chunk dirty, and
    // re-attempting on every `online`, every visibilitychange and every mount, forever.
    fake.setDocData(DOC_PATH, {
      version: 1,
      fields: {
        'rates.NPR': { v: 999 }, // no hlc at all
        'rates.JPY': { v: 888, hlc: 12345 }, // hlc is a number
        'legBudgets.japan': null, // not an object
        'legBudgets.nepal': { v: 31000, hlc: hlc(2000, 'B') }, // the one good entry
      },
    });
    const localModel = model({ homeCurrency: 'NPR', sync: { fieldHlc: { homeCurrency: hlc(3000, 'me') } } });

    await expect(pushBudgetMerged(fake as unknown as Firestore, fs, localModel)).resolves.not.toThrow();

    const written = fake.docs.get(DOC_PATH) as { fields: BudgetFields };
    expect(writeLog).toContain(`tx-set:${DOC_PATH}`);
    expect(written.fields.homeCurrency.v).toBe('NPR'); // ours survived
    expect(written.fields['legBudgets.nepal'].v).toBe(31000); // the good peer entry survived
    // The poison entries never reach the merge, so each path keeps this device's own value rather
    // than the junk (they are LOCAL leaves too, so the path itself is expected to be present).
    expect(written.fields['rates.NPR'].v).toBe(138); // not 999
    expect(written.fields['rates.JPY'].v).toBe(155); // not 888
    expect(written.fields['legBudgets.japan'].v).toBe(0); // not the null entry
  });
});

describe('SyncPort.push (outbox-decorated) — ONE merged write to the singleton per value change', () => {
  it('editing a field issues exactly one tx-set on budget/model, carrying the stamped HLC', async () => {
    const prev = model({ sync: { fieldHlc: {} } });
    const next = model({ legBudgets: { nepal: 20000, japan: 0 }, sync: { fieldHlc: { 'legBudgets.nepal': hlc(3000, 'me') } } });
    await budgetSyncPort.push(prev, next);
    await tick();
    expect(writeLog).toEqual([`tx-set:${DOC_PATH}`]); // exactly ONE write
    const written = fake.docs.get(DOC_PATH) as { fields: BudgetFields };
    expect(written.fields['legBudgets.nepal']).toEqual({ v: 20000, hlc: hlc(3000, 'me') });
  });

  it('an unchanged commit issues NO write (chunkDiff empty → no network)', async () => {
    const same = model({ legBudgets: { nepal: 20000, japan: 0 } });
    await budgetSyncPort.push(same, same);
    await tick();
    expect(writeLog).toEqual([]);
  });
});

describe('subscribe — first-snapshot DOC PRESENCE', () => {
  it('ABSENT doc → seeds from local (one write up), local untouched', async () => {
    // Local already has a nepal budget saved.
    const seeded = model({ legBudgets: { nepal: 12000, japan: 0 } });
    const { saveBudget } = await import('@/core/budget/storage');
    saveBudget(seeded);

    const unsub = budgetSyncPort.subscribe();
    await tick(); // let the dynamic import + attemptSetup resolve
    deliverSnapshot(null); // absent doc
    await tick();

    expect(writeLog).toEqual([`tx-set:${DOC_PATH}`]); // seeded up exactly once
    const written = fake.docs.get(DOC_PATH) as { fields: BudgetFields };
    expect(written.fields['legBudgets.nepal'].v).toBe(12000);
    expect(loadBudget().legBudgets.nepal).toBe(12000); // local untouched
    unsub();
  });

  it('PRESENT doc → merges remote into local and applies it (a peer edit lands locally)', async () => {
    const unsub = budgetSyncPort.subscribe();
    await tick();
    // A peer has set the japan budget (stamped later than any local seed).
    deliverSnapshot({ 'legBudgets.japan': { v: 31000, hlc: hlc(9000, 'peer') } });
    await tick();

    expect(loadBudget().legBudgets.japan).toBe(31000); // the peer's edit is now local
    unsub();
  });
});

describe('#345 — a permission-denied READ stream is classified, not endlessly retried', () => {
  it('sets isReadDenied() and does NOT arm the `online` retry listener', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');

    const unsub = subscribeRemoteBudget();
    await tick(); // listener attaches

    expect(isReadDenied()).toBe(false);
    lastOnError?.({ code: 'permission-denied', message: 'Missing or insufficient permissions.' });

    expect(isReadDenied()).toBe(true);
    expect(addSpy.mock.calls.some(([type]) => type === 'online')).toBe(false);
    unsub();
  });

  it('a non-denial stream error (network/quota) still arms the `online` retry, unaffected', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');

    const unsub = subscribeRemoteBudget();
    await tick();

    lastOnError?.({ code: 'unavailable', message: 'network blip' });

    expect(isReadDenied()).toBe(false);
    expect(addSpy.mock.calls.some(([type]) => type === 'online')).toBe(true);
    unsub();
  });
});

// @vitest-environment jsdom
//
// A device's defaults are never written into the shared trip. Each synced domain seeds an absent
// remote from local on its first snapshot; on the shared trip that seed is skipped, and on any
// other trip it still happens (the control that makes the assertion mean something).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SHARED_TRIP_ID } from '@/lib/shared-trip';

const gate = vi.hoisted(() => ({ tripId: '' }));

vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => true,
  isTripRemoteConfigured: () => true,
  getTripId: () => gate.tripId,
}));
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }) };
});

type Listener = { kind: 'doc' | 'collection'; path: string; next: (snap: unknown) => void };
const listeners: Listener[] = [];
const writeLog: string[] = [];
const store = new Map<string, Record<string, unknown>>();

vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: { email: 'fake@accounts.trip-planner.invalid', uid: 'uid-a', getIdToken: async () => 't' } }),
  onAuthStateChanged: (_a: unknown, next: (u: unknown) => void) => {
    queueMicrotask(() => next(null));
    return () => {};
  },
  signInAnonymously: async () => ({ user: { uid: 'uid-a' } }),
}));
vi.mock('firebase/app', () => ({ initializeApp: () => ({}), getApps: () => [], getApp: () => ({}) }));
vi.mock('firebase/firestore', () => {
  const pathOf = (segs: string[]) => segs.join('/');
  const read = (ref: { path: string }) => {
    const data = store.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
  };
  return {
    getFirestore: () => ({}),
    initializeFirestore: () => ({}),
    persistentLocalCache: () => ({}),
    collection: (_db: unknown, ...segs: string[]) => ({ __type: 'collection', path: pathOf(segs) }),
    doc: (_db: unknown, ...segs: string[]) => ({ __type: 'doc', path: pathOf(segs) }),
    onSnapshot: (ref: { __type: 'doc' | 'collection'; path: string }, next: (snap: unknown) => void) => {
      listeners.push({ kind: ref.__type, path: ref.path, next });
      return () => {};
    },
    getDoc: async (ref: { path: string }) => read(ref),
    getDocFromServer: async (ref: { path: string }) => read(ref),
    setDoc: async (ref: { path: string }) => void writeLog.push(`set:${ref.path}`),
    serverTimestamp: () => 'TS',
    runTransaction: async (
      _db: unknown,
      update: (tx: { get: (r: { path: string }) => Promise<unknown>; set: (r: { path: string }) => void }) => Promise<void>,
    ) => {
      await update({ get: async (r) => read(r), set: (r) => void writeLog.push(`set:${r.path}`) });
    },
  };
});

import { subscribeRemote } from '@/lib/itinerary-remote';
import { subscribeRemoteBudget } from '@/lib/budget-remote';
import { subscribeRemoteDocs } from '@/lib/docs-remote';
import { subscribeRemotePlaces } from '@/lib/places-remote';
import { subscribeRemoteExpenses } from '@/lib/expenses-remote';
import { savePlans } from '@/lib/itinerary-storage';

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
}

/** Deliver an empty first SERVER snapshot to every subscribed listener. */
async function firstSnapshotEverywhere(): Promise<void> {
  await settle();
  for (const l of listeners) {
    const metadata = { fromCache: false, hasPendingWrites: false };
    l.next(l.kind === 'doc' ? { metadata, exists: () => false, data: () => undefined } : { metadata, docs: [] });
  }
  await settle();
}

const subscribers = [subscribeRemote, subscribeRemoteBudget, subscribeRemoteDocs, subscribeRemotePlaces, subscribeRemoteExpenses];

beforeEach(() => {
  localStorage.clear();
  listeners.length = 0;
  writeLog.length = 0;
  store.clear();
  savePlans([{ date: '2026-12-09', city: 'Kathmandu', country: 'nepal', items: [] }]);
});
afterEach(() => vi.restoreAllMocks());

describe('the shared trip is never seeded from a device', () => {
  it('writes nothing on the first snapshot of an absent shared trip, in any domain', async () => {
    gate.tripId = SHARED_TRIP_ID;
    const unsubs = subscribers.map((s) => s());
    await firstSnapshotEverywhere();
    expect(listeners.length).toBeGreaterThanOrEqual(subscribers.length);
    expect(writeLog).toEqual([]);
    unsubs.forEach((u) => u());
  });

  it('control: the same first snapshot on any other trip does seed', async () => {
    gate.tripId = 'some-other-trip';
    const unsubs = subscribers.map((s) => s());
    await firstSnapshotEverywhere();
    for (const part of ['/days/', '/budget/', '/docs/', '/places/', '/expenses/']) {
      expect(writeLog.some((w) => w.includes(part)), part).toBe(true);
    }
    unsubs.forEach((u) => u());
  });

  it('an existing but empty shared doc is not filled with the sample when nothing was persisted here', async () => {
    gate.tripId = SHARED_TRIP_ID;
    localStorage.clear();
    store.set(`trips/${SHARED_TRIP_ID}`, { schemaVersion: 1 });
    const unsub = subscribeRemote();
    await firstSnapshotEverywhere();
    expect(writeLog).toEqual([]);
    unsub();
  });

  it('...but a persisted local plan still heals it', async () => {
    gate.tripId = SHARED_TRIP_ID;
    store.set(`trips/${SHARED_TRIP_ID}`, { schemaVersion: 1 });
    const unsub = subscribeRemote();
    await firstSnapshotEverywhere();
    expect(writeLog.some((w) => w.includes('/days/2026-12-09'))).toBe(true);
    unsub();
  });
});

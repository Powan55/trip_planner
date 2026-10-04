// @vitest-environment jsdom
//
// #641: a device whose read of a gated trip is refused does NOT add itself to the roster any more
// (the D-595 self-join is gone; joining takes an invite). It gets the access-pending prompt instead.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => true,
  isTripRemoteConfigured: () => true,
  getTripId: () => 'trip-abc',
}));
vi.mock('firebase/app', () => ({
  initializeApp: () => ({ name: 'fake' }),
  getApps: () => [],
  getApp: () => ({ name: 'fake' }),
}));
vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: { email: 'fake@accounts.trip-planner.invalid', uid: 'device-uid-fake', getIdToken: async () => 'tok' } }),
  onAuthStateChanged: (_auth: unknown, next: (u: unknown) => void) => {
    queueMicrotask(() => next({ uid: 'device-uid-fake' }));
    return () => {};
  },
  signInAnonymously: async () => ({ user: { uid: 'device-uid-fake' } }),
}));

const fake = vi.hoisted(() => ({
  readDenied: false,
  offline: false,
  doc: undefined as Record<string, unknown> | undefined,
  updates: [] as { path: string; data: Record<string, unknown> }[],
}));

function permissionDenied(): Error {
  return Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
}

vi.mock('firebase/firestore', () => ({
  getFirestore: () => ({ __type: 'db' }),
  initializeFirestore: () => ({ __type: 'db' }),
  persistentLocalCache: () => ({}),
  doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
  getDocFromServer: async () => {
    if (fake.offline) throw Object.assign(new Error('offline'), { code: 'unavailable' });
    if (fake.readDenied) throw permissionDenied();
    return { exists: () => fake.doc !== undefined, data: () => fake.doc };
  },
  updateDoc: async (ref: { path: string }, data: Record<string, unknown>) => {
    fake.updates.push({ path: ref.path, data });
  },
}));

import { ensureMembership, ensureKnownTripMemberships, TRIP_ACCESS_PENDING_EVENT } from '@/lib/trips-remote';
import { upsertKnownTrip } from '@/core/trips/registry';

const TRIP = 'trip-abc';
let pending: number;
const onPending = () => (pending += 1);

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  fake.readDenied = false;
  fake.offline = false;
  fake.doc = undefined;
  fake.updates.length = 0;
  pending = 0;
  window.addEventListener(TRIP_ACCESS_PENDING_EVENT, onPending);
});

afterEach(() => {
  window.removeEventListener(TRIP_ACCESS_PENDING_EVENT, onPending);
});

describe('ensureMembership never self-joins (#641)', () => {
  it('denied read ⇒ no write, access-pending once', async () => {
    fake.readDenied = true;
    expect(await ensureMembership(TRIP)).toBeUndefined();
    expect(fake.updates).toHaveLength(0);
    expect(pending).toBe(1);
  });

  it('readable trip already listing this device ⇒ no write', async () => {
    fake.doc = { members: { 'device-uid-fake': 'member', owner1: 'owner' } };
    expect(await ensureMembership(TRIP)).toBeUndefined();
    expect(fake.updates).toHaveLength(0);
    expect(pending).toBe(0);
  });

  it('offline read ⇒ no write, no access-pending', async () => {
    fake.offline = true;
    expect(await ensureMembership(TRIP)).toBeUndefined();
    expect(fake.updates).toHaveLength(0);
    expect(pending).toBe(0);
  });

  it('adoption over two denied trips writes nothing', async () => {
    fake.readDenied = true;
    upsertKnownTrip('trip-one', 'One');
    upsertKnownTrip('trip-two', 'Two');
    await ensureKnownTripMemberships();
    expect(fake.updates).toHaveLength(0);
    expect(pending).toBe(2);
  });
});

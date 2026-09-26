// @vitest-environment jsdom
//
// D-595 (#599): a device holding a trip id joins a gated roster itself when its trip-doc read is
// refused, and says so ('joined') so the page-load caller can reload once. Reloading itself is the
// provider's job (trip-access-pending.test.ts): adoption enrols many trips and must never reload.

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
  getAuth: () => ({ currentUser: { uid: 'device-uid-fake', getIdToken: async () => 'tok' } }),
  onAuthStateChanged: (_auth: unknown, next: (u: unknown) => void) => {
    queueMicrotask(() => next({ uid: 'device-uid-fake' }));
    return () => {};
  },
  signInAnonymously: async () => ({ user: { uid: 'device-uid-fake' } }),
}));

const fake = vi.hoisted(() => ({
  readDenied: false,
  offline: false,
  writeDenied: false,
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
    if (fake.writeDenied) throw permissionDenied();
    fake.updates.push({ path: ref.path, data });
  },
}));

import { ensureMembership, ensureKnownTripMemberships, TRIP_ACCESS_PENDING_EVENT } from '@/lib/trips-remote';
import { upsertKnownTrip } from '@/core/trips/registry';

const TRIP = 'trip-abc';
const realLocation = window.location;
let reload: ReturnType<typeof vi.fn>;
let pending: number;
const onPending = () => (pending += 1);

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  fake.readDenied = false;
  fake.offline = false;
  fake.writeDenied = false;
  fake.doc = undefined;
  fake.updates.length = 0;
  pending = 0;
  reload = vi.fn();
  Object.defineProperty(window, 'location', { value: { reload }, configurable: true, writable: true });
  window.addEventListener(TRIP_ACCESS_PENDING_EVENT, onPending);
});

afterEach(() => {
  Object.defineProperty(window, 'location', { value: realLocation, configurable: true, writable: true });
  window.removeEventListener(TRIP_ACCESS_PENDING_EVENT, onPending);
});

describe('ensureMembership self-join (D-595)', () => {
  it('denied read ⇒ exactly one member self-add, answered joined', async () => {
    fake.readDenied = true;
    expect(await ensureMembership(TRIP)).toBe('joined');
    expect(fake.updates).toEqual([{ path: `trips/${TRIP}`, data: { 'members.device-uid-fake': 'member' } }]);
    expect(reload).not.toHaveBeenCalled();
    expect(pending).toBe(0);
  });

  it('a second denied read in the same session does not join again', async () => {
    fake.readDenied = true;
    await ensureMembership(TRIP);
    expect(await ensureMembership(TRIP)).toBeUndefined();
    expect(fake.updates).toHaveLength(1);
    expect(pending).toBe(1);
  });

  it('readable trip ⇒ no self-join write, no reload', async () => {
    fake.doc = { members: { 'device-uid-fake': 'member', owner1: 'owner' } };
    expect(await ensureMembership(TRIP)).toBeUndefined();
    expect(fake.updates).toHaveLength(0);
    expect(reload).not.toHaveBeenCalled();
  });

  it('self-add refused too ⇒ no reload, access-pending toast as before', async () => {
    fake.readDenied = true;
    fake.writeDenied = true;
    expect(await ensureMembership(TRIP)).toBeUndefined();
    expect(fake.updates).toHaveLength(0);
    expect(reload).not.toHaveBeenCalled();
    expect(pending).toBe(1);
  });

  it('offline read ⇒ no write, no reload, no access-pending', async () => {
    fake.offline = true;
    expect(await ensureMembership(TRIP)).toBeUndefined();
    expect(fake.updates).toHaveLength(0);
    expect(reload).not.toHaveBeenCalled();
    expect(pending).toBe(0);
  });

  it('adoption over two denied trips joins both and never reloads', async () => {
    fake.readDenied = true;
    upsertKnownTrip('trip-one', 'One');
    upsertKnownTrip('trip-two', 'Two');
    await ensureKnownTripMemberships();
    expect(fake.updates.map((u) => u.path).sort()).toEqual(['trips/trip-one', 'trips/trip-two']);
    expect(reload).not.toHaveBeenCalled();
  });
});

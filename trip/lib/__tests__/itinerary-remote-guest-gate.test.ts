// @vitest-environment jsdom
//
// S110-FIX / F19a(3) + F2 (D-055 LOCKED) — regression proof that a session with no active
// traveler NEVER pushes edits into the friends' shared trip, even though sync is
// configured. The old `pushPlans` opened with only `if (!isRemoteConfigured()) return;`, so a
// guest's sample-day edits fanned out into the real trip via the union merge. The fix tightens the
// gate to `if (!isRemoteConfigured() || !getActiveTraveler()) return;`.
//
// Exercised against a FAKE Firestore (firebase SDK vi.mock'd): the whole point is that with a guest
// regime, pushPlans returns BEFORE any firebase import/handle work, so the fake records ZERO writes
// and ZERO firestore-getter calls. A matching sanity case flips to a signed-in traveler and shows a
// push DOES issue a write (the gate isn't just always-off).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';

// Sync CONFIGURED for this suite (so the ONLY thing gating the push is the active-traveler check).
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => true,
  // #10: mirrors isRemoteConfigured — every mocked getTripId here is non-empty, so the two gates agree.
  isTripRemoteConfigured: () => true,
  getTripId: () => 'nepal-japan-2026',
}));

// The active-traveler switch: `traveler` null = guest regime; an object = signed in.
const auth = vi.hoisted(() => ({ traveler: null as null | { name: string; token: string; accent: string } }));
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => auth.traveler };
});

// A fake Firestore whose getters/writes are all counted — so we can assert a guest push touches
// NONE of it. `initializeFirestore` being called at all means the lazy handle started initializing.
const calls = vi.hoisted(() => ({ initializeFirestore: 0, writes: 0 }));
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
vi.mock('firebase/firestore', () => {
  const store = new Map<string, unknown>();
  return {
    initializeFirestore: () => {
      calls.initializeFirestore += 1;
      return { __fake: true };
    },
    persistentLocalCache: () => ({}),
    doc: (_db: unknown, ...segs: string[]) => ({ __type: 'doc', path: segs.join('/') }),
    collection: (_db: unknown, ...segs: string[]) => ({ __type: 'collection', path: segs.join('/') }),
    getDoc: async (ref: { path: string }) => ({ exists: () => store.has(ref.path), data: () => store.get(ref.path) }),
    setDoc: async (ref: { path: string }, data: unknown) => {
      calls.writes += 1;
      store.set(ref.path, data);
    },
    deleteDoc: async (ref: { path: string }) => {
      calls.writes += 1;
      store.delete(ref.path);
    },
    serverTimestamp: () => 'SERVER_TS',
    runTransaction: async (
      _db: unknown,
      update: (tx: {
        get: (ref: { path: string }) => Promise<{ exists: () => boolean; data: () => unknown }>;
        set: (ref: { path: string }, data: unknown) => void;
      }) => Promise<void>,
    ) => {
      await update({
        get: async (ref: { path: string }) => ({ exists: () => store.has(ref.path), data: () => store.get(ref.path) }),
        set: (ref: { path: string }, data: unknown) => {
          calls.writes += 1;
          store.set(ref.path, data);
        },
      });
    },
  };
});

import { pushPlans } from '@/lib/itinerary-remote';

function item(id: string, over: Partial<ItineraryItem> = {}): ItineraryItem {
  return { id, title: `Item ${id}`, category: 'sightseeing', ...over };
}
function day(date: string, items: ItineraryItem[]): DayPlan {
  return { date, city: 'Kathmandu', country: 'nepal', items };
}

beforeEach(() => {
  calls.initializeFirestore = 0;
  calls.writes = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('pushPlans — guest gate (F2, D-055 LOCKED)', () => {
  it('GUEST (no active traveler): a local change triggers NO push — zero firebase touch', async () => {
    auth.traveler = null; // guest
    const prev: DayPlan[] = [day('2026-12-09', [])];
    const next: DayPlan[] = [day('2026-12-09', [item('g1', { sourceId: 'sample-1' })])]; // an edit

    await pushPlans(prev, next);

    // Returned before any firebase handle work: the firestore getter never ran and no doc was written.
    expect(calls.initializeFirestore).toBe(0);
    expect(calls.writes).toBe(0);
  });

  it('SIGNED-IN traveler: the SAME change DOES push (proves the gate is not simply always-off)', async () => {
    auth.traveler = { name: 'Powan', token: 'Powan', accent: '#000' };
    const prev: DayPlan[] = [day('2026-12-09', [])];
    const next: DayPlan[] = [day('2026-12-09', [item('s1', { sourceId: 'sample-1' })])];

    await pushPlans(prev, next);

    // With an identified traveler the push runs: the handle initialized and the changed day was written.
    expect(calls.initializeFirestore).toBeGreaterThan(0);
    expect(calls.writes).toBeGreaterThan(0);
  });
});

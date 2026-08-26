// @vitest-environment jsdom
//
// #345 — the places domain never had read-permission-denial handling (it exists for
// 'itinerary' since #271/#296 but was never extended to expenses/budget/docs/places). This is
// the wired-behavior proof for `subscribeRemotePlaces`'s onSnapshot error handler, mirroring the
// equivalent `#271` suite in `lib/__tests__/itinerary-remote-sync.test.ts` and the sibling
// `#345` blocks added to expenses/budget/docs' own sync suites.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => true,
  isTripRemoteConfigured: () => true,
  getTripId: () => 'nepal-japan-2026',
}));
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }) };
});

type DocData = Record<string, unknown>;

class FakeFirestore {
  docs = new Map<string, DocData>();
  errorListeners: Array<(err: unknown) => void> = [];
  emitError(err: unknown) {
    for (const cb of this.errorListeners) cb(err);
  }
}
const fake = new FakeFirestore();

function pathOf(segments: string[]): string {
  return segments.join('/');
}

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
vi.mock('firebase/firestore', () => ({
  getFirestore: () => fake,
  initializeFirestore: () => fake,
  persistentLocalCache: () => ({}),
  doc: (_db: unknown, ...segs: string[]) => ({ __type: 'doc', path: pathOf(segs) }),
  onSnapshot: (
    _ref: unknown,
    _onNext: (snap: unknown) => void,
    onError?: (e: unknown) => void,
  ) => {
    if (onError) fake.errorListeners.push(onError);
    return () => {
      if (onError) {
        const i = fake.errorListeners.indexOf(onError);
        if (i >= 0) fake.errorListeners.splice(i, 1);
      }
    };
  },
}));

import { subscribeRemotePlaces } from '@/lib/places-remote';
import { isReadDenied, setReadDenied } from '@/core/sync/read-denied';

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  fake.docs.clear();
  fake.errorListeners = [];
});
afterEach(() => {
  vi.restoreAllMocks();
  setReadDenied('places', false); // module-singleton flag — reset between tests
});

describe('#345 — a permission-denied READ stream is classified, not endlessly retried', () => {
  it('sets isReadDenied() and does NOT arm the `online` retry listener', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');

    const unsub = subscribeRemotePlaces();
    await flush(); // listener attaches

    expect(isReadDenied()).toBe(false);
    fake.emitError({ code: 'permission-denied', message: 'Missing or insufficient permissions.' });

    expect(isReadDenied()).toBe(true);
    expect(addSpy.mock.calls.some(([type]) => type === 'online')).toBe(false);
    unsub();
  });

  it('a non-denial stream error (network/quota) still arms the `online` retry, unaffected', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');

    const unsub = subscribeRemotePlaces();
    await flush();

    fake.emitError({ code: 'unavailable', message: 'network blip' });

    expect(isReadDenied()).toBe(false);
    expect(addSpy.mock.calls.some(([type]) => type === 'online')).toBe(true);
    unsub();
  });
});

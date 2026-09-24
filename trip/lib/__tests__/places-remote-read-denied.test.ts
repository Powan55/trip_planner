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

const outbox = vi.hoisted(() => ({ dirty: [] as string[] }));
vi.mock('@/core/sync/outbox', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/core/sync/outbox')>();
  return { ...orig, outboxDirty: () => [...outbox.dirty] };
});

type DocData = Record<string, unknown>;

class FakeFirestore {
  docs = new Map<string, DocData>();
  errorListeners: Array<(err: unknown) => void> = [];
  nextListeners: Array<(snap: unknown) => void> = [];
  emitError(err: unknown) {
    for (const cb of this.errorListeners) cb(err);
  }
  emitServerDoc(data: DocData) {
    const snap = { metadata: { hasPendingWrites: false, fromCache: false }, exists: () => true, data: () => data };
    for (const cb of this.nextListeners) cb(snap);
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
    onNext: (snap: unknown) => void,
    onError?: (e: unknown) => void,
  ) => {
    fake.nextListeners.push(onNext);
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
import { loadMyPlaces, saveMyPlaces } from '@/core/places/storage';
import type { MyPlace } from '@/core/places/model';

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  fake.docs.clear();
  fake.errorListeners = [];
  fake.nextListeners = [];
  outbox.dirty = [];
  localStorage.clear();
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

describe('#539 — first server snapshot: remote wins unless the places chunk is dirty', () => {
  const place = (id: string, pt: number): MyPlace => ({
    id,
    name: id,
    legId: 'main',
    addedAt: new Date(pt).toISOString(),
    hlc: `${String(pt).padStart(15, '0')}:000000:phone`,
    rev: 1,
  });
  const stale = place('deleted-long-ago', Date.UTC(2026, 0, 1));
  const peer = place('peer', Date.UTC(2026, 8, 1));

  it('not dirty: the remote list is applied as-is, so a stale local row does not come back', async () => {
    saveMyPlaces([stale]);
    const unsub = subscribeRemotePlaces();
    await flush();
    fake.emitServerDoc({ version: 1, items: [peer] });
    expect(loadMyPlaces().map((p) => p.id)).toEqual(['peer']);
    unsub();
  });

  it('dirty: an unpushed local row is merged, not dropped', async () => {
    saveMyPlaces([stale]);
    outbox.dirty = ['list'];
    const unsub = subscribeRemotePlaces();
    await flush();
    fake.emitServerDoc({ version: 1, items: [peer] });
    expect(loadMyPlaces().map((p) => p.id).sort()).toEqual(['deleted-long-ago', 'peer']);
    unsub();
  });
});

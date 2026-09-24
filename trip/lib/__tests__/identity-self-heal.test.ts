// @vitest-environment jsdom
//
// #529 / D-565: a device holding a key heals its account's identity doc, create-only, so the door
// admits that key on the next new device. Real trips-remote + reconciler over an in-memory store.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => true,
  isTripRemoteConfigured: () => true,
  getTripId: () => 'test-trip',
}));

type Ref = { path: string };
const store = new Map<string, Record<string, unknown>>();
const hooks: { readFails: boolean; beforeCommit: (() => void) | null; txCount: number } = {
  readFails: false,
  beforeCommit: null,
  txCount: 0,
};
const snap = (path: string) => ({ exists: () => store.has(path), data: () => store.get(path) });

vi.mock('@/lib/firebase-remote', () => ({
  isPermissionDenied: () => false,
  getRemote: async () => ({
    db: {},
    uid: 'uid-a',
    fs: {
      doc: (_db: unknown, ...segs: string[]): Ref => ({ path: segs.join('/') }),
      getDocFromServer: async (ref: Ref) => {
        if (hooks.readFails) throw new Error('offline');
        return snap(ref.path);
      },
      setDoc: async (ref: Ref, data: Record<string, unknown>) => void store.set(ref.path, data),
      // Optimistic concurrency like Firestore's: a doc read in the tx that changed before commit
      // aborts the attempt and the callback re-runs against fresh state.
      runTransaction: async (
        _db: unknown,
        fn: (tx: {
          get: (r: Ref) => Promise<ReturnType<typeof snap>>;
          set: (r: Ref, d: Record<string, unknown>) => void;
        }) => Promise<void>,
      ) => {
        hooks.txCount++;
        for (let attempt = 0; attempt < 5; attempt++) {
          const seen = new Map<string, unknown>();
          const writes: [string, Record<string, unknown>][] = [];
          await fn({
            get: async (r) => {
              seen.set(r.path, store.get(r.path));
              return snap(r.path);
            },
            set: (r, d) => void writes.push([r.path, d]),
          });
          const hook = hooks.beforeCommit;
          hooks.beforeCommit = null;
          hook?.();
          if ([...seen].some(([p, v]) => store.get(p) !== v)) continue;
          for (const [p, d] of writes) store.set(p, d);
          return;
        }
        throw new Error('aborted');
      },
    },
  }),
}));

vi.mock('sonner', () => ({ toast: () => {} }));

import {
  fetchAccountIdentity,
  healAccountIdentity,
  probeAccountIdentity,
} from '@/lib/trips-remote';
import {
  runAccountIdentitySync,
  watchAccountIdentity,
  __resetIdentityCacheForTests,
} from '@/components/itinerary-provider';
import { signIn, DEFAULT_TRAVELER_NAME } from '@/lib/token-auth';
import { setSyncCode } from '@/core/storage/gateway';
import { upsertKnownTrip } from '@/core/trips/registry';

const KEY = '11111111-2222-3333-4444-555555555555';
const PATH = `trips/${KEY}/profile/identity`;
const TRIPLIST_PATH = `trips/${KEY}/profile/tripList`;
// D-565: the heal gate requires positive evidence the key is a real account. Every pre-existing
// test below heals a "legacy key" by design, so it needs that evidence seeded — a bare identity
// doc absence is no longer enough (that is the reject case, covered separately below).
const seedTripListEvidence = () => store.set(TRIPLIST_PATH, { version: 1, trips: [] });

async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  store.clear();
  hooks.readFails = false;
  hooks.beforeCommit = null;
  hooks.txCount = 0;
  window.localStorage.clear();
  window.sessionStorage.clear();
  __resetIdentityCacheForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('fetchAccountIdentity is three-way', () => {
  it('missing / exists+name / error', async () => {
    expect(await fetchAccountIdentity(KEY)).toEqual({ status: 'missing' });
    store.set(PATH, { version: 1, name: ' Sushil ' });
    expect(await fetchAccountIdentity(KEY)).toEqual({ status: 'exists', name: 'Sushil' });
    hooks.readFails = true;
    expect(await fetchAccountIdentity(KEY)).toEqual({ status: 'error' });
  });
});

describe('healAccountIdentity is create-only', () => {
  it('writes exactly { version: 1 } for the placeholder', async () => {
    await healAccountIdentity(KEY, DEFAULT_TRAVELER_NAME);
    expect(store.get(PATH)).toEqual({ version: 1 });
  });

  it('never overwrites an existing doc', async () => {
    store.set(PATH, { version: 1, name: 'Powan' });
    await healAccountIdentity(KEY, 'Sora');
    expect(store.get(PATH)).toEqual({ version: 1, name: 'Powan' });
  });

  it('race: a doc created between read and commit is not overwritten', async () => {
    hooks.beforeCommit = () => store.set(PATH, { version: 1, name: 'Powan' });
    await healAccountIdentity(KEY, 'Sora');
    expect(store.get(PATH)).toEqual({ version: 1, name: 'Powan' });
  });
});

describe('reconciler over the real module', () => {
  it('placeholder + no server doc ⇒ exactly { version: 1 }', async () => {
    seedTripListEvidence();
    setSyncCode(KEY);
    signIn(DEFAULT_TRAVELER_NAME);
    runAccountIdentitySync();
    await flush();
    expect(store.get(PATH)).toEqual({ version: 1 });
  });

  it('server doc with a name ⇒ untouched', async () => {
    const doc = { version: 1, name: 'Powan' };
    store.set(PATH, doc);
    setSyncCode(KEY);
    signIn('Sora');
    runAccountIdentitySync();
    await flush();
    expect(store.get(PATH)).toBe(doc);
  });

  it('read error ⇒ no write', async () => {
    hooks.readFails = true;
    setSyncCode(KEY);
    signIn('Sora');
    runAccountIdentitySync();
    await flush();
    expect(store.size).toBe(0);
  });

  it('boots offline, heals on the online event, stops listening after cleanup', async () => {
    seedTripListEvidence();
    hooks.readFails = true;
    setSyncCode(KEY);
    signIn('Sora');
    const stop = watchAccountIdentity();
    await flush();
    expect(store.get(PATH)).toBeUndefined();

    hooks.readFails = false;
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(store.get(PATH)).toEqual({ version: 1, name: 'Sora' });

    stop();
    store.clear();
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(store.size).toBe(0);
  });

  it('online while a read is in flight: only the newer run writes', async () => {
    seedTripListEvidence();
    setSyncCode(KEY);
    signIn('Sora');
    const stop = watchAccountIdentity();
    window.dispatchEvent(new Event('online')); // before the first run's read lands
    await flush();
    stop();
    expect(store.get(PATH)).toEqual({ version: 1, name: 'Sora' });
    expect(hooks.txCount).toBe(1);
  });

  it('door: key held on device A, no server docs; after A reconciles, the probe says exists', async () => {
    expect((await probeAccountIdentity(KEY)).verdict).toBe('missing');
    // probeAccountIdentity's own legacy fallback writes the tripList doc it finds — mirror that
    // here since this test bypasses the probe's write path entirely.
    seedTripListEvidence();
    setSyncCode(KEY);
    signIn(DEFAULT_TRAVELER_NAME);
    runAccountIdentitySync();
    await flush();
    expect((await probeAccountIdentity(KEY)).verdict).toBe('exists');
  });
});

describe('D-565: heal only fires on positive evidence of a real account', () => {
  it('typo key, no tripList doc, no local trips ⇒ no write', async () => {
    setSyncCode(KEY);
    signIn(DEFAULT_TRAVELER_NAME);
    runAccountIdentitySync();
    await flush();
    expect(store.size).toBe(0);
  });

  it('legacy key with a server tripList doc ⇒ heals', async () => {
    seedTripListEvidence();
    setSyncCode(KEY);
    signIn(DEFAULT_TRAVELER_NAME);
    runAccountIdentitySync();
    await flush();
    expect(store.get(PATH)).toEqual({ version: 1 });
  });

  it('key already known locally as a trip ⇒ heals without a tripList read', async () => {
    upsertKnownTrip(KEY, 'Shared trip');
    setSyncCode(KEY);
    signIn(DEFAULT_TRAVELER_NAME);
    runAccountIdentitySync();
    await flush();
    expect(store.get(PATH)).toEqual({ version: 1 });
    expect(store.has(TRIPLIST_PATH)).toBe(false); // no server evidence needed or fetched
  });
});

// @vitest-environment jsdom
//
// S254 — WIRED-behavior unit suite for the trip-meta Sync-v2 seam (lib/trips-remote.ts), against a
// FAKE Firestore (the firebase SDK modules are vi.mock'd). Proves, on a real run:
//
//   1. pushTripMeta writes the exact doc path `trips/{tripId}/meta/info` with `{ name, config? }`,
//      stripping an `undefined` optional config field (Firestore rejects `undefined`).
//   2. fetchTripMeta round-trips a present, well-formed doc back into a sanitized TripMetaPayload.
//   3. fetchTripMeta on a MALFORMED remote doc (bad config) degrades to a name-only result — never
//      throws, never invents fields.
//   4. fetchTripMeta on a doc with no name at all returns undefined (no state change for the caller).
//   5. fetchTripMeta on an ABSENT doc returns undefined.
//   6. Both directions are dormant-safe: isRemoteConfigured() === false short-circuits with NO
//      Firestore call at all (proven by an empty writeLog / no getDoc invocation).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TripConfigBlock } from '@/core/trips/registry';

const isRemoteConfiguredMock = vi.fn(() => true);
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => isRemoteConfiguredMock(),
  // #10: mirrors isRemoteConfigured — every mocked getTripId here is non-empty, so the two gates agree.
  isTripRemoteConfigured: () => isRemoteConfiguredMock(),
  getTripId: () => 'nepal-japan-2026',
}));

type DocData = Record<string, unknown>;
class FakeFirestore {
  docs = new Map<string, DocData>();
  failWrites = false;
  setDocData(path: string, data: DocData) {
    this.docs.set(path, JSON.parse(JSON.stringify(data)));
  }
}
const fake = new FakeFirestore();
const writeLog: { path: string; data: DocData }[] = [];
let getDocCalls = 0;
let getDocFromServerCalls = 0;
// Per-test override for the SERVER read (probeAccountIdentity, #10): null = read fake.docs like
// getDoc; a fn = the test drives the outcome (reject / hang for the timeout race).
const serverRead: {
  impl: null | ((ref: { path: string }) => Promise<{ exists: () => boolean; data: () => DocData | undefined }>);
} = { impl: null };

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
  doc: (_db: unknown, ...segs: string[]) => ({ __type: 'doc', path: pathOf(segs) }),
  setDoc: async (ref: { path: string }, data: DocData) => {
    if (fake.failWrites) throw new Error('transport down');
    writeLog.push({ path: ref.path, data });
    fake.setDocData(ref.path, data);
  },
  getDoc: async (ref: { path: string }) => {
    getDocCalls++;
    const data = fake.docs.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
  },
  getDocFromServer: async (ref: { path: string }) => {
    getDocFromServerCalls++;
    if (serverRead.impl) return serverRead.impl(ref);
    const data = fake.docs.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
  },
}));

import { pushTripMeta, fetchTripMeta, probeAccountIdentity } from '@/lib/trips-remote';

const TRIP_ID = 'custom-trip-abc';
const DOC_PATH = `trips/${TRIP_ID}/meta/info`;

function config(over: Partial<TripConfigBlock> = {}): TripConfigBlock {
  return { start: '2027-01-01', end: '2027-01-10', destinations: ['Kerala'], vibe: 'relaxed', updatedAt: 1, ...over };
}

beforeEach(() => {
  fake.docs.clear();
  writeLog.length = 0;
  getDocCalls = 0;
  getDocFromServerCalls = 0;
  serverRead.impl = null;
  isRemoteConfiguredMock.mockReturnValue(true);
});

describe('pushTripMeta — writes trips/{tripId}/meta/info', () => {
  it('writes {name, config} to the exact doc path', async () => {
    await pushTripMeta(TRIP_ID, { name: 'Kerala 2027', config: config() });
    expect(writeLog).toHaveLength(1);
    expect(writeLog[0].path).toBe(DOC_PATH);
    expect(writeLog[0].data).toEqual({ name: 'Kerala 2027', config: config() });
  });

  it('strips the undefined config field (name-only push) rather than sending undefined', async () => {
    await pushTripMeta(TRIP_ID, { name: 'Just a name' });
    expect(writeLog).toHaveLength(1);
    expect(writeLog[0].data).toEqual({ name: 'Just a name' });
    expect('config' in writeLog[0].data).toBe(false);
  });

  it('a config with an undefined optional field (currency) serializes without it', async () => {
    await pushTripMeta(TRIP_ID, { name: 'K', config: config({ currency: undefined }) });
    const written = writeLog[0].data.config as Record<string, unknown>;
    expect('currency' in written).toBe(false);
  });

  it('no-ops (no Firestore call) when dormant', async () => {
    isRemoteConfiguredMock.mockReturnValue(false);
    await pushTripMeta(TRIP_ID, { name: 'X' });
    expect(writeLog).toHaveLength(0);
  });

  it('never throws when the transport fails — swallows to console.warn, no outbox', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fake.failWrites = true;
    await expect(pushTripMeta(TRIP_ID, { name: 'X' })).resolves.toBeUndefined();
    expect(writeLog).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    fake.failWrites = false;
    warn.mockRestore();
  });
});

describe('fetchTripMeta — one-shot getDoc round-trip + sanitize', () => {
  it('round-trips a present, well-formed doc', async () => {
    fake.setDocData(DOC_PATH, { name: 'Kerala 2027', config: config() });
    const result = await fetchTripMeta(TRIP_ID);
    expect(result).toEqual({ name: 'Kerala 2027', config: config() });
    expect(getDocCalls).toBe(1);
  });

  it('a malformed config (bad dates) degrades to a name-only result, never throws', async () => {
    fake.setDocData(DOC_PATH, { name: 'Kerala 2027', config: { start: 'not-a-date', end: '2027-01-10' } });
    const result = await fetchTripMeta(TRIP_ID);
    expect(result).toEqual({ name: 'Kerala 2027' });
  });

  it('a doc with no name returns undefined (no state change)', async () => {
    fake.setDocData(DOC_PATH, { config: config() });
    const result = await fetchTripMeta(TRIP_ID);
    expect(result).toBeUndefined();
  });

  it('an absent doc returns undefined', async () => {
    const result = await fetchTripMeta(TRIP_ID);
    expect(result).toBeUndefined();
  });

  it('no-ops (no getDoc call) when dormant', async () => {
    isRemoteConfiguredMock.mockReturnValue(false);
    const result = await fetchTripMeta(TRIP_ID);
    expect(result).toBeUndefined();
    expect(getDocCalls).toBe(0);
  });
});

// ── #10 — probeAccountIdentity: the door's login validation ─────────────────────────────────────
// The tri-state mapping IS the security posture: only a server-confirmed ABSENCE rejects; every
// failure shape (dormant, error, timeout) is 'unavailable', which the door treats as ADMIT.
describe('probeAccountIdentity — one server read of trips/{code}/profile/identity (#10)', () => {
  const CODE = 'aaaa1111-bbbb-4222-8333-cccc4444dddd';
  const IDENTITY_PATH = `trips/${CODE}/profile/identity`;

  it("doc present ⇒ 'exists' (a real account), via the SERVER read", async () => {
    fake.setDocData(IDENTITY_PATH, { version: 1, name: 'Powan' });
    expect(await probeAccountIdentity(CODE)).toBe('exists');
    expect(getDocFromServerCalls).toBe(1);
    expect(getDocCalls).toBe(0); // never the cached read — a cached absence must not reject
  });

  it("server answers and the doc is absent ⇒ 'missing' (an invented key)", async () => {
    expect(await probeAccountIdentity(CODE)).toBe('missing');
    expect(getDocFromServerCalls).toBe(1);
  });

  it("read rejects ⇒ 'unavailable' (offline/error must admit, never lock a real user out)", async () => {
    serverRead.impl = async () => {
      throw new Error('network down');
    };
    expect(await probeAccountIdentity(CODE)).toBe('unavailable');
  });

  it("a permission-denied rejection is 'unavailable' AND logs the loud inoperative warning", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    serverRead.impl = async () => {
      throw Object.assign(new Error('denied'), { code: 'permission-denied' });
    };
    expect(await probeAccountIdentity(CODE)).toBe('unavailable');
    expect(warn).toHaveBeenCalledWith(
      '[door] rules deny the identity probe — token validation is inoperative',
    );
    warn.mockRestore();
  });

  it("a read that never answers loses the 8s race ⇒ 'unavailable'", async () => {
    vi.useFakeTimers();
    try {
      serverRead.impl = () => new Promise(() => {}); // hangs forever
      const probe = probeAccountIdentity(CODE);
      await vi.advanceTimersByTimeAsync(0); // flush getRemote's dynamic imports → the race is armed
      await vi.advanceTimersByTimeAsync(8_001);
      expect(await probe).toBe('unavailable');
    } finally {
      vi.useRealTimers();
    }
  });

  it("dormant or blank code ⇒ 'unavailable' with NO read at all", async () => {
    isRemoteConfiguredMock.mockReturnValue(false);
    expect(await probeAccountIdentity(CODE)).toBe('unavailable');
    isRemoteConfiguredMock.mockReturnValue(true);
    expect(await probeAccountIdentity('')).toBe('unavailable');
    expect(getDocFromServerCalls).toBe(0);
  });
});

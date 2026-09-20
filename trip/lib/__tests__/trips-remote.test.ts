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
  initializeFirestore: () => fake,
  persistentLocalCache: () => ({}),
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
  // `pushTripList` is transactional, so `seedAccountDocs` needs this to write anything at all.
  // One in-memory attempt, no contention — enough to prove which paths get written.
  runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
    await fn({
      get: async (ref: { path: string }) => {
        const data = fake.docs.get(ref.path);
        return { exists: () => data !== undefined, data: () => data };
      },
      set: (ref: { path: string }, data: DocData) => {
        if (fake.failWrites) throw new Error('transport down');
        writeLog.push({ path: ref.path, data });
        fake.setDocData(ref.path, data);
      },
    });
  },
}));

import {
  pushTripMeta,
  fetchTripMeta,
  probeAccountIdentity,
  seedAccountDocs,
} from '@/lib/trips-remote';
import { DEFAULT_TRAVELER_NAME } from '@/lib/token-auth';

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

  it("doc present ⇒ 'exists' + the account's name, via ONE SERVER read", async () => {
    fake.setDocData(IDENTITY_PATH, { version: 1, name: 'Powan' });
    // The name comes back with the verdict: this is the read the door's login uses for BOTH, and
    // one read is the whole point — a second one for the name is what this shape deleted.
    expect(await probeAccountIdentity(CODE)).toEqual({ verdict: 'exists', name: 'Powan' });
    expect(getDocFromServerCalls).toBe(1);
    expect(getDocCalls).toBe(0); // never the cached read — a cached absence must not reject
  });

  it("an account with no usable name ⇒ 'exists' with name undefined (never a fabricated one)", async () => {
    fake.setDocData(IDENTITY_PATH, { version: 1 });
    expect(await probeAccountIdentity(CODE)).toEqual({ verdict: 'exists', name: undefined });
    fake.setDocData(IDENTITY_PATH, { version: 1, name: 42 }); // non-string
    expect((await probeAccountIdentity(CODE)).name).toBeUndefined();
    fake.setDocData(IDENTITY_PATH, { version: 1, name: '   ' }); // blank once trimmed
    expect((await probeAccountIdentity(CODE)).name).toBeUndefined();
  });

  it('the returned name is sanitised — trimmed and capped at 24, same as the rename input', async () => {
    fake.setDocData(IDENTITY_PATH, { version: 1, name: '  Powan  ' });
    expect((await probeAccountIdentity(CODE)).name).toBe('Powan');
    fake.setDocData(IDENTITY_PATH, { version: 1, name: 'P'.repeat(40) });
    expect((await probeAccountIdentity(CODE)).name).toBe('P'.repeat(24));
  });

  it("server answers and BOTH account docs are absent ⇒ 'missing' (an invented key), no name", async () => {
    expect(await probeAccountIdentity(CODE)).toEqual({ verdict: 'missing' });
    // TWO reads now, not one: an absent identity doc alone is no longer sufficient evidence —
    // see the legacy-account block below for why, and for the cost note.
    expect(getDocFromServerCalls).toBe(2);
  });

  it("read rejects ⇒ 'unavailable' (offline/error must admit, never lock a real user out)", async () => {
    serverRead.impl = async () => {
      throw new Error('network down');
    };
    expect(await probeAccountIdentity(CODE)).toEqual({ verdict: 'unavailable' });
  });

  it('a rejected read RESOLVES — it never throws at the caller, and never invents a name', async () => {
    // The door's own `.catch` would absorb this too; totality is pinned at the source so a caller
    // that awaits it bare never needs its own guard to avoid stranding the wall on `busy`.
    serverRead.impl = async () => {
      throw new Error('network down');
    };
    await expect(probeAccountIdentity(CODE)).resolves.toEqual({ verdict: 'unavailable' });
    fake.setDocData(IDENTITY_PATH, { version: 1, name: 'Powan' }); // present, but unreadable
    await expect(probeAccountIdentity(CODE)).resolves.not.toHaveProperty('name', 'Powan');
  });

  it("a permission-denied rejection is 'unavailable' AND logs the loud inoperative warning", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    serverRead.impl = async () => {
      throw Object.assign(new Error('denied'), { code: 'permission-denied' });
    };
    expect(await probeAccountIdentity(CODE)).toEqual({ verdict: 'unavailable' });
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
      expect(await probe).toEqual({ verdict: 'unavailable' });
    } finally {
      vi.useRealTimers();
    }
  });

  it("dormant or blank code ⇒ 'unavailable' with NO read at all", async () => {
    isRemoteConfiguredMock.mockReturnValue(false);
    expect(await probeAccountIdentity(CODE)).toEqual({ verdict: 'unavailable' });
    isRemoteConfiguredMock.mockReturnValue(true);
    expect(await probeAccountIdentity('')).toEqual({ verdict: 'unavailable' });
    expect(getDocFromServerCalls).toBe(0);
  });

  // ── the legacy-account fallback ───────────────────────────────────────────────────────────
  // The two grandfathered mint sites shipped for months writing `profile/tripList` and no
  // identity doc, so the absence test above rejected the very travellers accounts were added
  // for. The fallback admits on the POSITIVE evidence of a tripList doc — and only that.
  describe('an account minted before seedAccountDocs (tripList, no identity)', () => {
    const LIST_PATH = `trips/${CODE}/profile/tripList`;

    it("is ADMITTED as 'exists' — not rejected — on the strength of its tripList doc", async () => {
      fake.setDocData(LIST_PATH, { version: 1, trips: [{ id: 't1', name: 'Nepal' }] });
      expect(await probeAccountIdentity(CODE)).toEqual({ verdict: 'exists' });
      expect(getDocFromServerCalls).toBe(2); // identity (absent) then tripList — the stated cost
      expect(getDocCalls).toBe(0); // still never the cached read, on either document
    });

    it('BACKFILLS the identity doc, so the second read is paid exactly once per account', async () => {
      fake.setDocData(LIST_PATH, { version: 1, trips: [] });
      await probeAccountIdentity(CODE);
      expect(writeLog).toEqual([{ path: IDENTITY_PATH, data: { version: 1 } }]);
      // …and the next login takes the one-read path, with no second read and no second write.
      getDocFromServerCalls = 0;
      writeLog.length = 0;
      expect(await probeAccountIdentity(CODE)).toEqual({ verdict: 'exists', name: undefined });
      expect(getDocFromServerCalls).toBe(1);
      expect(writeLog).toHaveLength(0);
    });

    it('backfills WITHOUT a name — the placeholder is never published as the account name', async () => {
      fake.setDocData(LIST_PATH, { version: 1, trips: [] });
      await probeAccountIdentity(CODE);
      expect(writeLog[0].data).not.toHaveProperty('name');
    });

    it('a FAILED backfill still admits — best-effort, and never turns an admit into a reject', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      fake.setDocData(LIST_PATH, { version: 1, trips: [] });
      fake.failWrites = true;
      expect(await probeAccountIdentity(CODE)).toEqual({ verdict: 'exists' });
      expect(warn).toHaveBeenCalled();
      fake.failWrites = false;
      warn.mockRestore();
    });

    // THE SECURITY ASSERTION. Everything above must not become a general admit: an invented or
    // mistyped key has neither document and is still rejected. If this one goes, #10 bought nothing.
    it('NEITHER document ⇒ still REJECTED — an invented key must not be admitted', async () => {
      expect(await probeAccountIdentity(CODE)).toEqual({ verdict: 'missing' });
      expect(getDocFromServerCalls).toBe(2);
      expect(writeLog).toHaveLength(0); // nothing is created for a key that does not exist
    });

    it('the 8s budget still bounds the WHOLE thing when the fallback read hangs', async () => {
      vi.useFakeTimers();
      try {
        serverRead.impl = (ref) =>
          ref.path.endsWith('/identity')
            ? Promise.resolve({ exists: () => false, data: () => undefined })
            : new Promise(() => {}); // the tripList read never answers
        const probe = probeAccountIdentity(CODE);
        await vi.advanceTimersByTimeAsync(0); // flush getRemote's dynamic imports
        await vi.advanceTimersByTimeAsync(8_001);
        expect(await probe).toEqual({ verdict: 'unavailable' }); // admits, never hangs the door
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

// ── the grandfathered mint's seed ──────────────────────────────────────────────────────────────
// `finishAccount` (trips-hub) and `SyncGroup.reveal` (settings-panel) both route through this.
// Writing only `profile/tripList` here is what minted the locked-out accounts in the first place.
describe('seedAccountDocs — BOTH account docs for a freshly minted key', () => {
  const CODE = 'eeee5555-ffff-4666-8777-aaaa8888bbbb';
  const IDENTITY_PATH = `trips/${CODE}/profile/identity`;
  const LIST_PATH = `trips/${CODE}/profile/tripList`;

  const pathsWritten = () => writeLog.map((w) => w.path).sort();

  it('writes profile/identity AND profile/tripList — the same pair the door mints', async () => {
    await seedAccountDocs(CODE, 'Uttam');
    expect(pathsWritten()).toEqual([IDENTITY_PATH, LIST_PATH].sort());
    expect(writeLog.find((w) => w.path === IDENTITY_PATH)?.data).toEqual({
      version: 1,
      name: 'Uttam',
    });
  });

  it('the seeded account is then ADMITTED by the door on another device', async () => {
    await seedAccountDocs(CODE, 'Uttam');
    expect(await probeAccountIdentity(CODE)).toEqual({ verdict: 'exists', name: 'Uttam' });
  });

  it('NEVER publishes the placeholder as the account name — writes the doc nameless instead', async () => {
    await seedAccountDocs(CODE, DEFAULT_TRAVELER_NAME);
    const identity = writeLog.find((w) => w.path === IDENTITY_PATH);
    expect(identity?.data).toEqual({ version: 1 });
    // The account still EXISTS, which is the whole point: a nameless doc still admits.
    expect(await probeAccountIdentity(CODE)).toEqual({ verdict: 'exists', name: undefined });
  });

  it('a blank / missing name also writes the doc nameless, never an empty name field', async () => {
    for (const name of [undefined, null, '', '   ']) {
      writeLog.length = 0;
      fake.docs.clear();
      await seedAccountDocs(CODE, name);
      expect(writeLog.find((w) => w.path === IDENTITY_PATH)?.data).toEqual({ version: 1 });
    }
  });

  it('sanitises the name the same way the rename input does (trim, cap 24)', async () => {
    await seedAccountDocs(CODE, `  ${'U'.repeat(40)}  `);
    expect(writeLog.find((w) => w.path === IDENTITY_PATH)?.data).toEqual({
      version: 1,
      name: 'U'.repeat(24),
    });
  });

  it('no-ops (no Firestore call) when dormant or the code is blank', async () => {
    isRemoteConfiguredMock.mockReturnValue(false);
    await seedAccountDocs(CODE, 'Uttam');
    isRemoteConfiguredMock.mockReturnValue(true);
    await seedAccountDocs('', 'Uttam');
    expect(writeLog).toHaveLength(0);
  });

  it('never rejects when the transport is down — both writes stay best-effort', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fake.failWrites = true;
    await expect(seedAccountDocs(CODE, 'Uttam')).resolves.toBeUndefined();
    expect(writeLog).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    fake.failWrites = false;
    warn.mockRestore();
  });
});

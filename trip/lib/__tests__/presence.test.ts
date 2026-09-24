// @vitest-environment jsdom
//
// Coverage for lib/presence.ts's LIFECYCLE and its read bound (D-057, D-205). The two
// existing suites both stop short of this module: use-presence.test.ts module-mocks
// `@/lib/presence` wholesale, and trip-membership.test.ts only walks the permission-denied
// teardown. What is exercised here:
//
//   1. A heartbeat already awaiting `getRemote()` when the loop is torn down must NOT write.
//      The teardown nulls the module's `loop` binding, so the post-await guard has to read the
//      loop captured BEFORE the await — otherwise a sign-in as someone else stamps the
//      PREVIOUS traveller's name onto this device's doc (the doc id is the stable device id).
//   2. `stopPresence()`'s delete has to target the trip/device captured at start: sign-out
//      clears the active-trip key first, so the live trip id is '' by the time it runs.
//   3. `subscribePresence` opens a BOUNDED query, not the whole collection — `onSnapshot`
//      bills per delivered doc and Spark cannot be billed.
//
// `getRemote` is the awaited seam, so it is mocked with a RELEASABLE gate: that is what makes
// "in flight across a teardown" reproducible rather than timing-dependent.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const gate = vi.hoisted(() => ({ on: true, tripId: 'trip-abc' }));
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => gate.on,
  isTripRemoteConfigured: () => gate.on && gate.tripId !== '',
  getTripId: () => gate.tripId,
}));

interface DocRef {
  path: string;
}
interface Constraint {
  kind: string;
  [k: string]: unknown;
}
interface FakeQuery {
  type: 'query';
  path: string;
  constraints: Constraint[];
}

const fake = vi.hoisted(() => ({
  writes: [] as { op: 'set' | 'delete'; path: string; data: Record<string, unknown> }[],
  subs: [] as {
    target: { type: string; path: string; constraints?: unknown[] };
    onNext: (snap: unknown) => void;
    onError: (err: unknown) => void;
  }[],
  unsubs: 0,
  /** Resolves when released — every `getRemote()` awaits it. */
  ready: Promise.resolve() as Promise<void>,
  release: (() => {}) as () => void,
  arm() {
    fake.ready = new Promise<void>((res) => {
      fake.release = res;
    });
  },
  fs: {
    doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
    setDoc: async (ref: DocRef, data: Record<string, unknown>) => {
      fake.writes.push({ op: 'set', path: ref.path, data });
    },
    deleteDoc: async (ref: DocRef) => {
      fake.writes.push({ op: 'delete', path: ref.path, data: {} });
    },
    serverTimestamp: () => '<server-timestamp>',
    collection: (_db: unknown, ...segs: string[]) => ({ type: 'collection', path: segs.join('/') }),
    query: (col: { path: string }, ...constraints: Constraint[]) => ({
      type: 'query',
      path: col.path,
      constraints,
    }),
    where: (field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value }),
    orderBy: (field: string, dir: string) => ({ kind: 'orderBy', field, dir }),
    limit: (n: number) => ({ kind: 'limit', n }),
    onSnapshot: (
      target: { type: string; path: string; constraints?: unknown[] },
      onNext: (snap: unknown) => void,
      onError: (err: unknown) => void,
    ) => {
      fake.subs.push({ target, onNext, onError });
      return () => {
        fake.unsubs += 1;
      };
    },
  },
}));

vi.mock('@/lib/firebase-remote', async () => {
  const { isPermissionDenied } = await import('@/core/sync/denied');
  return {
    getRemote: async () => {
      await fake.ready;
      return { db: { type: 'db' }, fs: fake.fs };
    },
    isPermissionDenied,
  };
});

import {
  startPresence,
  stopPresence,
  subscribePresence,
  ACTIVE_WINDOW_MS,
  PRESENCE_LIMIT,
  type PresenceRecord,
} from '@/lib/presence';
import { signIn } from '@/lib/token-auth';
import { deviceStore } from '@/core/storage/gateway';

const TRIP = 'trip-abc';

/** Drain the microtask queue plus a macrotask, so every chained await inside the module settles. */
function flush(): Promise<void> {
  return new Promise((res) => setTimeout(res, 0));
}

function setsOf(): { op: string; path: string; data: Record<string, unknown> }[] {
  return fake.writes.filter((w) => w.op === 'set');
}
function deletesOf(): { op: string; path: string; data: Record<string, unknown> }[] {
  return fake.writes.filter((w) => w.op === 'delete');
}

beforeEach(() => {
  fake.writes.length = 0;
  fake.subs.length = 0;
  fake.unsubs = 0;
  fake.ready = Promise.resolve();
  gate.on = true;
  gate.tripId = TRIP;
  window.localStorage.clear();
});

afterEach(() => {
  stopPresence();
  vi.restoreAllMocks();
});

describe('heartbeat teardown beats an in-flight write', () => {
  it('a beat awaiting getRemote() when stopPresence() runs never writes', async () => {
    signIn('Alina');
    fake.arm();
    startPresence(); // the immediate first beat parks on the gate

    stopPresence(); // teardownLoop() nulls the module binding while that beat is in flight
    fake.release();
    await flush();

    expect(setsOf()).toHaveLength(0);
  });

  it('switching identity mid-beat writes the NEW traveller only, never the old name', async () => {
    const deviceId = deviceStore.getId();
    signIn('Alina');
    fake.arm();
    startPresence(); // Alina's first beat parks on the gate

    signIn('Rhea');
    startPresence(); // tears Alina's loop down, starts Rhea's; her beat parks too

    fake.release();
    await flush();

    // The doc id is the stable device id, so a stale beat would overwrite it with 'Alina'.
    expect(setsOf().map((w) => w.data.name)).toEqual(['Rhea']);
    expect(setsOf()[0].path).toBe(`trips/${TRIP}/presence/${deviceId}`);
  });

  it('an undisturbed beat still writes (the guard is specific to a teardown)', async () => {
    const deviceId = deviceStore.getId();
    signIn('Alina');
    startPresence();
    await flush();

    expect(setsOf()).toHaveLength(1);
    expect(setsOf()[0].path).toBe(`trips/${TRIP}/presence/${deviceId}`);
    expect(setsOf()[0].data).toEqual({ name: 'Alina', lastSeen: '<server-timestamp>' });
  });
});

describe('stopPresence deletes the doc it actually wrote', () => {
  it('still deletes after the active-trip key is cleared (sign-out order)', async () => {
    const deviceId = deviceStore.getId();
    signIn('Alina');
    startPresence();
    await flush();
    expect(setsOf()).toHaveLength(1);

    // What wipeAllTripData() does before the identity event fires: the live trip id is now ''.
    gate.tripId = '';
    stopPresence();
    await flush();

    expect(deletesOf().map((w) => w.path)).toEqual([`trips/${TRIP}/presence/${deviceId}`]);
  });

  it('never composes an empty trip segment', async () => {
    signIn('Alina');
    startPresence();
    await flush();
    gate.tripId = '';
    stopPresence();
    await flush();

    for (const w of fake.writes) expect(w.path).not.toContain('//');
  });

  it('is a no-op with no loop (idempotent, and after a denied teardown)', async () => {
    stopPresence();
    await flush();
    expect(fake.writes).toHaveLength(0);
  });
});

describe('subscribePresence is bounded (free-tier read budget)', () => {
  it('opens a limited, recency-filtered query rather than the raw collection', async () => {
    const before = Date.now();
    subscribePresence(() => {});
    await flush();

    expect(fake.subs).toHaveLength(1);
    const target = fake.subs[0].target as unknown as FakeQuery;
    expect(target.type).toBe('query');
    expect(target.path).toBe(`trips/${TRIP}/presence`);

    const [recency, order, cap] = target.constraints;
    expect(recency.kind).toBe('where');
    expect(recency.field).toBe('lastSeen');
    expect(recency.op).toBe('>');
    const cutoff = (recency.value as Date).getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - ACTIVE_WINDOW_MS);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - ACTIVE_WINDOW_MS + 50);

    // Descending, because an id-ordered limit would keep an arbitrary slice of devices.
    expect(order).toEqual({ kind: 'orderBy', field: 'lastSeen', dir: 'desc' });
    expect(cap).toEqual({ kind: 'limit', n: PRESENCE_LIMIT });
    expect(PRESENCE_LIMIT).toBeLessThanOrEqual(8);
  });

  it('still maps snapshot docs to PresenceRecord[] and unsubscribes', async () => {
    const seen: PresenceRecord[][] = [];
    const unsubscribe = subscribePresence((records) => seen.push(records));
    await flush();

    fake.subs[0].onNext({
      docs: [
        { id: 'dev-1', data: () => ({ name: 'Rhea', lastSeen: { toMillis: () => 1_700_000 } }) },
        { id: 'dev-2', data: () => ({ name: 'Milo' }) },
      ],
    });

    expect(seen).toEqual([
      [
        { uid: 'dev-1', name: 'Rhea', lastSeen: 1_700_000 },
        { uid: 'dev-2', name: 'Milo', lastSeen: null },
      ],
    ]);

    unsubscribe();
    expect(fake.unsubs).toBe(1);
  });

  it('no-ops when the active trip does not sync', async () => {
    gate.tripId = '';
    const unsubscribe = subscribePresence(() => {});
    await flush();
    expect(fake.subs).toHaveLength(0);
    unsubscribe();
  });
});

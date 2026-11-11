// @vitest-environment jsdom
// #1125: a trip rename or trip-list push that fails stays queued and is retried, a refused one is
// not retried this page load, an older queued rename never overwrites a newer remote one, and
// sign-out drops the queue.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const gate = vi.hoisted(() => ({ online: true, deny: false, calls: 0 }));
vi.mock('framer-motion', async () => {
  const React = await import('react');
  return { m: { div: ({ initial, animate, transition, ...rest }: any) => React.createElement('div', rest) } };
});
vi.mock('@/hooks/use-presence', () => ({ usePresence: () => [] }));
vi.mock('@/lib/firebase-config', async (orig) => ({
  ...(await orig<typeof import('@/lib/firebase-config')>()),
  isRemoteConfigured: () => true,
  isTripRemoteConfigured: () => true,
}));
vi.mock('@/lib/token-auth', async (orig) => ({
  ...(await orig<typeof import('@/lib/token-auth')>()),
  getActiveTraveler: () => ({ name: 'Powan' }),
}));

const docs = new Map<string, Record<string, unknown>>();
// `hold`: the next accepted write waits on it, so a test can make an earlier push land later.
let hold: Promise<void> | null = null;
async function attempt(): Promise<void> {
  gate.calls += 1;
  if (gate.deny) throw Object.assign(new Error('denied'), { code: 'permission-denied' });
  if (!gate.online) throw new Error('unavailable');
  const h = hold;
  hold = null;
  if (h) await h;
}
const fs = {
  doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
  setDoc: async (ref: { path: string }, data: Record<string, unknown>) => {
    await attempt();
    docs.set(ref.path, data);
  },
  runTransaction: async <T,>(_db: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => {
    await attempt();
    return fn({
      get: async (ref: { path: string }) => ({ exists: () => docs.has(ref.path), data: () => docs.get(ref.path) }),
      set: (ref: { path: string }, data: Record<string, unknown>) => docs.set(ref.path, data),
    });
  },
};
vi.mock('@/lib/firebase-remote', () => ({
  getRemote: () => Promise.resolve({ db: {}, fs, uid: 'uid' }),
  isPermissionDenied: (e: unknown) => (e as { code?: string } | null)?.code === 'permission-denied',
}));

import { pushTripMeta, pushTripList, flushPendingTripSync } from '@/lib/trips-remote';
import { getKnownTrip, upsertKnownTrip, renameKnownTrip, readTripSyncQueue } from '@/core/trips/registry';
import { setSyncCode, wipeAllTripData } from '@/core/storage/gateway';
import { useSyncStatus, type SyncStatus } from '@/hooks/use-sync-status';
import SyncStatusBadge from '@/components/sync-status-badge';

const TRIP = 'trip-1125-abc';
const META = `trips/${TRIP}/meta/info`;

function rename(name: string) {
  renameKnownTrip(TRIP, name);
  const k = getKnownTrip(TRIP)!;
  return pushTripMeta(TRIP, { name, config: k.config, updatedAt: k.updatedAt });
}

const roots: Root[] = [];
function mount(el: ReturnType<typeof createElement>): void {
  const root = createRoot(document.createElement('div'));
  roots.push(root);
  act(() => root.render(el));
}

function renderStatus(): { current: SyncStatus } {
  const ref = {} as { current: SyncStatus };
  function Probe() {
    ref.current = useSyncStatus();
    return null;
  }
  mount(createElement(Probe));
  return ref;
}

function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('trip meta and trip list retry (#1125)', () => {
  afterEach(() => {
    for (const root of roots.splice(0)) act(() => root.unmount());
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    localStorage.clear();
    docs.clear();
    hold = null;
    Object.assign(gate, { online: true, deny: false, calls: 0 });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    upsertKnownTrip(TRIP, 'Old name');
    setSyncCode('tok-1125');
  });

  it('a rename whose push fails is retried by the next flush and then dequeued', async () => {
    gate.online = false;
    await rename('Pokhara loop');
    expect(docs.has(META)).toBe(false);
    expect(readTripSyncQueue().meta).toEqual([TRIP]);

    gate.online = true;
    await flushPendingTripSync();
    expect(docs.get(META)?.name).toBe('Pokhara loop');
    expect(readTripSyncQueue().meta).toEqual([]);
  });

  it('a successful push leaves nothing queued, and an empty flush makes no call', async () => {
    await rename('Pokhara loop');
    await pushTripList('tok-1125');
    expect(readTripSyncQueue()).toEqual({ meta: [] });
    gate.calls = 0;
    await flushPendingTripSync();
    expect(gate.calls).toBe(0);
  });

  it('an older queued rename does not overwrite a newer remote one', async () => {
    gate.online = false;
    await rename('Mine, older');
    const mine = getKnownTrip(TRIP)!.updatedAt!;
    docs.set(META, { name: 'Theirs, newer', updatedAt: mine + 1000 });

    gate.online = true;
    await flushPendingTripSync();
    expect(docs.get(META)?.name).toBe('Theirs, newer');
    expect(readTripSyncQueue().meta).toEqual([]);
  });

  it('a retry makes no write when the remote already holds our stamp', async () => {
    gate.online = false;
    await rename('Same version');
    const mine = getKnownTrip(TRIP)!.updatedAt!;
    docs.set(META, { name: 'Same version', updatedAt: mine, fieldFromANewerBuild: true });

    gate.online = true;
    await flushPendingTripSync();
    expect(docs.get(META)).toEqual({ name: 'Same version', updatedAt: mine, fieldFromANewerBuild: true });
    expect(readTripSyncQueue().meta).toEqual([]);
  });

  it('an earlier rename landing after a later failed one leaves the trip queued, and the newest name wins', async () => {
    const first = deferred();
    hold = first.promise;
    const p1 = rename('First');
    await tick(); // the first push is through its checks and waiting
    gate.online = false;
    await rename('Second'); // fails
    gate.online = true;
    first.release();
    await p1;
    expect(docs.get(META)?.name).toBe('First');
    expect(readTripSyncQueue().meta).toEqual([TRIP]);

    await flushPendingTripSync();
    expect(docs.get(META)?.name).toBe('Second');
    expect(readTripSyncQueue().meta).toEqual([]);
  });

  it('an earlier trip-list push landing after a later failed one leaves the list queued', async () => {
    const first = deferred();
    hold = first.promise;
    const p1 = pushTripList('tok-1125');
    await tick();
    gate.online = false;
    await pushTripList('tok-1125');
    gate.online = true;
    first.release();
    await p1;
    expect(readTripSyncQueue().list).toBe('tok-1125');
  });

  it('the trip list is retried when the badge sees the device come back online', async () => {
    gate.online = false;
    await pushTripList('tok-1125');
    expect(readTripSyncQueue().list).toBe('tok-1125');
    const h = renderStatus();
    expect(h.current.pending).toBe(1);

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    mount(createElement(SyncStatusBadge));
    // The mount flush retries once and fails offline (its dynamic imports are cold, hence the timeout).
    await vi.waitFor(() => expect(gate.calls).toBe(2), { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 20));
    expect(readTripSyncQueue().list).toBe('tok-1125');
    gate.online = true;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await vi.waitFor(() => expect(docs.has('trips/tok-1125/profile/tripList')).toBe(true));
    await vi.waitFor(() => expect(h.current.pending).toBe(0));
  });

  it('a refused push stays queued, counts as blocked, and is not retried this page load', async () => {
    gate.deny = true;
    await rename('Refused');
    await pushTripList('tok-1125');
    const h = renderStatus();
    expect(h.current.pending).toBe(2);
    expect(h.current.blocked).toBe(2);

    gate.calls = 0;
    await flushPendingTripSync();
    await flushPendingTripSync();
    expect(gate.calls).toBe(0);
    expect(readTripSyncQueue()).toEqual({ meta: [TRIP], list: 'tok-1125' });
  });

  it('sign-out drops the queue', async () => {
    gate.online = false;
    await rename('Lost on sign-out');
    await pushTripList('tok-1125');
    expect(readTripSyncQueue().meta).toHaveLength(1);
    wipeAllTripData();
    expect(readTripSyncQueue()).toEqual({ meta: [] });
  });
});

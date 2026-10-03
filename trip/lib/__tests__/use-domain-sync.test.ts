// @vitest-environment jsdom
//
// #583: a subscribe whose import failed is reopened on `online` / tab-visible; a healthy one never is.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { StoragePort, SyncPort } from '@/core/ports';
import type { ChunkSync } from '@/core/sync/outbox';

const auth = vi.hoisted(() => ({ signedIn: true }));
vi.mock('@/core/sync/outbox', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/core/sync/outbox')>();
  return { ...orig, flushOutbox: vi.fn(orig.flushOutbox) };
});
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => true,
  isTripRemoteConfigured: () => true,
  getTripId: () => 'nepal-japan-2026',
}));
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return {
    ...orig,
    getActiveTraveler: () => (auth.signedIn ? { name: 'Powan', token: 'Powan', accent: '#000' } : null),
  };
});

import { flushOutbox, outboxDirty, withOutbox } from '@/core/sync/outbox';
import { flushAllDomains, RETRY_BASE_MS, useDomainSync } from '@/hooks/use-domain-sync';
import { IDENTITY_CHANGED_EVENT } from '@/lib/token-auth';

function fakePort(dies: boolean) {
  const deaths: Array<() => void> = [];
  const port: SyncPort<unknown> = {
    push: async () => {},
    isConfigured: () => true,
    subscribe: vi.fn((onDead?: () => void) => {
      if (onDead) deaths.push(onDead);
      if (dies && onDead) queueMicrotask(onDead);
      return () => {};
    }),
  };
  return { port, deaths };
}

let root: Root | null = null;

function mount(
  port: SyncPort<unknown>,
  cs = {} as ChunkSync<unknown>,
  storage = {} as StoragePort<unknown>,
) {
  function Probe() {
    useDomainSync(cs, storage, port);
    return null;
  }
  root = createRoot(document.createElement('div'));
  act(() => root!.render(createElement(Probe)));
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('useDomainSync dead-subscribe recovery', () => {
  beforeEach(() => {
    auth.signedIn = true;
    vi.mocked(flushOutbox).mockClear();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
  });

  it('reopens after onDead on the next online event', async () => {
    const { port } = fakePort(true);
    mount(port);
    await tick();
    window.dispatchEvent(new Event('online'));
    expect(port.subscribe).toHaveBeenCalledTimes(2);
  });

  it('reopens after onDead on a visible visibilitychange', async () => {
    const { port } = fakePort(true);
    mount(port);
    await tick();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(port.subscribe).toHaveBeenCalledTimes(2);
  });

  it('never resubscribes a healthy port on online or tab return', async () => {
    const { port } = fakePort(false);
    mount(port);
    await tick();
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(port.subscribe).toHaveBeenCalledTimes(1);
  });

  it('does nothing on online when no traveler is signed in', async () => {
    auth.signedIn = false;
    const { port } = fakePort(false);
    mount(port);
    await tick();
    window.dispatchEvent(new Event('online'));
    expect(port.subscribe).toHaveBeenCalledTimes(0);
    expect(flushOutbox).toHaveBeenCalledTimes(0);
  });

  it('a late failure from a torn-down subscribe does not clear the newer one', async () => {
    const { port, deaths } = fakePort(false);
    mount(port);
    window.dispatchEvent(new Event(IDENTITY_CHANGED_EVENT));
    expect(port.subscribe).toHaveBeenCalledTimes(2);
    deaths[0]();
    window.dispatchEvent(new Event('online'));
    expect(port.subscribe).toHaveBeenCalledTimes(2);
  });
});

describe('#748 timed retry of a failed push', () => {
  type State = Record<string, number>;
  let attempts: string[];
  let outcome: (n: number) => 'ok' | 'fail' | 'deny' | Promise<'ok' | 'fail'>;

  const cs: ChunkSync<State> = {
    domain: 'itinerary',
    chunkDiff: (prev, next) => Object.keys(next).filter((k) => prev[k] !== next[k]),
    async pushChunk(chunk) {
      attempts.push(chunk);
      const o = await outcome(attempts.length);
      if (o === 'fail') throw new Error('offline');
      if (o === 'deny') throw Object.assign(new Error('refused'), { code: 'permission-denied' });
    },
  };
  const storage: StoragePort<State> = { load: () => ({ d1: 1 }), save: () => {}, has: () => true };

  beforeEach(async () => {
    auth.signedIn = true;
    attempts = [];
    localStorage.clear();
    vi.useFakeTimers();
    mount(fakePort(false).port, cs as ChunkSync<unknown>, storage as StoragePort<unknown>);
    await vi.advanceTimersByTimeAsync(0);
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    vi.useRealTimers();
  });

  it('retries on a timer with no online or visibility event, and acks', async () => {
    outcome = (n) => (n === 1 ? 'fail' : 'ok');
    await withOutbox(cs)({}, { d1: 1 });
    expect(outboxDirty('itinerary')).toEqual(['d1']);

    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS);
    expect(attempts).toEqual(['d1', 'd1']);
    expect(outboxDirty('itinerary')).toEqual([]);
  });

  it('a slow push that lands inside the write timeout is not written again', async () => {
    outcome = () => new Promise((r) => setTimeout(() => r('ok'), 6_000));
    const pushed = withOutbox(cs)({}, { d1: 1 });
    await vi.advanceTimersByTimeAsync(10_000);
    await pushed;
    expect(attempts).toEqual(['d1']);
    expect(outboxDirty('itinerary')).toEqual([]);
  });

  it('a flush still in flight at unmount does not re-arm the timer', async () => {
    let release!: (o: 'fail') => void;
    outcome = (n) => (n === 1 ? 'fail' : new Promise((r) => (release = r)));
    await withOutbox(cs)({}, { d1: 1 });
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS); // timed flush starts attempt 2 and hangs
    expect(attempts).toHaveLength(2);
    act(() => root?.unmount());
    root = null;
    release('fail');
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(attempts).toHaveLength(2);
  });

  it('gives up after the attempt cap', async () => {
    outcome = () => 'fail';
    await withOutbox(cs)({}, { d1: 1 });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(attempts).toHaveLength(1 + 6);
    expect(outboxDirty('itinerary')).toEqual(['d1']);
  });

  it('never retries a chunk the rules refused', async () => {
    outcome = () => 'deny';
    // Own chunk id: the refusal record is module-scope and would leak into the other tests.
    await withOutbox(cs)({}, { d9: 1 });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(attempts).toHaveLength(1);
  });

  it('flushAllDomains pushes queued chunks of mounted domains', async () => {
    outcome = (n) => (n === 1 ? 'fail' : 'ok');
    await withOutbox(cs)({}, { d1: 1 });
    await flushAllDomains();
    expect(attempts).toEqual(['d1', 'd1']);
    expect(outboxDirty('itinerary')).toEqual([]);
  });
});

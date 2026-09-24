// @vitest-environment jsdom
//
// #600 — "Sync this device" off switch. The pause lives in getRemote(); the outbox must keep
// queuing while it is on, must not read the rejection as a rules refusal, and must push the queue
// once sync is back. Firebase modules are stubbed so the unpaused getRemote() resolves offline.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const strip = (p: any) => {
    const { initial, animate, exit, transition, ...rest } = p;
    return rest;
  };
  return { m: { div: (props: any) => React.createElement('div', strip(props)) } };
});
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => true,
  isTripRemoteConfigured: () => true,
  getTripId: () => 'nepal-japan-2026',
}));
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan' }) };
});
vi.mock('@/hooks/use-presence', () => ({ usePresence: () => [] }));
vi.mock('firebase/app', () => ({
  initializeApp: () => ({}),
  getApps: () => [],
  getApp: () => ({}),
}));
vi.mock('firebase/firestore', () => ({
  initializeFirestore: () => ({}),
  persistentLocalCache: () => ({}),
}));
vi.mock('firebase/auth', () => ({
  getAuth: () => ({}),
  onAuthStateChanged: (_a: unknown, cb: (u: { uid: string }) => void) => {
    queueMicrotask(() => cb({ uid: 'device-uid' }));
    return () => {};
  },
  signInAnonymously: async () => ({ user: { uid: 'device-uid' } }),
}));

import { getRemote, SyncPausedError } from '@/lib/firebase-remote';
import { withOutbox, flushOutbox, outboxDirty, outboxBlocked, type ChunkSync } from '@/core/sync/outbox';
import { STORAGE_KEYS, syncPausedPrefs } from '@/core/storage/gateway';
import SyncStatusBadge from '@/components/sync-status-badge';
import { SyncThisDevice } from '@/components/settings-panel';

type State = Record<string, number>;
const pushed: string[] = [];
const cs: ChunkSync<State> = {
  domain: 'itinerary',
  chunkDiff: (prev, next) =>
    [...new Set([...Object.keys(prev), ...Object.keys(next)])].filter((k) => prev[k] !== next[k]),
  async pushChunk(chunk) {
    await getRemote();
    pushed.push(chunk);
  },
};

let root: Root | null = null;
async function mount(el: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(el);
  });
  return container;
}

const reload = vi.fn();
beforeEach(() => {
  localStorage.clear();
  pushed.length = 0;
  reload.mockClear();
  Object.defineProperty(window, 'location', { value: { ...window.location, reload }, writable: true });
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('#600 sync paused', () => {
  it('getRemote rejects with a non-permission error while paused', async () => {
    syncPausedPrefs.set(true);
    const err = await getRemote().catch((e) => e);
    expect(err).toBeInstanceOf(SyncPausedError);
    expect(err.code).not.toBe('permission-denied');
  });

  it('queues an edit while paused, does not mark it refused, and flushes it after unpause', async () => {
    syncPausedPrefs.set(true);
    await withOutbox(cs)({}, { '2026-12-01': 1 });
    expect(pushed).toEqual([]);
    expect(outboxDirty('itinerary')).toEqual(['2026-12-01']);
    expect(outboxBlocked()).toBe(0);

    syncPausedPrefs.set(false);
    await flushOutbox(cs, { load: () => ({ '2026-12-01': 1 }), save: () => {}, has: () => true });
    expect(pushed).toEqual(['2026-12-01']);
    expect(outboxDirty('itinerary')).toEqual([]);
  });

  it('badge reads "Sync off" while paused, even with queued edits', async () => {
    localStorage.setItem(STORAGE_KEYS.defaultTripShare, 'a-shared-trip-id');
    syncPausedPrefs.set(true);
    await withOutbox(cs)({}, { '2026-12-02': 1 });
    const c = await mount(<SyncStatusBadge />);
    const badge = c.querySelector('[data-testid="sync-status-badge"]')!;
    expect(badge.getAttribute('data-state')).toBe('paused');
    expect(c.querySelector('[data-testid="sync-status-text"]')!.textContent).toBe('Sync off');
  });

  it('another tab flipping the switch reloads this one', async () => {
    await mount(<SyncStatusBadge />);
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEYS.syncPaused }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('switch has role and name, and toggles key 47 then reloads', async () => {
    const c = await mount(<SyncThisDevice />);
    const sw = c.querySelector<HTMLButtonElement>('[role="switch"]')!;
    const name = document.getElementById(sw.getAttribute('aria-labelledby')!)!.textContent;
    expect(name).toBe('Sync this device');
    expect(sw.getAttribute('aria-checked')).toBe('true');

    await act(async () => sw.click());
    expect(localStorage.getItem(STORAGE_KEYS.syncPaused)).toBe('true');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(reload).toHaveBeenCalledTimes(1);

    await act(async () => sw.click());
    expect(syncPausedPrefs.get()).toBe(false);
  });
});

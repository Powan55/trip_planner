// @vitest-environment jsdom
//
// #571 — sign-out drops the Firestore cache, and Forget this device drops the anonymous session,
// without ever blocking the sign-out behind it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const gate = vi.hoisted(() => ({ on: true }));
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => gate.on,
}));

const ctl = vi.hoisted(() => ({
  calls: [] as string[],
  terminateHangs: false,
  flushHangs: false,
}));

vi.mock('firebase/app', () => ({
  initializeApp: () => ({}),
  getApps: () => [],
  getApp: () => ({}),
}));
vi.mock('firebase/firestore', () => ({
  initializeFirestore: () => {
    ctl.calls.push('init');
    return {};
  },
  persistentLocalCache: () => ({}),
  waitForPendingWrites: () => {
    ctl.calls.push('flush');
    return ctl.flushHangs ? new Promise(() => {}) : Promise.resolve();
  },
  terminate: () => {
    ctl.calls.push('terminate');
    return ctl.terminateHangs ? new Promise(() => {}) : Promise.resolve();
  },
  clearIndexedDbPersistence: async () => {
    ctl.calls.push('clear');
  },
}));
vi.mock('firebase/auth', () => ({
  getAuth: () => ({
    signOut: async () => {
      ctl.calls.push('authSignOut');
    },
  }),
  onAuthStateChanged: (_a: unknown, next: (u: unknown) => void) => {
    queueMicrotask(() => next({ uid: 'u1' }));
    return () => {};
  },
  signInAnonymously: async () => ({ user: { uid: 'u1' } }),
}));

async function fresh() {
  vi.resetModules();
  return import('@/lib/firebase-remote');
}

beforeEach(() => {
  gate.on = true;
  ctl.calls = [];
  ctl.terminateHangs = false;
  ctl.flushHangs = false;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('clearRemoteCache', () => {
  it('terminates then clears a started instance, and the next getRemote re-initialises', async () => {
    const m = await fresh();
    await m.getRemote();
    await m.clearRemoteCache();
    expect(ctl.calls).toEqual(['init', 'flush', 'terminate', 'clear']);
    await m.getRemote();
    expect(ctl.calls.filter((c) => c === 'init')).toHaveLength(2);
  });

  it('signs the anonymous session out only when asked (Forget this device)', async () => {
    const m = await fresh();
    await m.getRemote();
    await m.clearRemoteCache({ signOutAuth: true });
    expect(ctl.calls).toEqual(['init', 'flush', 'authSignOut', 'terminate', 'clear']);
  });

  it('waits for queued writes, but only briefly, before clearing', async () => {
    const m = await fresh();
    await m.getRemote();
    ctl.flushHangs = true;
    vi.useFakeTimers();
    const done = m.clearRemoteCache();
    await vi.advanceTimersByTimeAsync(1400);
    expect(ctl.calls).toEqual(['init', 'flush']);
    await vi.advanceTimersByTimeAsync(100);
    await done;
    expect(ctl.calls).toEqual(['init', 'flush', 'terminate', 'clear']);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('gives up after the timeout instead of blocking sign-out', async () => {
    const m = await fresh();
    await m.getRemote();
    ctl.terminateHangs = true;
    vi.useFakeTimers();
    const done = m.clearRemoteCache();
    await vi.advanceTimersByTimeAsync(3000);
    await expect(done).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(ctl.calls).not.toContain('clear');
  });

  it('never started: deletes the leftover databases by name without starting the SDK', async () => {
    const deleted: string[] = [];
    vi.stubGlobal('indexedDB', {
      deleteDatabase: (name: string) => {
        deleted.push(name);
        const req = {} as { onsuccess?: () => void };
        queueMicrotask(() => req.onsuccess?.());
        return req;
      },
    });
    const m = await fresh();
    await m.clearRemoteCache();
    expect(deleted).toEqual(['firestore/[DEFAULT]/p/main']);
    await m.clearRemoteCache({ signOutAuth: true });
    expect(deleted.slice(1)).toEqual(['firestore/[DEFAULT]/p/main', 'firebaseLocalStorageDb']);
    expect(ctl.calls).toEqual([]);
  });

  it('a failing delete is swallowed with a warning', async () => {
    const m = await fresh(); // jsdom has no indexedDB, so the delete throws
    await expect(m.clearRemoteCache()).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('does nothing when remote is not configured', async () => {
    gate.on = false;
    const m = await fresh();
    await m.clearRemoteCache({ signOutAuth: true });
    expect(ctl.calls).toEqual([]);
    expect(console.warn).not.toHaveBeenCalled();
  });
});

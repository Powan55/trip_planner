// @vitest-environment jsdom
//
// #10 — the Firebase Auth half of the shared remote seam (`lib/itinerary-remote.ts`), against a
// FAKE `firebase/auth` (and a fake app/firestore, so nothing real is constructed). Proves:
//
//   1. `getRemote()` awaits the FIRST auth-state resolution and signs in anonymously only when
//      there is no restored session — a restored uid is reused, never re-minted (re-minting would
//      orphan this device's entry in every trip's members map on every reload).
//   2. A sign-in failure REJECTS and clears the cached handle, so a later call retries from
//      scratch (the cold-start-while-offline case).
//   3. `getAuthIdToken()` is TOTAL: `null` when remote is unconfigured — with NO firebase touched
//      at all — and `null` on any failure; otherwise the SDK's own current token.
//
// ⚠ THE ASSERTIONS COUNT MOCK CALLS, not only outcomes (the S378 rigour): every function under
// test swallows failure to a `null`/warn, so "returned null" alone cannot distinguish "the gate
// held" from "the mock was bypassed and the real module quietly failed". A call count can.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const gate = vi.hoisted(() => ({ on: true }));
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => gate.on,
  isTripRemoteConfigured: () => gate.on,
  getTripId: () => 'trip-under-test',
}));

const authCtl = vi.hoisted(() => ({
  /** What the first `onAuthStateChanged` resolution reports (null ⇒ no session yet). */
  restored: null as null | { uid: string },
  /** The observer's error channel fires instead of `next` when true. */
  observerFails: false,
  signInCalls: 0,
  signInFails: false,
  getAuthCalls: 0,
  idToken: 'id-token-1',
  idTokenFails: false,
  /** Mirrors the SDK: whoever is signed in right now. */
  currentUid: null as string | null,
}));

vi.mock('firebase/app', () => ({
  initializeApp: () => ({ name: 'fake' }),
  getApps: () => [],
  getApp: () => ({ name: 'fake' }),
}));
vi.mock('firebase/firestore', () => ({
  getFirestore: () => ({ __type: 'db' }),
  doc: (_db: unknown, ...segs: string[]) => ({ __type: 'doc', path: segs.join('/') }),
}));
vi.mock('firebase/auth', () => ({
  getAuth: () => {
    authCtl.getAuthCalls += 1;
    return {
      get currentUser() {
        return authCtl.currentUid === null
          ? null
          : {
              uid: authCtl.currentUid,
              getIdToken: async () => {
                if (authCtl.idTokenFails) throw new Error('token mint failed');
                return authCtl.idToken;
              },
            };
      },
    };
  },
  onAuthStateChanged: (
    _auth: unknown,
    next: (u: unknown) => void,
    onError?: (e: unknown) => void,
  ) => {
    // Asynchronous like the real observer (the seam calls its own unsubscribe from inside the
    // callback, which would hit the temporal dead zone if this fired synchronously).
    queueMicrotask(() => {
      if (authCtl.observerFails) onError?.(new Error('auth unavailable'));
      else next(authCtl.restored);
    });
    return () => {};
  },
  signInAnonymously: async () => {
    authCtl.signInCalls += 1;
    if (authCtl.signInFails) throw new Error('sign-in failed');
    authCtl.currentUid = 'anon-uid-new';
    return { user: { uid: 'anon-uid-new' } };
  },
}));

/** A fresh module registry per test — `getRemote` caches its handle at module scope. */
async function freshRemote() {
  vi.resetModules();
  return import('@/lib/itinerary-remote');
}

beforeEach(() => {
  gate.on = true;
  authCtl.restored = null;
  authCtl.observerFails = false;
  authCtl.signInCalls = 0;
  authCtl.signInFails = false;
  authCtl.getAuthCalls = 0;
  authCtl.idToken = 'id-token-1';
  authCtl.idTokenFails = false;
  authCtl.currentUid = null;
});

describe('getRemote — anonymous sign-in is part of the handle (#10)', () => {
  it('signs in anonymously when there is no restored session, and exposes uid + auth', async () => {
    const { getRemote } = await freshRemote();
    const handle = await getRemote();
    expect(authCtl.signInCalls).toBe(1);
    expect(handle.uid).toBe('anon-uid-new');
    expect(handle.auth).toBeTruthy();
    expect(handle.db).toBeTruthy();
  });

  it('REUSES a restored session — the uid is stable across reloads, never re-minted', async () => {
    authCtl.restored = { uid: 'anon-uid-stored' };
    authCtl.currentUid = 'anon-uid-stored';
    const { getRemote } = await freshRemote();
    const handle = await getRemote();
    // The whole point: a second anonymous uid would leave this device's members entry orphaned.
    expect(authCtl.signInCalls).toBe(0);
    expect(handle.uid).toBe('anon-uid-stored');
  });

  it('caches one init — concurrent callers share a single sign-in', async () => {
    const { getRemote } = await freshRemote();
    const [a, b] = await Promise.all([getRemote(), getRemote()]);
    expect(authCtl.signInCalls).toBe(1);
    expect(authCtl.getAuthCalls).toBe(1);
    expect(a.uid).toBe(b.uid);
  });

  it('a sign-in failure rejects AND clears the cache, so a later call retries', async () => {
    authCtl.signInFails = true;
    const { getRemote } = await freshRemote();
    await expect(getRemote()).rejects.toThrow('sign-in failed');
    expect(authCtl.signInCalls).toBe(1);

    authCtl.signInFails = false;
    const handle = await getRemote(); // retried from scratch rather than being stuck
    expect(authCtl.signInCalls).toBe(2);
    expect(handle.uid).toBe('anon-uid-new');
  });

  it('an auth-observer error rejects (and is retryable) rather than hanging forever', async () => {
    authCtl.observerFails = true;
    const { getRemote } = await freshRemote();
    await expect(getRemote()).rejects.toThrow('auth unavailable');
    expect(authCtl.signInCalls).toBe(0);
  });

  it('never touches firebase when remote is unconfigured', async () => {
    gate.on = false;
    const { getRemote } = await freshRemote();
    await expect(getRemote()).rejects.toThrow('remote not configured');
    expect(authCtl.getAuthCalls).toBe(0);
    expect(authCtl.signInCalls).toBe(0);
  });
});

describe('getAuthIdToken — TOTAL: a token, or null (#10)', () => {
  it('returns the current session token', async () => {
    const { getAuthIdToken } = await freshRemote();
    expect(await getAuthIdToken()).toBe('id-token-1');
  });

  it('returns null when remote is unconfigured, with NO firebase touched', async () => {
    gate.on = false;
    const { getAuthIdToken } = await freshRemote();
    expect(await getAuthIdToken()).toBeNull();
    // The zero is a measurement, not a mock that was silently bypassed.
    expect(authCtl.getAuthCalls).toBe(0);
    expect(authCtl.signInCalls).toBe(0);
  });

  it('returns null when the init/sign-in fails (never throws into the caller)', async () => {
    authCtl.signInFails = true;
    const { getAuthIdToken } = await freshRemote();
    await expect(getAuthIdToken()).resolves.toBeNull();
    expect(authCtl.signInCalls).toBe(1);
  });

  it('returns null when minting the token itself fails', async () => {
    authCtl.idTokenFails = true;
    const { getAuthIdToken } = await freshRemote();
    await expect(getAuthIdToken()).resolves.toBeNull();
  });
});

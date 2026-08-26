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
  /** `providerData` on the current user — 'google.com' once linked. */
  providers: [] as string[],
  linkCalls: 0,
  /** The `code` `linkWithPopup` rejects with, or null to succeed. */
  linkErrorCode: null as string | null,
  /** What `GoogleAuthProvider.credentialFromError` hands back. */
  credentialFromError: { providerId: 'google.com' } as unknown,
  credentialSignIns: 0,
}));

vi.mock('firebase/app', () => ({
  initializeApp: () => ({ name: 'fake' }),
  getApps: () => [],
  getApp: () => ({ name: 'fake' }),
}));
vi.mock('firebase/firestore', () => ({
  getFirestore: () => ({ __type: 'db' }),
  initializeFirestore: () => ({ __type: 'db' }),
  persistentLocalCache: () => ({}),
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
              providerData: authCtl.providers.map((providerId) => ({ providerId })),
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
  GoogleAuthProvider: class {
    static credentialFromError() {
      return authCtl.credentialFromError;
    }
  },
  linkWithPopup: async () => {
    authCtl.linkCalls += 1;
    if (authCtl.linkErrorCode) {
      throw Object.assign(new Error('link failed'), { code: authCtl.linkErrorCode });
    }
    authCtl.providers.push('google.com'); // linking keeps the uid and adds a provider
    return { user: { uid: authCtl.currentUid } };
  },
  signInWithCredential: async () => {
    authCtl.credentialSignIns += 1;
    authCtl.currentUid = 'adopted-uid'; // adopting SWAPS the identity — the uid changes
    authCtl.restored = { uid: 'adopted-uid' };
    authCtl.providers = ['google.com'];
    return { user: { uid: 'adopted-uid' } };
  },
}));

/** A fresh module registry per test — `getRemote` caches its handle at module scope. */
async function freshRemote() {
  vi.resetModules();
  return import('@/lib/firebase-remote');
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
  authCtl.providers = [];
  authCtl.linkCalls = 0;
  authCtl.linkErrorCode = null;
  authCtl.credentialFromError = { providerId: 'google.com' };
  authCtl.credentialSignIns = 0;
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

describe('linkGoogleAccount — every branch says something, and none of them lose access (#10)', () => {
  it('a successful link KEEPS the uid (the entire point) and reports it linked', async () => {
    const { getRemote, linkGoogleAccount, isGoogleLinked } = await freshRemote();
    const before = (await getRemote()).uid;

    expect(await linkGoogleAccount()).toBe('linked');

    expect(authCtl.linkCalls).toBe(1);
    // A different uid here would mean this device just lost its place in every trip's roster.
    expect((await getRemote()).uid).toBe(before);
    expect(await isGoogleLinked()).toBe(true);
  });

  it('a blocked popup is reported as such — no adoption, no identity change', async () => {
    authCtl.linkErrorCode = 'auth/popup-blocked';
    const { getRemote, linkGoogleAccount } = await freshRemote();
    const before = (await getRemote()).uid;

    expect(await linkGoogleAccount()).toBe('popup-blocked');
    expect(authCtl.credentialSignIns).toBe(0);
    expect((await getRemote()).uid).toBe(before);
  });

  it('a popup the user closed reports the same actionable state, not a generic failure', async () => {
    authCtl.linkErrorCode = 'auth/popup-closed-by-user';
    const { linkGoogleAccount } = await freshRemote();
    expect(await linkGoogleAccount()).toBe('popup-blocked');
  });

  it('credential-already-in-use ADOPTS that identity and drops the stale cached uid', async () => {
    authCtl.linkErrorCode = 'auth/credential-already-in-use';
    const { getRemote, linkGoogleAccount } = await freshRemote();
    const before = (await getRemote()).uid;
    expect(before).toBe('anon-uid-new');

    expect(await linkGoogleAccount()).toBe('adopted');

    expect(authCtl.credentialSignIns).toBe(1);
    // The cache MUST have been cleared: every caller reads `uid` off this handle, and a stale one
    // would enrol the wrong identity in the trip's roster.
    expect((await getRemote()).uid).toBe('adopted-uid');
  });

  it('credential-already-in-use with no recoverable credential fails without signing anything in', async () => {
    authCtl.linkErrorCode = 'auth/credential-already-in-use';
    authCtl.credentialFromError = null;
    const { linkGoogleAccount } = await freshRemote();

    expect(await linkGoogleAccount()).toBe('failed');
    expect(authCtl.credentialSignIns).toBe(0);
  });

  it('any other error leaves the device anonymous and unchanged', async () => {
    authCtl.linkErrorCode = 'auth/network-request-failed';
    const { getRemote, linkGoogleAccount, isGoogleLinked } = await freshRemote();
    const before = (await getRemote()).uid;

    expect(await linkGoogleAccount()).toBe('failed');
    expect((await getRemote()).uid).toBe(before);
    expect(await isGoogleLinked()).toBe(false);
  });

  it('never opens a popup on a dormant build', async () => {
    gate.on = false;
    const { linkGoogleAccount, isGoogleLinked } = await freshRemote();
    expect(await linkGoogleAccount()).toBe('failed');
    expect(await isGoogleLinked()).toBe(false);
    expect(authCtl.linkCalls).toBe(0);
    expect(authCtl.getAuthCalls).toBe(0);
  });
});

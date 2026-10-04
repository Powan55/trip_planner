// @vitest-environment jsdom
//
// #10 — the Firebase Auth half of the shared remote seam (`lib/itinerary-remote.ts`), against a
// FAKE `firebase/auth` (and a fake app/firestore, so nothing real is constructed). Proves:
//
//   1. `getAuthHandle()` (under `getRemote()`) awaits the FIRST auth-state resolution and signs in anonymously only when
//      there is no restored session — a restored uid is reused, never re-minted (re-minting would
//      orphan this device's entry in every trip's members map on every reload).
//   2. A sign-in failure REJECTS and clears the cached handle, so a later call retries from
//      scratch (the cold-start-while-offline case).
//   3. `getAuthIdToken()` is TOTAL: `null` when remote is unconfigured — with NO firebase touched
//      at all — and `null` on any failure; otherwise the SDK's own current token.
//   4. The password helpers (D-660): sign-up LINKS an anonymous session (the uid survives), sign-in
//      rebinds the cached handle to the account's uid, and `users/{uid}` reads/writes behave as the
//      create-only claim flow needs.
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
  anonymous: true,
  calls: [] as string[],
  /** The `code` the next password call rejects with, or null to succeed. */
  errorCode: null as string | null,
}));

const docs = vi.hoisted(() => ({
  store: new Map<string, Record<string, unknown>>(),
  readFails: false,
  /** Create-only, like the rules: a second write to an existing users doc is refused. */
  writeFails: false,
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
  waitForPendingWrites: async () => {
    authCtl.calls.push('flush');
  },
  getDocFromServer: async (ref: { path: string }) => {
    if (docs.readFails) throw Object.assign(new Error('offline'), { code: 'unavailable' });
    const data = docs.store.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
  },
  setDoc: async (ref: { path: string }, data: Record<string, unknown>) => {
    if (docs.writeFails || docs.store.has(ref.path)) {
      throw Object.assign(new Error('denied'), { code: 'permission-denied' });
    }
    docs.store.set(ref.path, data);
  },
  writeBatch: () => {
    const ops: [string, Record<string, unknown>][] = [];
    return {
      set: (ref: { path: string }, data: Record<string, unknown>) => void ops.push([ref.path, data]),
      commit: async () => {
        if (docs.writeFails || ops.some(([p]) => docs.store.has(p))) {
          throw Object.assign(new Error('denied'), { code: 'permission-denied' });
        }
        for (const [p, d] of ops) docs.store.set(p, d);
      },
    };
  },
}));

function fail() {
  if (authCtl.errorCode) throw Object.assign(new Error('auth'), { code: authCtl.errorCode });
}

vi.mock('firebase/auth', () => ({
  getAuth: () => {
    authCtl.getAuthCalls += 1;
    return {
      get currentUser() {
        return authCtl.currentUid === null
          ? null
          : {
              uid: authCtl.currentUid,
              isAnonymous: authCtl.anonymous,
              email: authCtl.anonymous ? null : 'powan@accounts.trip-planner.invalid',
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
    authCtl.anonymous = true;
    return { user: { uid: 'anon-uid-new' } };
  },
  EmailAuthProvider: {
    credential: (email: string, password: string) => ({ email, password }),
  },
  linkWithCredential: async (user: { uid: string }, cred: { email: string }) => {
    authCtl.calls.push(`link:${cred.email}`);
    fail();
    authCtl.anonymous = false; // linking keeps the uid
    return { user: { uid: user.uid } };
  },
  createUserWithEmailAndPassword: async (_auth: unknown, email: string) => {
    authCtl.calls.push(`create:${email}`);
    fail();
    authCtl.currentUid = 'created-uid';
    authCtl.anonymous = false;
    return { user: { uid: 'created-uid' } };
  },
  signInWithEmailAndPassword: async (_auth: unknown, email: string) => {
    authCtl.calls.push(`signin:${email}`);
    fail();
    authCtl.currentUid = 'account-uid';
    authCtl.anonymous = false;
    return { user: { uid: 'account-uid' } };
  },
  updatePassword: async (_user: unknown, password: string) => {
    authCtl.calls.push(`update:${password}`);
    fail();
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
  authCtl.anonymous = true;
  authCtl.calls = [];
  authCtl.errorCode = null;
  docs.store.clear();
  docs.readFails = false;
  docs.writeFails = false;
  window.localStorage.clear();
});

describe('getRemote — anonymous sign-in is part of the handle (#10)', () => {
  it('signs in anonymously when there is no restored session, and exposes uid + auth', async () => {
    const { getAuthHandle: getRemote } = await freshRemote();
    const handle = await getRemote();
    expect(authCtl.signInCalls).toBe(1);
    expect(handle.uid).toBe('anon-uid-new');
    expect(handle.auth).toBeTruthy();
    expect(handle.db).toBeTruthy();
  });

  it('REUSES a restored session — the uid is stable across reloads, never re-minted', async () => {
    authCtl.restored = { uid: 'anon-uid-stored' };
    authCtl.currentUid = 'anon-uid-stored';
    const { getAuthHandle: getRemote } = await freshRemote();
    const handle = await getRemote();
    // The whole point: a second anonymous uid would leave this device's members entry orphaned.
    expect(authCtl.signInCalls).toBe(0);
    expect(handle.uid).toBe('anon-uid-stored');
  });

  it('caches one init — concurrent callers share a single sign-in', async () => {
    const { getAuthHandle: getRemote } = await freshRemote();
    const [a, b] = await Promise.all([getRemote(), getRemote()]);
    expect(authCtl.signInCalls).toBe(1);
    expect(authCtl.getAuthCalls).toBe(1);
    expect(a.uid).toBe(b.uid);
  });

  it('a sign-in failure rejects AND clears the cache, so a later call retries', async () => {
    authCtl.signInFails = true;
    const { getAuthHandle: getRemote } = await freshRemote();
    await expect(getRemote()).rejects.toThrow('sign-in failed');
    expect(authCtl.signInCalls).toBe(1);

    authCtl.signInFails = false;
    const handle = await getRemote(); // retried from scratch rather than being stuck
    expect(authCtl.signInCalls).toBe(2);
    expect(handle.uid).toBe('anon-uid-new');
  });

  it('an auth-observer error rejects (and is retryable) rather than hanging forever', async () => {
    authCtl.observerFails = true;
    const { getAuthHandle: getRemote } = await freshRemote();
    await expect(getRemote()).rejects.toThrow('auth unavailable');
    expect(authCtl.signInCalls).toBe(0);
  });

  it('never touches firebase when remote is unconfigured', async () => {
    gate.on = false;
    const { getAuthHandle: getRemote } = await freshRemote();
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

describe('password accounts (D-660)', () => {
  it('sign-up LINKS the anonymous session, so the uid already in trip rosters is the account', async () => {
    const { getAuthHandle: getRemote, createPasswordAccount } = await freshRemote();
    const before = await getRemote();
    const uid = await createPasswordAccount('powan@x.invalid', 'longenough');
    expect(authCtl.calls).toEqual(['link:powan@x.invalid']);
    expect(uid).toBe(before.uid);
    expect((await getRemote()).uid).toBe(before.uid);
  });

  it('sign-up over a non-anonymous session creates a new user instead of linking onto it', async () => {
    authCtl.restored = { uid: 'someone-else' };
    authCtl.currentUid = 'someone-else';
    authCtl.anonymous = false;
    const { createPasswordAccount, getAuthHandle: getRemote } = await freshRemote();
    expect(await createPasswordAccount('new@x.invalid', 'longenough')).toBe('created-uid');
    expect(authCtl.calls).toEqual(['create:new@x.invalid']);
    expect((await getRemote()).uid).toBe('created-uid');
  });

  it('a taken username rejects with the SDK code for the caller to word', async () => {
    authCtl.errorCode = 'auth/email-already-in-use';
    const { createPasswordAccount } = await freshRemote();
    await expect(createPasswordAccount('taken@x.invalid', 'longenough')).rejects.toMatchObject({
      code: 'auth/email-already-in-use',
    });
  });

  it('sign-in rebinds the cached handle to the account uid (no stale anonymous uid)', async () => {
    const { getAuthHandle: getRemote, signInWithPassword } = await freshRemote();
    expect((await getRemote()).uid).toBe('anon-uid-new');
    expect(await signInWithPassword('powan@x.invalid', 'pw')).toBe('account-uid');
    expect((await getRemote()).uid).toBe('account-uid');
    expect(authCtl.signInCalls).toBe(1); // the password session is never replaced by a new anon one
  });

  it('a restored password session is reused, never signed in anonymously over', async () => {
    authCtl.restored = { uid: 'account-uid' };
    authCtl.currentUid = 'account-uid';
    authCtl.anonymous = false;
    const { getAuthHandle: getRemote } = await freshRemote();
    expect((await getRemote()).uid).toBe('account-uid');
    expect(authCtl.signInCalls).toBe(0);
  });

  it('readAccountLink: null when absent, the link when present, REJECTS when unreachable', async () => {
    const { readAccountLink } = await freshRemote();
    expect(await readAccountLink('u1')).toBeNull();
    docs.store.set('users/u1', { username: 'powan', accountId: 'acct-1' });
    expect(await readAccountLink('u1')).toEqual({ username: 'powan', accountId: 'acct-1' });
    docs.readFails = true;
    await expect(readAccountLink('u1')).rejects.toThrow('offline');
  });

  const ID1 = '11111111-2222-4333-8444-555555555555';
  const ID2 = '66666666-7777-4888-8999-aaaaaaaaaaaa';

  it('writeAccountLink writes users + accountClaims once; a retry adopts what is there', async () => {
    const { writeAccountLink } = await freshRemote();
    expect(await writeAccountLink('u1', { username: 'powan', accountId: ID1 })).toBe(ID1);
    expect(docs.store.get('users/u1')).toEqual({ username: 'powan', accountId: ID1 });
    expect(docs.store.get(`accountClaims/${ID1}`)).toEqual({ uid: 'u1' });
    expect(await writeAccountLink('u1', { username: 'powan', accountId: ID2 })).toBe(ID1);
    expect(docs.store.get('users/u1')).toEqual({ username: 'powan', accountId: ID1 });
    expect(docs.store.has(`accountClaims/${ID2}`)).toBe(false);
  });

  it('writeAccountLink says so when another user already claimed the id', async () => {
    docs.store.set(`accountClaims/${ID1}`, { uid: 'someone-else' });
    const { writeAccountLink } = await freshRemote();
    await expect(writeAccountLink('u1', { username: 'p', accountId: ID1 })).rejects.toMatchObject({
      code: 'account/claimed',
    });
    expect(docs.store.has('users/u1')).toBe(false);
  });

  it('writeAccountLink rejects when the write fails and nothing is there', async () => {
    docs.writeFails = true;
    const { writeAccountLink } = await freshRemote();
    await expect(writeAccountLink('u1', { username: 'p', accountId: ID1 })).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('writeAccountLink refuses an id that is not a lowercase UUID before writing', async () => {
    const { writeAccountLink } = await freshRemote();
    await expect(writeAccountLink('u1', { username: 'p', accountId: 'acct-1' })).rejects.toThrow(
      'invalid account id',
    );
    expect(docs.store.size).toBe(0);
  });

  it('changePassword passes the SDK rejection through', async () => {
    const { signInWithPassword, changePassword } = await freshRemote();
    await signInWithPassword('powan@x.invalid', 'temp');
    authCtl.errorCode = 'auth/weak-password';
    await expect(changePassword('newpassword')).rejects.toMatchObject({ code: 'auth/weak-password' });
  });

  it('never touches firebase on a dormant build', async () => {
    gate.on = false;
    const { signInWithPassword } = await freshRemote();
    await expect(signInWithPassword('a@x.invalid', 'pw')).rejects.toThrow('remote not configured');
    expect(authCtl.getAuthCalls).toBe(0);
  });
});

describe('needsAccountUpgrade — fail-open (D-660)', () => {
  it('anonymous for an anonymous session; null for a password user with users/{uid}', async () => {
    const { needsAccountUpgrade } = await freshRemote();
    expect(await needsAccountUpgrade()).toEqual({ kind: 'anonymous', claimed: false });

    // key 28 already claimed by a username: the card must offer log-in only.
    const id = '11111111-2222-4333-8444-555555555555';
    window.localStorage.setItem('tripPlannerSyncCode', id);
    docs.store.set(`accountClaims/${id}`, { uid: 'someone' });
    expect(await needsAccountUpgrade()).toEqual({ kind: 'anonymous', claimed: true });

    authCtl.restored = { uid: 'account-uid' };
    authCtl.currentUid = 'account-uid';
    authCtl.anonymous = false;
    docs.store.set('users/account-uid', { username: 'powan', accountId: 'acct-1' });
    const again = await freshRemote();
    expect(await again.needsAccountUpgrade()).toBeNull();
  });

  it('a password user with NO users/{uid} resumes the claim', async () => {
    authCtl.restored = { uid: 'account-uid' };
    authCtl.currentUid = 'account-uid';
    authCtl.anonymous = false;
    const { needsAccountUpgrade } = await freshRemote();
    expect(await needsAccountUpgrade()).toEqual({
      kind: 'claim',
      uid: 'account-uid',
      username: 'powan',
    });
  });

  it('null when the users/{uid} read fails, when auth is unreachable, and dormant', async () => {
    authCtl.restored = { uid: 'account-uid' };
    authCtl.currentUid = 'account-uid';
    authCtl.anonymous = false;
    docs.readFails = true;
    const { needsAccountUpgrade } = await freshRemote();
    expect(await needsAccountUpgrade()).toBeNull();

    authCtl.observerFails = true;
    const broken = await freshRemote();
    expect(await broken.needsAccountUpgrade()).toBeNull();

    gate.on = false;
    authCtl.getAuthCalls = 0;
    const dormant = await freshRemote();
    expect(await dormant.needsAccountUpgrade()).toBeNull();
    expect(authCtl.getAuthCalls).toBe(0);
  });

  it('null while the browser reports offline', async () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      const { needsAccountUpgrade } = await freshRemote();
      expect(await needsAccountUpgrade()).toBeNull();
      expect(authCtl.getAuthCalls).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('isPasswordSession and the pre-sign-in flush (D-660)', () => {
  it('false for anonymous and dormant, true after a password sign-in', async () => {
    const { isPasswordSession, signInWithPassword } = await freshRemote();
    expect(await isPasswordSession()).toBe(false);
    await signInWithPassword('powan@x.invalid', 'pw');
    expect(await isPasswordSession()).toBe(true);
    gate.on = false;
    const dormant = await freshRemote();
    expect(await dormant.isPasswordSession()).toBe(false);
  });

  it('flushes writes queued under the old uid before swapping the session', async () => {
    const { signInWithPassword } = await freshRemote();
    await signInWithPassword('powan@x.invalid', 'pw');
    expect(authCtl.calls).toEqual(['flush', 'signin:powan@x.invalid']);
  });
});

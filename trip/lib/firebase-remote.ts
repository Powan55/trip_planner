'use client';

import { FIREBASE_CONFIG, getTripId, isRemoteConfigured } from './firebase-config';
import { getSyncCode } from '@/core/storage/gateway';
import { SHARED_TRIP_ID } from './shared-trip';
import { isPermissionDenied } from '@/core/sync/denied';
import { setSignInRequired } from '@/core/sync/read-denied';
import { ACCOUNT_ID_RE, ACCOUNT_CLAIMED } from './account-codes';

// ---------------------------------------------------------------------------
// Shared lazy firebase handle. Both the read (subscribe) and write (push) paths
// need the same app/firestore instances; init them once, behind the gate, via
// dynamic import. The promise
// is cached so concurrent callers share one init.
//
// AUTH IS BACK, AND IT IS PART OF THE HANDLE (issue #10). The rules no longer read
// `if true` under a known tripId: every trip operation now sits behind an auth floor
// (`request.auth != null`), and a trip that has grown a `members` map is gated on membership.
// So this seam signs the device in ANONYMOUSLY before it resolves, and hands back the `auth`
// instance plus the resulting `uid`. Every other remote module awaits THIS function, so no
// module can issue a write before the floor is satisfied.
//
// THE UID is the subject a trip's members map names. Before the door it is an anonymous
// session; `createPasswordAccount` links that session, so the same uid becomes the account's,
// and `signInWithPassword` swaps to the account's uid (D-660). An anonymous session is only
// started when there is no session at all, never over a password one. Attribution still runs
// through the separate, firebase-free display-name pipeline (lib/identity.ts / token-auth.ts).
// ---------------------------------------------------------------------------

export type FirestoreMod = typeof import('firebase/firestore');

export interface RemoteHandle {
  db: import('firebase/firestore').Firestore;
  fs: FirestoreMod;
  /** The one shared app's Auth instance (the same singleton every module resolves). */
  auth: import('firebase/auth').Auth;
  /** The signed-in uid — the subject a trip's `members` map names. */
  uid: string;
}

let remotePromise: Promise<RemoteHandle> | null = null;

/**
 * Rejection `getSharedRemote()` gives an anonymous session on the shared trip. Not a permission error
 * on purpose: the outbox keeps the chunk dirty and retries it after sign-in instead of marking it
 * refused.
 */
export class SignInRequiredError extends Error {
  readonly code = 'sign-in-required';
  constructor() {
    super('sign in to sync');
    this.name = 'SignInRequiredError';
  }
}

/**
 * Lazily initialize firebase (app + firestore) ONCE, behind the `isRemoteConfigured()` gate.
 * Rejects (caller degrades to local-only) if the gate is off or any step fails; never throws
 * synchronously.
 *
 * EXPORTED so the expenses adapter (`lib/expenses-remote.ts`) shares the SAME cached
 * init — one firebase app across every synced domain. The anonymous sign-in is part of the
 * init, so awaiting this function is what guarantees the rules' auth floor is satisfied
 * before any caller issues a read or a write.
 */
export function getRemote(): Promise<RemoteHandle> {
  return getAuthHandle();
}

/**
 * `getRemote()` for the shared trip's content. The shared trip's rules answer to the account's
 * email, so an anonymous session would only burn denied reads: it is turned away here instead,
 * and the sync badge asks for a sign-in. Any other trip is unaffected. The one place the
 * sign-in-required flag is set.
 */
export async function getSharedRemote(): Promise<RemoteHandle> {
  const handle = await getAuthHandle();
  const anonymous = getTripId() === SHARED_TRIP_ID && !handle.auth.currentUser?.email;
  setSignInRequired(anonymous);
  if (anonymous) throw new SignInRequiredError();
  return handle;
}

/** `getRemote()` for a caller that needs a password account whatever trip it is on. */
export async function getAccountRemote(): Promise<RemoteHandle> {
  const handle = await getAuthHandle();
  if (!handle.auth.currentUser?.email) throw new SignInRequiredError();
  return handle;
}

// Sign-in only, for the auth helpers below: they move no trip data and must work for the anonymous
// session the sign-in step starts from.
export function getAuthHandle(): Promise<RemoteHandle> {
  if (!isRemoteConfigured()) {
    return Promise.reject(new Error('remote not configured'));
  }
  if (remotePromise) return remotePromise;

  remotePromise = (async () => {
    const [{ initializeApp, getApps }, firestoreMod, authMod] = await Promise.all([
      import('firebase/app'),
      import('firebase/firestore'),
      import('firebase/auth'),
    ]);

    const { initializeFirestore, persistentLocalCache } = firestoreMod;
    const { getAuth, onAuthStateChanged, signInAnonymously } = authMod;

    // Reuse the singleton app if it already exists (one init across the app),
    // otherwise create it from the single-source config.
    // By name: a sign-in handoff's secondary app may be the only one alive at this point.
    const app = getApps().find((a) => a.name === '[DEFAULT]') ?? initializeApp(FIREBASE_CONFIG);

    const db = initializeFirestore(app, { localCache: persistentLocalCache() });
    // Single-tab persistent cache; switch to persistentMultipleTabManager() if a second
    // open tab on the same device needs offline reads too.
    const auth = getAuth(app);

    // AWAIT THE FIRST AUTH-STATE RESOLUTION BEFORE SIGNING IN. Firebase restores a persisted
    // session asynchronously, so `auth.currentUser` is null for a beat on EVERY load; signing
    // in during that beat would mint a SECOND anonymous uid and silently orphan this device's
    // members entry (it would still be listed, under a uid nothing uses any more). Resolving
    // the observer once is what makes the uid stable across reloads.
    const restored = await new Promise<import('firebase/auth').User | null>((resolve, reject) => {
      const unsub = onAuthStateChanged(
        auth,
        (user) => {
          unsub();
          resolve(user);
        },
        (err) => {
          unsub();
          reject(err);
        },
      );
    });
    const user = restored ?? (await signInAnonymously(auth)).user;

    return { db, fs: firestoreMod, auth, uid: user.uid };
  })();

  // If init (incl. sign-in) fails, clear the cache so a later call can retry rather than
  // being stuck — a cold start while offline must not poison the handle for the session.
  remotePromise.catch(() => {
    remotePromise = null;
  });

  return remotePromise;
}

/**
 * This device's Firebase ID token, or `null` — for the Worker's `Authorization: Bearer …`
 * (issue #10).
 *
 * THE HEADER IS NOT A GATE. Worker 1.9.0 was to verify the caller by reading the trip doc from
 * the Firestore REST API AS this user, but 1.9.0 is not what is live — the running Worker
 * verifies nothing. Sending this token buys no access control on its own, and no amount of
 * client-side gating can supply any; the check has to land on the Worker first. See the NOT A
 * BOUNDARY note in `lib/worker-auth.ts`, which owns this policy.
 *
 * TOTAL: `null` when remote is unconfigured (the dormant build and every e2e run) and on ANY
 * failure, so a caller can only ever attach a header it actually has. The token is minted by
 * the SDK and refreshed by it — never cached here.
 */
export async function getAuthIdToken(): Promise<string | null> {
  if (!isRemoteConfigured()) return null;
  try {
    const { auth } = await getAuthHandle();
    return (await auth.currentUser?.getIdToken()) ?? null;
  } catch {
    return null; // unreachable firebase must degrade to "no header", never to a thrown turn
  }
}

const CLEAR_CACHE_TIMEOUT_MS = 3000;
const FLUSH_WAIT_MS = 1500;
const WRITE_TIMEOUT_MS = 8000;

/** Reject with `code: 'deadline-exceeded'` if `work` has not settled within `ms`. */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(Object.assign(new Error('timed out'), { code: 'deadline-exceeded' })),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Drop this device's Firestore cache before a sign-out wipe (#571, D-576): the cached trip docs
 * and any queued writes. `signOutAuth` also signs out of Firebase Auth, so the next person on the
 * device starts from a fresh anonymous uid. Best-effort and bounded: never throws, never waits more than
 * a few seconds, because sign-out has to finish even when this cannot.
 *
 * When Firebase never started on this page load, the leftovers of an earlier one are deleted by
 * name (the SDK's names for the default app and database) rather than starting the SDK just to
 * clear it.
 */
export async function clearRemoteCache({ signOutAuth = false } = {}): Promise<void> {
  if (!isRemoteConfigured()) return;
  const pending = remotePromise;
  remotePromise = null;
  const work = (async () => {
    const handle = pending ? await pending.catch(() => null) : null;
    if (handle) {
      // Give queued offline writes a short chance to reach the server before they are dropped.
      await Promise.race([
        handle.fs.waitForPendingWrites(handle.db).catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, FLUSH_WAIT_MS)),
      ]);
      if (signOutAuth) await handle.auth.signOut();
      await handle.fs.terminate(handle.db);
      await handle.fs.clearIndexedDbPersistence(handle.db);
    } else {
      await Promise.all([
        deleteDatabase(`firestore/[DEFAULT]/${FIREBASE_CONFIG.projectId}/main`),
        signOutAuth ? deleteDatabase('firebaseLocalStorageDb') : null,
      ]);
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), CLEAR_CACHE_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    console.warn('[firebase-remote] could not clear the local Firestore cache', err);
  } finally {
    clearTimeout(timer);
  }
}

/** `users/{uid}`: which account id this Firebase user owns. Written once, after the password is theirs (D-660). */
export type AccountLink = { username: string; accountId: string };

type AuthUser = import('firebase/auth').User;

// The cached handle carries the uid it was created under; every sign-in that can change it goes
// through here so presence, membership and trip creation never write under the old one.
function rebind(handle: RemoteHandle, user: AuthUser): string {
  remotePromise = Promise.resolve({ ...handle, uid: user.uid });
  return user.uid;
}

/**
 * Create a username + password account. An anonymous session is LINKED rather than replaced, so
 * the uid this device already has in trip rosters becomes the account's uid. Rejects with the
 * SDK's error (the caller maps `code`); resolves the account's uid.
 */
export async function createPasswordAccount(email: string, password: string): Promise<string> {
  const handle = await getAuthHandle();
  const { EmailAuthProvider, linkWithCredential, createUserWithEmailAndPassword } = await import(
    'firebase/auth'
  );
  const current = handle.auth.currentUser;
  const { user } = current?.isAnonymous
    ? await linkWithCredential(current, EmailAuthProvider.credential(email, password))
    : await createUserWithEmailAndPassword(handle.auth, email, password);
  return rebind(handle, user);
}

/** Sign in with a username + password. Rejects with the SDK's error; resolves the uid. */
export async function signInWithPassword(email: string, password: string): Promise<string> {
  const handle = await getAuthHandle();
  const { signInWithEmailAndPassword } = await import('firebase/auth');
  // Writes queued under the current (anonymous) uid must reach the server with its credentials
  // before the session is swapped out; bounded, because a dead network must not hang the door.
  await Promise.race([
    handle.fs.waitForPendingWrites(handle.db).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, FLUSH_WAIT_MS)),
  ]);
  const { user } = await signInWithEmailAndPassword(handle.auth, email, password);
  return rebind(handle, user);
}

const UPGRADE_CHECK_MS = 8000;

/**
 * What a signed-in device still owes the account system (D-660):
 * - `anonymous`: admitted before passwords, never upgraded.
 * - `claim`: a password session with no `users/{uid}` yet (a first sign-in left half done), which
 *   resumes at the claim step.
 */
export type AccountUpgrade =
  /** `claimed`: this device's account id already has a username, so only log-in is offered. */
  | { kind: 'anonymous'; claimed: boolean }
  | { kind: 'claim'; uid: string; username: string };

/**
 * TOTAL and fail-open: `null` when dormant, offline, slow or failing, so the upgrade step only ever
 * shows when the answer is known.
 */
export async function needsAccountUpgrade(): Promise<AccountUpgrade | null> {
  if (!isRemoteConfigured()) return null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = async (): Promise<AccountUpgrade | null> => {
    const { auth, db, fs } = await getAuthHandle();
    const user = auth.currentUser;
    if (!user) return null;
    if (user.isAnonymous) {
      const code = getSyncCode();
      const claimed =
        !!code &&
        ACCOUNT_ID_RE.test(code) &&
        (await fs.getDocFromServer(fs.doc(db, 'accountClaims', code))).exists();
      return { kind: 'anonymous', claimed };
    }
    if (await readAccountLink(user.uid)) return null;
    return { kind: 'claim', uid: user.uid, username: (user.email ?? '').split('@')[0] };
  };
  try {
    return await Promise.race([
      check(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), UPGRADE_CHECK_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is this device signed in with a password (not anonymous)? `false` when dormant, unknown or
 * failing, which is the safe answer for sign-out: it keeps the anonymous uid and shows the key.
 */
export async function isPasswordSession(): Promise<boolean> {
  if (!isRemoteConfigured()) return false;
  try {
    const { auth } = await getAuthHandle();
    return auth.currentUser ? !auth.currentUser.isAnonymous : false;
  } catch {
    return false;
  }
}

/** Replace the signed-in user's password. Rejects with the SDK's error. */
export async function changePassword(password: string): Promise<void> {
  const { auth } = await getAuthHandle();
  const { updatePassword } = await import('firebase/auth');
  if (!auth.currentUser) throw new Error('not signed in');
  await updatePassword(auth.currentUser, password);
}

/**
 * SERVER read of `users/{uid}`. `null` means the server answered and there is no usable doc, which
 * is the first-sign-in signal; any failure REJECTS, because reading an outage as "missing" would
 * send an existing account through the claim flow and overwrite its link.
 */
export async function readAccountLink(
  uid: string,
  on?: Pick<RemoteHandle, 'db' | 'fs'>,
): Promise<AccountLink | null> {
  const { db, fs } = on ?? (await getAuthHandle());
  const snap = await fs.getDocFromServer(fs.doc(db, 'users', uid));
  if (!snap.exists()) return null;
  const data = snap.data() as Record<string, unknown>;
  if (typeof data.accountId !== 'string' || !data.accountId) return null;
  return {
    username: typeof data.username === 'string' ? data.username : '',
    accountId: data.accountId,
  };
}

/**
 * Create `users/{uid}` and `accountClaims/{accountId}` in ONE batch and resolve the account id.
 * Both are create-only, so a retry after a write that landed but whose answer was lost is refused;
 * when `users/{uid}` is already there, its account id wins. A refusal where the claim names someone
 * else rejects with `code: ACCOUNT_CLAIMED`.
 */
export async function writeAccountLink(uid: string, link: AccountLink): Promise<string> {
  if (!ACCOUNT_ID_RE.test(link.accountId)) throw new Error('invalid account id');
  const { db, fs } = await getAuthHandle();
  const batch = fs.writeBatch(db);
  batch.set(fs.doc(db, 'users', uid), { username: link.username, accountId: link.accountId });
  batch.set(fs.doc(db, 'accountClaims', link.accountId), { uid });
  try {
    await withTimeout(batch.commit(), WRITE_TIMEOUT_MS);
    return link.accountId;
  } catch (err) {
    const existing = await readAccountLink(uid).catch(() => null);
    if (existing) return existing.accountId;
    if (isPermissionDenied(err)) {
      const claim = await fs
        .getDocFromServer(fs.doc(db, 'accountClaims', link.accountId))
        .catch(() => null);
      const owner = claim?.exists() ? (claim.data() as { uid?: unknown }).uid : undefined;
      if (owner !== undefined && owner !== uid) {
        throw Object.assign(new Error('account id already claimed'), { code: ACCOUNT_CLAIMED });
      }
    }
    throw err;
  }
}

/**
 * Did this error come from the security rules refusing the operation? (issue #10)
 *
 * Still THE ONE COPY and still reachable under this name — the declaration moved to
 * `core/sync/denied.ts` so `core/sync/outbox.ts` can classify a refused push (#267) without a
 * third `lib/` import (D-423). Callers here are unchanged; see that file for the reasoning.
 */
export { isPermissionDenied } from '@/core/sync/denied';

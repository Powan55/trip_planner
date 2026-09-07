'use client';

import { FIREBASE_CONFIG, isRemoteConfigured } from './firebase-config';

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
// THE UID IS DEVICE IDENTITY, NOT ACCOUNT IDENTITY. It is the subject a trip's members map
// names, it is free and unlimited, and it survives a Google link (`linkGoogleAccount` below
// preserves it — that is the whole point of linking rather than re-signing-in). Attribution
// still runs entirely through the separate, firebase-free display-name pipeline
// (lib/identity.ts / token-auth.ts) — a Firebase uid is never shown to a user as a name.
// ---------------------------------------------------------------------------

export type FirestoreMod = typeof import('firebase/firestore');

export interface RemoteHandle {
  db: import('firebase/firestore').Firestore;
  fs: FirestoreMod;
  /** The one shared app's Auth instance (the same singleton every module resolves). */
  auth: import('firebase/auth').Auth;
  /** This DEVICE's uid at init time — the subject a trip's `members` map names. */
  uid: string;
}

let remotePromise: Promise<RemoteHandle> | null = null;

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
  if (!isRemoteConfigured()) {
    return Promise.reject(new Error('remote not configured'));
  }
  if (remotePromise) return remotePromise;

  remotePromise = (async () => {
    const [{ initializeApp, getApps, getApp }, firestoreMod, authMod] = await Promise.all([
      import('firebase/app'),
      import('firebase/firestore'),
      import('firebase/auth'),
    ]);

    const { initializeFirestore, persistentLocalCache } = firestoreMod;
    const { getAuth, onAuthStateChanged, signInAnonymously } = authMod;

    // Reuse the singleton app if it already exists (one init across the app),
    // otherwise create it from the single-source config.
    const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);

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
    const { auth } = await getRemote();
    return (await auth.currentUser?.getIdToken()) ?? null;
  } catch {
    return null; // unreachable firebase must degrade to "no header", never to a thrown turn
  }
}

/** What `linkGoogleAccount` did, as four outcomes a UI can speak plainly about. */
export type LinkResult = 'linked' | 'adopted' | 'popup-blocked' | 'failed';

/**
 * Link a Google identity onto THIS device's anonymous session (issue #10).
 *
 * WHY LINK RATHER THAN SIGN IN: linking PRESERVES the uid. The uid is what a trip's members map
 * names, so re-signing-in as Google (a different uid) would leave this device's entry pointing at
 * an identity nobody uses any more, and the user locked out of their own trip. Linking is the
 * whole feature; the Google account is a recovery handle bolted onto an identity that already has
 * access, not a new identity.
 *
 * 🔴 POPUP ONLY — NEVER `linkWithRedirect`. This app is a static export served from a GitHub Pages
 * origin while the Firebase `authDomain` is a different origin, so the redirect flow has to write
 * its pending-credential state cross-origin. Under Safari's storage partitioning that state is not
 * there when the user comes back, and the redirect completes as a silent no-op — the user taps,
 * disappears to Google, returns, and nothing has happened, with no error to show them. The popup
 * flow keeps the whole exchange in one window and reports its own failures, which is why every
 * branch below has something to say.
 *
 * ⚠ MUST BE CALLED FROM THE TAP'S USER GESTURE. Browsers only let a popup open under transient
 * activation. The `import('firebase/auth')` below resolves from the module cache in a microtask
 * (the Settings surface has already awaited `getRemote()` to show the device code by the time the
 * button exists), so it does not spend that activation — but do not move this behind a fetch.
 *
 * `credential-already-in-use` means that Google account is ALREADY a Firebase user — the traveler
 * linked it on their other device. Adopting it here (`signInWithCredential`) is exactly right: the
 * device takes on the identity that already holds the memberships, which is the lost-device
 * recovery path. It CHANGES the uid, so the cached handle is dropped and the caller must re-run
 * `ensureMembership`.
 */
export async function linkGoogleAccount(): Promise<LinkResult> {
  if (!isRemoteConfigured()) return 'failed';
  try {
    const { auth } = await getRemote();
    const { GoogleAuthProvider, linkWithPopup, signInWithCredential } = await import('firebase/auth');
    const user = auth.currentUser;
    if (!user) return 'failed';
    try {
      await linkWithPopup(user, new GoogleAuthProvider());
      return 'linked';
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      if (code === 'auth/popup-blocked' || code === 'auth/popup-closed-by-user') {
        return 'popup-blocked';
      }
      if (code === 'auth/credential-already-in-use') {
        const credential = GoogleAuthProvider.credentialFromError(
          err as import('firebase/app').FirebaseError,
        );
        if (!credential) return 'failed';
        await signInWithCredential(auth, credential);
        // The uid just changed. Drop the cached handle so the next getRemote() resolves the
        // ADOPTED identity — every caller reads `uid` off that handle.
        remotePromise = null;
        return 'adopted';
      }
      return 'failed';
    }
  } catch {
    return 'failed'; // stay anonymous; the device keeps whatever access it already had
  }
}

/**
 * Is this device's session linked to a Google identity? Read from `providerData`, which is the
 * SDK's own answer — never a flag we keep ourselves and have to keep true.
 * `false` when unconfigured/unreachable (the honest default: nothing is linked).
 */
export async function isGoogleLinked(): Promise<boolean> {
  if (!isRemoteConfigured()) return false;
  try {
    const { auth } = await getRemote();
    return auth.currentUser?.providerData.some((p) => p.providerId === 'google.com') ?? false;
  } catch {
    return false;
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

'use client';

import { FIREBASE_CONFIG } from './firebase-config';
import { getAuthHandle, readAccountLink, signInWithPassword, type AccountLink } from './firebase-remote';
import { listKnownTrips } from '@/core/trips/registry';
import { DEFAULT_TRIP_ID, isSafeTripSegment } from '@/core/storage/gateway';
import { OWNER_HANDOFF_FAILED } from './account-codes';

/**
 * Password sign-in that carries this device's trip access over to the account (D-660).
 *
 * Trip rosters name this device's anonymous uid (B). Once the session swaps to the account's uid (A)
 * nobody on this device can add A any more, so the grants happen first: a SECONDARY app with
 * in-memory persistence signs in as A to learn its uid and read `users/{A}` plus the account's
 * trip list, then, still as B, every known trip ∪ listed trip where B is rostered and A is not
 * gets `members.A = members[B]`. A failed OWNER grant aborts before the swap, because losing the
 * owner role cannot be undone from the client. Member grants are best-effort.
 *
 * Rejects with the SDK's error for bad credentials (checked by the secondary sign-in, so nothing is
 * granted to a wrong guess) and when `users/{A}` cannot be read.
 */
export async function signInWithHandoff(
  email: string,
  password: string,
): Promise<{ uid: string; link: AccountLink | null }> {
  const [{ initializeApp, deleteApp }, authMod, fsMod] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/firestore'),
  ]);
  const app = initializeApp(FIREBASE_CONFIG, `handoff-${Date.now()}`);
  let uidA: string;
  let link: AccountLink | null;
  let listed: string[] = [];
  try {
    const auth = authMod.initializeAuth(app, { persistence: authMod.inMemoryPersistence });
    uidA = (await authMod.signInWithEmailAndPassword(auth, email, password)).user.uid;
    const db = fsMod.getFirestore(app);
    link = await readAccountLink(uidA, { db, fs: fsMod });
    if (link && isSafeTripSegment(link.accountId)) {
      try {
        const snap = await fsMod.getDocFromServer(
          fsMod.doc(db, 'trips', link.accountId, 'profile', 'tripList'),
        );
        const trips = snap.exists() ? (snap.data() as { trips?: unknown }).trips : undefined;
        if (Array.isArray(trips)) {
          listed = trips.map((t) => (t as { id?: unknown })?.id).filter((id): id is string => typeof id === 'string');
        }
      } catch (err) {
        console.warn('[account-handoff] account trip list read failed:', err);
      }
    }
    await authMod.signOut(auth).catch(() => {});
  } finally {
    await deleteApp(app).catch(() => {});
  }

  await grantAccount(uidA, [...listKnownTrips().map((t) => t.id), ...listed]);
  const uid = await signInWithPassword(email, password);
  return { uid, link };
}

async function grantAccount(uidA: string, tripIds: string[]): Promise<void> {
  const { db, fs, auth } = await getAuthHandle();
  const me = auth.currentUser;
  if (!me?.isAnonymous || me.uid === uidA) return;
  const uidB = me.uid;
  const ids = [...new Set(tripIds)].filter((id) => id !== DEFAULT_TRIP_ID && isSafeTripSegment(id));
  const failed = await Promise.all(
    ids.map(async (id) => {
      const ref = fs.doc(db, 'trips', id);
      let role: unknown;
      try {
        const snap = await fs.getDocFromServer(ref);
        const members = snap.exists() ? (snap.data() as { members?: unknown }).members : undefined;
        if (!members || typeof members !== 'object' || uidA in members) return false;
        role = (members as Record<string, unknown>)[uidB];
      } catch {
        return false; // not readable as B: B is not on this trip, so there is nothing to carry
      }
      if (role !== 'owner' && role !== 'member') return false;
      try {
        await fs.updateDoc(ref, { [`members.${uidA}`]: role });
        return false;
      } catch (err) {
        console.warn('[account-handoff] roster grant failed:', id, err);
        return role === 'owner';
      }
    }),
  );
  if (failed.some(Boolean)) {
    throw Object.assign(new Error('owner grant failed'), { code: OWNER_HANDOFF_FAILED });
  }
}

// Single-use trip invites (#641). An owner mints `trips/{tripId}/invites/{token}`; whoever opens
// the link redeems it in one batch that marks the invite used and adds them to the roster as
// 'member'. Expiry (createdAt + 7 days) and single use are enforced by the rules; the client only
// mirrors them to decide what to list.
//
// Reached only through a dynamic import, like every other *-remote module.

'use client';

import { DEFAULT_TRIP_ID, getActiveTripId, getDefaultTripShareId, isSafeTripSegment } from '@/core/storage/gateway';
import { formatShareToken } from '@/core/trips/registry';
import { isRemoteConfigured } from './firebase-config';
import { getRemote, isPermissionDenied } from './firebase-remote';
import { withBasePath } from './base-path';
import { readMembers } from './trips-remote';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const PRUNE_BATCH = 25;

const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isInviteToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

export type TripInvite = { token: string; createdAt: number; expiresAt: number };
export type RedeemResult = 'joined' | 'already' | 'invalid' | 'failed';

function usable(tripId: string): boolean {
  return isRemoteConfigured() && isSafeTripSegment(tripId);
}

/** The `?trip=` value for a remote id: the default pack's share id carries its `pack:` prefix. */
function linkTripParam(tripId: string): string {
  const onSharedDefault = getActiveTripId() === DEFAULT_TRIP_ID && getDefaultTripShareId() === tripId;
  return formatShareToken(onSharedDefault ? DEFAULT_TRIP_ID : tripId, tripId);
}

/** Mint an invite and return its link, or `null` when the write did not land. Owner only (rules). */
export async function createInvite(tripId: string): Promise<string | null> {
  if (!usable(tripId)) return null;
  try {
    const { db, fs, uid } = await getRemote();
    const token = crypto.randomUUID();
    await fs.setDoc(fs.doc(db, 'trips', tripId, 'invites', token), {
      createdBy: uid,
      createdAt: fs.serverTimestamp(),
    });
    return `${window.location.origin}${withBasePath('/')}?trip=${encodeURIComponent(linkTripParam(tripId))}&invite=${token}`;
  } catch (err) {
    console.warn('[invites-remote] create failed:', err);
    return null;
  }
}

/** Unused, unexpired invites, newest first. `null` = could not be read (offline, refused). */
export async function listInvites(tripId: string): Promise<TripInvite[] | null> {
  if (!usable(tripId)) return null;
  try {
    const { db, fs } = await getRemote();
    const col = fs.collection(db, 'trips', tripId, 'invites');
    const now = Date.now();
    const cutoff = fs.Timestamp.fromMillis(now - INVITE_TTL_MS);
    // Expired docs are dead weight: delete a few per list (best effort) instead of reading them all every time.
    try {
      const old = await fs.getDocsFromServer(fs.query(col, fs.where('createdAt', '<=', cutoff), fs.limit(PRUNE_BATCH)));
      await Promise.all(old.docs.map((d) => fs.deleteDoc(d.ref)));
    } catch (err) {
      console.warn('[invites-remote] prune skipped:', err);
    }
    const snap = await fs.getDocsFromServer(fs.query(col, fs.where('createdAt', '>', cutoff)));
    const out: TripInvite[] = [];
    snap.forEach((d) => {
      const data = d.data() as { createdAt?: { toMillis?: () => number }; redeemedBy?: unknown };
      const createdAt = data.createdAt?.toMillis?.();
      if (!isInviteToken(d.id) || data.redeemedBy || typeof createdAt !== 'number') return;
      const expiresAt = createdAt + INVITE_TTL_MS;
      if (expiresAt > now) out.push({ token: d.id, createdAt, expiresAt });
    });
    return out.sort((a, b) => b.createdAt - a.createdAt);
  } catch (err) {
    console.warn('[invites-remote] list failed:', err);
    return null;
  }
}

/** Delete an invite so its link stops working. Owner only (rules). */
export async function revokeInvite(tripId: string, token: string): Promise<boolean> {
  if (!usable(tripId) || !isInviteToken(token)) return false;
  try {
    const { db, fs } = await getRemote();
    await fs.deleteDoc(fs.doc(db, 'trips', tripId, 'invites', token));
    return true;
  } catch (err) {
    console.warn('[invites-remote] revoke failed:', err);
    return false;
  }
}

/**
 * Use an invite to join a gated trip. A trip this device can already read is `'already'` (either
 * it is on the roster or the trip has none), so a re-opened link never burns a second invite.
 */
export async function redeemInvite(tripId: string, token: string): Promise<RedeemResult> {
  if (!isInviteToken(token) || !isSafeTripSegment(tripId)) return 'invalid';
  if (!isRemoteConfigured()) return 'failed';
  try {
    const { db, fs, uid } = await getRemote();
    const tripRef = fs.doc(db, 'trips', tripId);
    try {
      const snap = await fs.getDocFromServer(tripRef);
      if (snap.exists()) {
        const roster = readMembers(snap.data() as Record<string, unknown>);
        if (!roster || uid in roster) return 'already';
      }
    } catch (err) {
      // A gated trip refuses a non-member's read; that is the case the invite exists for.
      if (!isPermissionDenied(err)) throw err;
    }
    const batch = fs.writeBatch(db);
    batch.update(fs.doc(db, 'trips', tripId, 'invites', token), {
      redeemedBy: uid,
      redeemedAt: fs.serverTimestamp(),
    });
    batch.update(tripRef, { [`members.${uid}`]: 'member', joinInvite: token });
    await batch.commit();
    return 'joined';
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (isPermissionDenied(err) || code === 'not-found') return 'invalid';
    console.warn('[invites-remote] redeem failed:', err);
    return 'failed';
  }
}

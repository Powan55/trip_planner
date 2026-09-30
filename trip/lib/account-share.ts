// The default pack syncs to one shared trip for every account and device (SHARED_TRIP_ID). A
// device still holding some other id, or local edits with no id, is moved across here, and only
// once the shared trip has been read from the server as the signed-in user and the person has
// agreed to replace what is on the device.

'use client';

import {
  DEFAULT_TRIP_ID,
  defaultPackHasSyncedData,
  defaultShareReloadGuard,
  dropDefaultPackSyncedData,
  getActiveTripId,
  getStoredDefaultTripShareId,
  markDefaultTripAdopted,
  setDefaultTripShareId,
} from '@/core/storage/gateway';
import { replaceLocalPlanCopy } from '@/core/trips/registry';
import { isRemoteConfigured } from './firebase-config';
import { SHARED_TRIP_ID } from './shared-trip';
import { getActiveTraveler } from './token-auth';

const SHARED_PLAN_COPY =
  'The trip plan now syncs for everyone in one place. Use it on this device? It replaces the plan here, so back that up first if it has edits worth keeping.';

/** Server read as the signed-in user: false when offline, refused, anonymous or the doc is missing. */
async function sharedTripReadable(): Promise<boolean> {
  try {
    const { getAccountRemote } = await import('@/lib/firebase-remote');
    const { db, fs } = await getAccountRemote();
    return (await fs.getDocFromServer(fs.doc(db, 'trips', SHARED_TRIP_ID))).exists();
  } catch {
    return false;
  }
}

async function settle(): Promise<void> {
  const held = getStoredDefaultTripShareId();
  if (held === SHARED_TRIP_ID) return;
  if (getActiveTripId() !== DEFAULT_TRIP_ID || defaultShareReloadGuard.hasRun()) return;

  if (held === '' && !defaultPackHasSyncedData()) {
    // Nothing on the device to lose, and it already reads as the shared trip: just record it.
    setDefaultTripShareId(SHARED_TRIP_ID);
    return;
  }

  if (!(await sharedTripReadable())) return;
  // Another tab may have moved this device while this one waited on the network.
  if (getStoredDefaultTripShareId() !== held) return;

  if (defaultPackHasSyncedData()) {
    // A background tab can't answer a prompt; leave the guard unset so the next load asks.
    if (document.visibilityState !== 'visible') return;
    if (!window.confirm(replaceLocalPlanCopy(SHARED_PLAN_COPY))) {
      defaultShareReloadGuard.markRun();
      return;
    }
    if (getStoredDefaultTripShareId() !== held) return;
  }
  if (!defaultShareReloadGuard.markRun()) return;
  setDefaultTripShareId(SHARED_TRIP_ID);
  // Set before drop, so a write that didn't land can't cost the local plan.
  if (getStoredDefaultTripShareId() !== SHARED_TRIP_ID) return;
  markDefaultTripAdopted(SHARED_TRIP_ID);
  // setDefaultTripShareId only drops when moving off a non-empty id.
  dropDefaultPackSyncedData();
  window.location.reload();
}

/** Run once per page load. No-op when dormant, offline or not signed in. Never throws. */
export async function syncDefaultShare(): Promise<void> {
  if (!isRemoteConfigured()) return;
  if (getActiveTraveler() === null) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  try {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      await navigator.locks.request('default-share', settle);
    } else {
      await settle();
    }
  } catch (err) {
    console.warn('[account-share] skipped:', err);
  }
}

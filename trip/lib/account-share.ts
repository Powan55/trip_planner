// The default pack syncs to one shared trip (SHARED_TRIP_ID) for the accounts the rules allow, and
// is a local-only sample for everyone else. A member's device with no id is moved across here; one
// still holding some other id, or local edits, moves only once the shared trip has been read from
// the server as the signed-in user and the person has agreed to replace what is on the device.

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
import { outboxDirty } from '@/core/sync/outbox';
import { replaceLocalPlanCopy } from '@/core/trips/registry';
import { isRemoteConfigured } from './firebase-config';
import { SHARED_TRIP_ID, SHARED_TRIP_USERNAMES } from './shared-trip';
import { getActiveTraveler, normalizeUsername, usernameToEmail } from './token-auth';

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

/** The signed-in account's email, or null when anonymous, offline or unavailable. */
async function accountEmail(): Promise<string | null> {
  try {
    const { getAccountRemote } = await import('@/lib/firebase-remote');
    return (await getAccountRemote()).auth.currentUser?.email ?? null;
  } catch {
    return null;
  }
}

const MEMBER_EMAILS = new Set<string>(SHARED_TRIP_USERNAMES.map((u) => usernameToEmail(normalizeUsername(u))));

const SYNC_DOMAINS = ['itinerary', 'expenses', 'budget', 'docs', 'places'] as const;

async function settle(): Promise<void> {
  const held = getStoredDefaultTripShareId();
  if (held !== SHARED_TRIP_ID && (getActiveTripId() !== DEFAULT_TRIP_ID || defaultShareReloadGuard.hasRun())) {
    return;
  }

  // D-811 — the rules' allowlist, read off the signed-in email. No answer decides nothing.
  const email = await accountEmail();
  if (email === null) return;
  if (!MEMBER_EMAILS.has(email.toLowerCase())) {
    // A device that got the id before D-811. Its queued writes stay with it until they drain.
    const pending = SYNC_DOMAINS.some((d) => outboxDirty(d, DEFAULT_TRIP_ID).length > 0);
    if (held === SHARED_TRIP_ID && !pending && getStoredDefaultTripShareId() === held) {
      setDefaultTripShareId('');
    }
    return;
  }
  if (held === SHARED_TRIP_ID) return;

  if (held === '' && !defaultPackHasSyncedData()) {
    // Nothing on the device to lose. Reload once so this load's sync starts on the shared trip.
    if (!defaultShareReloadGuard.markRun()) return;
    setDefaultTripShareId(SHARED_TRIP_ID);
    if (getStoredDefaultTripShareId() === SHARED_TRIP_ID) window.location.reload();
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

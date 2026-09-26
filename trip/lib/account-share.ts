// The default pack's share id follows the account, so every device of one person lands on the
// same synced default trip (D-598). The account holds it in `profile/prefs.defaultShare`, reached
// only through `claimField`: its transaction is the server read, and it settles racing mints.

'use client';

import {
  DEFAULT_TRIP_ID,
  defaultPackHasSyncedData,
  defaultShareReloadGuard,
  dropDefaultPackSyncedData,
  getActiveTripId,
  getDefaultTripShareId,
  isSafeTripSegment,
  keyForTrip,
  markTripCreatedHere,
  readString,
  setDefaultTripShareId,
  type TripScopedSlot,
} from '@/core/storage/gateway';
import { isLeg } from '@/core/budget/model';
import { loadExpenses } from '@/core/budget/storage';
import { markOutboxDirty, type SyncDomain } from '@/core/sync/outbox';
import { replaceLocalPlanCopy } from '@/core/trips/registry';
import { loadPlans } from '@/core/vault/storage';
import { isRemoteConfigured } from './firebase-config';
import { getActiveTraveler } from './token-auth';

const FIELD = 'defaultShare';

const ACCOUNT_PLAN_COPY =
  "Your account already syncs a trip plan. Use it on this device? It replaces the plan here, so back that up first if it has edits worth keeping.";

function asId(v: unknown): string {
  const id = typeof v === 'string' ? v.trim() : '';
  return isSafeTripSegment(id) ? id : '';
}

const has = (slot: TripScopedSlot) => readString('local', keyForTrip(DEFAULT_TRIP_ID, slot)) !== null;

/** Queue every synced domain this pack holds, so it merges into the trip's first snapshot. */
function markLocalDataDirty(): void {
  const chunks: [SyncDomain, TripScopedSlot, () => string[]][] = [
    ['itinerary', 'itinerary', () => loadPlans().map((d) => d.date)],
    ['budget', 'budget', () => ['model']],
    ['docs', 'docsChecklist', () => ['checklist']],
    ['places', 'myPlaces', () => ['list']],
    ['expenses', 'expenses', () => [...new Set(loadExpenses().map((e) => e.leg).filter(isLeg))]],
  ];
  for (const [domain, slot, list] of chunks) if (has(slot)) markOutboxDirty(domain, list());
}

async function settle(): Promise<void> {
  const { claimField } = await import('@/lib/account-prefs-remote');
  const device = getDefaultTripShareId();
  if (device) {
    // Never touch a device's own id; only offer it to an account that has none.
    const held = asId(await claimField(FIELD, device));
    if (held && held !== device) {
      console.info('[account-share] this device shares a different default trip than the account');
    }
    return;
  }

  if (getActiveTripId() !== DEFAULT_TRIP_ID || defaultShareReloadGuard.hasRun()) return;

  const minted = crypto.randomUUID();
  // Null on offline, denied or dormant: nothing is decided on a guess.
  const id = asId(await claimField(FIELD, minted));
  if (!id) return;

  // Another tab may have adopted while this one waited on the network, and writing a different id
  // over it would wipe the default pack's synced slots.
  if (getDefaultTripShareId() !== '') return;
  if (id === minted) {
    if (!defaultShareReloadGuard.markRun()) return;
    // Marked only once the claim is won, and in the same synchronous run as the adopt, so a failed
    // or lost claim leaves nothing behind.
    markTripCreatedHere(minted);
    markLocalDataDirty();
    setDefaultTripShareId(id);
    window.location.reload();
    return;
  }

  // Adopting the account's trip replaces this device's plan (D-603); never merge it in unasked.
  if (defaultPackHasSyncedData()) {
    // A background tab can't answer a prompt; leave the guard unset so the next load asks.
    if (document.visibilityState !== 'visible') return;
    if (!window.confirm(replaceLocalPlanCopy(ACCOUNT_PLAN_COPY))) {
      defaultShareReloadGuard.markRun();
      return;
    }
    if (getDefaultTripShareId() !== '') return;
  }
  if (!defaultShareReloadGuard.markRun()) return;
  setDefaultTripShareId(id);
  // Set before drop, so a write that didn't land can't cost the local plan.
  if (getDefaultTripShareId() !== id) return;
  dropDefaultPackSyncedData();
  window.location.reload();
}

/** Run once per page load. No-op when dormant, offline or not signed in. Never throws. */
export async function syncDefaultShare(): Promise<void> {
  if (!isRemoteConfigured() || getActiveTraveler() === null) return;
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

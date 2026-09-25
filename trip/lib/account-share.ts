// The default pack's share id follows the account, so every device of one person lands on the
// same synced default trip (D-598). The account holds it in `profile/prefs.defaultShare`, reached
// only through `claimField`: its transaction is the server read, and it settles racing mints.

'use client';

import {
  DEFAULT_TRIP_ID,
  defaultShareReloadGuard,
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
import { loadPlans } from '@/core/vault/storage';
import { isRemoteConfigured } from './firebase-config';
import { getActiveTraveler } from './token-auth';

const FIELD = 'defaultShare';

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
  if (!defaultShareReloadGuard.markRun()) return;
  // Marked only once the claim is won, and in the same synchronous run as the adopt, so a failed
  // or lost claim leaves nothing behind.
  if (id === minted) markTripCreatedHere(minted);
  markLocalDataDirty();
  setDefaultTripShareId(id);
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

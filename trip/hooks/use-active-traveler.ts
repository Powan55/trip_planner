'use client';

import { useSyncExternalStore } from 'react';
import { getActiveTraveler, IDENTITY_CHANGED_EVENT, type Traveler } from '@/lib/token-auth';
import { sessionGate } from '@/core/storage/gateway';

/**
 * Reactive view of the signed-in identity.
 *
 * Returns `{ traveler, isGuest }` derived from `getActiveTraveler()` (the persisted Trip
 * Token) and the `tripPlannerGuest` flag. It re-reads on the same-tab
 * `identity:changed` CustomEvent (dispatched by `signIn` / `signOut` and the guest
 * affordance) AND the cross-tab `storage` event, so a sign-in / sign-out
 * reflects LIVE in the navbar chip and elsewhere without a manual reload.
 *
 * SSR-safe: `useSyncExternalStore`'s server snapshot returns the inert signed-out value
 * (`{ traveler: null, isGuest: false }`), matching first client paint before mount reads
 * localStorage. The subscribe is a true no-op during SSR (no `window`), and the listeners
 * it adds are torn down on unmount via the returned cleanup.
 *
 * READ-ONLY: this hook never writes — it only reflects identity owned by `lib/token-auth`.
 */

export interface ActiveTravelerState {
  traveler: Traveler | null;
  isGuest: boolean;
}

// Stable inert snapshot for SSR / the no-window path. Returning the SAME reference is
// required by useSyncExternalStore (a fresh object each call would loop).
const SERVER_SNAPSHOT: ActiveTravelerState = { traveler: null, isGuest: false };

// Guest-flag read: the `tripPlannerGuest` key + raw localStorage access live
// in the gateway. `sessionGate.isGuest()` is SSR-safe and never-throws, matching the prior
// inline `readGuest` exactly (returns false under no-window / disabled storage).

// Cache the last client snapshot so getSnapshot can return a STABLE reference when nothing
// changed — useSyncExternalStore bails out of a re-render only on referential equality, so
// returning a new object on every poll would cause an infinite render loop.
let cached: ActiveTravelerState = SERVER_SNAPSHOT;

function getClientSnapshot(): ActiveTravelerState {
  const traveler = getActiveTraveler();
  const isGuest = sessionGate.isGuest();
  // Reuse the cached object unless something actually changed (compare by token name +
  // guest flag — Traveler objects are stable module-level singletons from TRAVELERS).
  if (cached.traveler?.token === traveler?.token && cached.isGuest === isGuest) {
    return cached;
  }
  cached = { traveler, isGuest };
  return cached;
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(IDENTITY_CHANGED_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(IDENTITY_CHANGED_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function useActiveTraveler(): ActiveTravelerState {
  return useSyncExternalStore(subscribe, getClientSnapshot, () => SERVER_SNAPSHOT);
}

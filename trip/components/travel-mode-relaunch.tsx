'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { isTravelRoute } from '@/lib/travel-route';
import { sessionGate } from '@/core/storage/gateway';
import { travelModeGate, travelReturn } from '@/core/storage/travel-mode-store';

/**
 * — PWA relaunch re-enter. On app BOOT, if the `travelMode` gateway flag is `'active'`
 * and the user is NOT a guest, land on `/travel` via `router.replace` (no history entry for the
 * bounce, so browser Back can't loop). The flag is only ever armed by an actual (non-guest) entry
 * and cleared by the exit X, so this fires exactly for a traveler who was in Travel Mode when the app
 * last closed.
 *
 * Boot-ONCE (empty deps): the effect runs on the initial mount of the persistent provider tree —
 * i.e. once per full page load / relaunch, never on client-side navigations. Guards:
 * - already on `/travel` (deep link or a relaunch that landed there) → nothing to do;
 * - guest → blocked;
 * - flag not `'active'` → the normal case, no-op.
 * Clears any stale return route so the exit X after a relaunch re-enter falls back to `/`.
 * Renders null — a behavioral island, mounted beside FirstRunTour in the itinerary provider.
 */
export default function TravelModeRelaunch() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isTravelRoute(pathname)) return;
    if (sessionGate.isGuest()) return;
    if (!travelModeGate.isActive()) return;
    travelReturn.clear();
    router.replace('/travel/');
    // Boot-once: intentionally no deps — this must run on the initial load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

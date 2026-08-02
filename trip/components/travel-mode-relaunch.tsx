'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { isTravelRoute } from '@/lib/travel-route';
import { travelModeGate, travelReturn } from '@/core/storage/travel-mode-store';

/**
 * — PWA relaunch re-enter. On app BOOT, if the `travelMode` gateway flag is `'active'`,
 * land on `/travel` via `router.replace` — a same-document CLIENT navigation, not a full page load,
 * so it cannot re-trigger this boot-once effect itself. The flag is armed by an actual entry and
 * cleared only by the exit X (its one caller, `travel-exit-button.tsx`) — sign-out does NOT clear
 * it — so this fires for ANY visitor the app last closed with Travel Mode active, WITH NO IDENTITY
 * CHECK: a visitor who has since signed out is bounced to `/travel` the same as a signed-in
 * traveler.
 *
 * That is safe (not a redirect loop) ONLY because `/travel` no longer hard-redirects an
 * unidentified visitor away on its own —
 * TokenGate's app-wide wall (mounted unconditionally, no pathname term) covers them there instead,
 * with no further navigation. Before `travel-date-picker.tsx` DID `window.location.replace`
 * (a full reload) on no traveler, which re-armed THIS boot-once effect on the fresh load — and
 * since this effect had no identity check either, the two `replace` calls looped forever with no
 * history entry on either hop, so browser Back could not escape it either. Don't reintroduce a
 * redirect on either side of this pair without re-verifying the other side can't re-fire on top of
 * it.
 *
 * Boot-ONCE (empty deps): the effect runs on the initial mount of the persistent provider tree —
 * i.e. once per full page load / relaunch, never on client-side navigations. Guards:
 * - already on `/travel` (deep link or a relaunch that landed there) → nothing to do;
 * - flag not `'active'` → the normal case, no-op.
 * Clears any stale return route so the exit X after a relaunch re-enter falls back to `/`.
 * Renders null — a behavioral island, mounted beside FirstRunTour in the itinerary provider.
 */
export default function TravelModeRelaunch() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isTravelRoute(pathname)) return;
    if (!travelModeGate.isActive()) return;
    travelReturn.clear();
    router.replace('/travel/');
    // Boot-once: intentionally no deps — this must run on the initial load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

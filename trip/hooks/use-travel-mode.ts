'use client';

import { useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useActiveTraveler } from '@/hooks/use-active-traveler';
import { travelModeGate, travelReturn } from '@/core/storage/travel-mode-store';

/**
 * useEnterTravelMode — the ONE entry path shared by all four Travel Mode
 * entry surfaces (nav-chrome button, Home hero CTA, in-trip card, arrival toast).
 *
 * Returns `enter(navigate?)`. Before navigating it:
 * - remembers the exact `pathname + search` it is leaving from (`travelReturn`, session key 20) so
 * the exit X restores that route with no history trap, and
 * - arms the `travelMode` gateway flag to `'active'` (`travelModeGate.enter`, local key 19) so a
 * PWA relaunch re-enters `/travel`.
 * Then it PUSHES `/travel/` — push (not replace) so a browser Back from `/travel` returns cleanly to
 * the origin route. `navigate` is used when passed,
 * else a plain `router.push`; either way it is a push.
 *
 * GUESTS ARE BLOCKED: for a guest we neither arm the flag nor record a return route — we just
 * navigate, and TokenGate's guest-route wall handles `/travel`. So a guest can never
 * trigger a relaunch re-enter, and the "seen" marker is never set behind the wall.
 */
export function useEnterTravelMode(): (navigate?: (href: string) => void) => void {
  const router = useRouter();
  const pathname = usePathname();
  const { isGuest } = useActiveTraveler();

  return useCallback(
    (navigate?: (href: string) => void) => {
      if (!isGuest) {
        const search = typeof window !== 'undefined' ? window.location.search : '';
        travelReturn.set(`${pathname ?? '/'}${search}`);
        travelModeGate.enter();
      }
      (navigate ?? router.push)('/travel/');
    },
    [router, pathname, isGuest],
  );
}

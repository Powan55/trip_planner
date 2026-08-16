'use client';

import { useEffect, useId, useState } from 'react';
import { usePathname } from 'next/navigation';
import { m, AnimatePresence } from 'framer-motion';
import { Compass, X } from 'lucide-react';
import { getTodayInTrip } from '@/lib/trip-now';
import { isTravelRoute } from '@/lib/travel-route';
import { travelModeGate } from '@/core/storage/travel-mode-store';
import { useEnterTravelMode } from '@/hooks/use-travel-mode';

/**
 * — arrival auto-suggest toast. When the app is opened ON-TRIP (the clock is inside
 * Dec 9 – Jan 9 via `getTodayInTrip()`,) and Travel Mode has never been entered or
 * suggested, a dismissible toast nudges the traveler toward Travel Mode. HONEST heuristic — "on-trip
 * AND never seen" is the entire bar (no geolocation, no network).
 *
 * EXACTLY ONCE across reloads (gateway key 19, `travelModeGate`): dismiss writes `'seen'` → the
 * `hasSeen()` key-presence check suppresses it forever; entering Travel Mode writes `'active'`
 * (also seen), so entry counts as "seen" too. Never shown on `/travel` itself. Mounted app-wide in
 * the itinerary provider (beside FirstRunTour) so it can greet the traveler on whatever route they
 * land.
 *
 * Reduced motion: the single `m.*` reveal is auto-neutralized by the app-wide
 * `<MotionConfig reducedMotion="user">` (theme-provider), mirroring `sync-status-badge.tsx`.
 */
export default function TravelArrivalToast() {
  const pathname = usePathname();
  const enter = useEnterTravelMode();
  const [show, setShow] = useState(false);
  const titleId = useId();

  useEffect(() => {
    // Re-evaluate on mount and on route change; the persistence checks keep it exactly-once.
    if (isTravelRoute(pathname)) return;
    if (travelModeGate.hasSeen()) return;
    if (getTodayInTrip() === null) return; // off-trip → never suggest
    setShow(true);
  }, [pathname]);

  const dismiss = () => {
    travelModeGate.markSeen(); // never again
    setShow(false);
  };

  const onEnter = () => {
    setShow(false);
    enter(); // arms 'active' (implies seen) + records return route + pushes /travel
  };

  return (
    <AnimatePresence>
      {show && (
        <m.div
          key="travel-arrival-toast"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          role="region"
          aria-labelledby={titleId}
          data-testid="travel-arrival-toast"
          className="fixed inset-x-0 bottom-[calc(var(--tab-bar-h,64px)+env(safe-area-inset-bottom)+0.75rem)] z-40 flex justify-center px-4 md:bottom-6"
        >
          <div className="flex w-full max-w-md items-center gap-3 rounded-2xl glass-card p-3 shadow-2xl sm:p-4">
            <span
              aria-hidden="true"
              className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/40 text-muted-foreground sm:inline-flex"
            >
              <Compass className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p id={titleId} className="text-sm font-semibold text-white">
                You&rsquo;re on the trip
              </p>
              <p className="mt-0.5 text-xs text-ink-mid">
                Open Travel Mode for a focused, on-the-go companion.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={onEnter}
                data-testid="travel-arrival-enter"
                className="inline-flex min-h-[44px] items-center rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground outline-none transition-colors duration-200 hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
              >
                Open
              </button>
              <button
                type="button"
                onClick={dismiss}
                aria-label="Dismiss Travel Mode suggestion"
                data-testid="travel-arrival-dismiss"
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-ink-mid outline-none transition-colors duration-200 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  );
}

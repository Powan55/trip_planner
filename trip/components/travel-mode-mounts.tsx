'use client';

import TravelModeRelaunch from '@/components/travel-mode-relaunch';
import TravelArrivalToast from '@/components/travel-arrival-toast';

/**
 * — the two app-wide Travel Mode islands behind ONE lazy boundary: the PWA-relaunch
 * re-enter (behavioral, renders null) and the on-trip arrival auto-suggest toast. Combined so the
 * shared itinerary provider takes a SINGLE `dynamic(ssr:false)` import (one async chunk) instead of
 * two — keeping them off the app-wide First Load chunk without inflating it with a second split
 * point. Both self-suppress on `/travel` and for guests.
 */
export default function TravelModeMounts() {
  return (
    <>
      <TravelModeRelaunch />
      <TravelArrivalToast />
    </>
  );
}

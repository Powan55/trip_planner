'use client';

import TravelModeRelaunch from '@/components/travel-mode-relaunch';
import TravelArrivalToast from '@/components/travel-arrival-toast';
import VisitAutocount from '@/components/visit-autocount';

/**
 * — the app-wide on-trip islands behind ONE lazy boundary: the PWA-relaunch re-enter (behavioral,
 * renders null), the on-trip arrival auto-suggest toast, and (issue #30) visit auto-counting
 * (behavioral, renders null). Combined so the shared itinerary provider takes a SINGLE
 * `dynamic(ssr:false)` import (one async chunk) instead of one per island — keeping them off the
 * app-wide First Load chunk without inflating it with another split point, which is the whole
 * reason this file exists and the reason #30's island landed here rather than taking its own
 * `dynamic()` in the provider. The first two self-suppress on `/travel`; the third is route-blind
 * on purpose (a day arrives wherever you happen to be reading).
 */
export default function TravelModeMounts() {
  return (
    <>
      <TravelModeRelaunch />
      <TravelArrivalToast />
      <VisitAutocount />
    </>
  );
}

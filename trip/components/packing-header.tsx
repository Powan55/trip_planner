'use client';

import { useEffect, useState } from 'react';
import PageHeader from '@/components/page-header';
import { isDefaultTrip } from '@/core/trips';

/**
 * PackingHeader — `/packing`'s masthead with trip-aware copy (#240). `core/packing/storage.ts`
 * already drops the Nepal and Japan items on a custom trip, so the default-pack eyebrow and
 * description were promising a two-leg bag above ten universal items and no leg groups.
 *
 * Mount-gated exactly like `plan-hero.tsx`, static import and all: SSR / first paint renders the
 * default-pack copy (byte-identical to the inline `PageHeader` call this replaced), so the
 * client-only pointer read never causes a hydration mismatch, and the switch lands in the first
 * commit after hydration rather than a dynamic-import tick later. `default-trip-only.tsx` defers
 * its import because it is the gate for routes that would not otherwise pull `@/core/trips`; that
 * is not this route's situation. `@/core/trips` is already in the app-wide chunk — `app/layout.tsx`
 * mounts `ItineraryProvider`, which pulls `first-run-tour.tsx` → `lib/nav-items.ts`, which imports
 * `isDefaultTrip` statically. Deferring here bought no bytes and cost a painted frame of the very
 * copy this component exists to remove.
 */
export default function PackingHeader() {
  const [custom, setCustom] = useState(false);
  useEffect(() => setCustom(!isDefaultTrip()), []);

  return (
    <PageHeader
      eyebrow={custom ? 'One bag' : 'Two legs, one bag'}
      title="Packing Checklist"
      description={
        custom
          ? 'The universal essentials — check them off as you pack. Saved on this device only.'
          : 'Nepal-leg, Japan-leg, and universal items — check them off as you pack. Saved on this device only.'
      }
    />
  );
}

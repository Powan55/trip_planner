'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { getActiveTrip } from '@/core/trips';

/**
 * CustomTripMyPlaces — the "My places" mount for a CUSTOM trip's home surface. Custom trips
 * have no guide pages (`contentRef: 'empty'`), so their imported places live on Home; the DEFAULT
 * pack shows My Places on /nepal/ + /japan/ instead, so this renders NOTHING on the default pack.
 *
 * Lives in its OWN module (rendered by Home through `LazyVisible` as a component reference) so the
 * gate logic + the `MyPlacesSection` chunk stay OUT of Home's First Load JS — Home's budget sits at
 * the 107 kB line, so even this small gate must not land in the initial chunk. The gateway is
 * imported LAZILY (same null-until-resolved discipline as `DefaultTripOnly`).
 */
const MyPlacesSection = dynamic(() => import('@/components/my-places-section'), { ssr: false });

export default function CustomTripMyPlaces() {
  // null = unresolved → render nothing. Only a custom trip renders the section (legId 'main').
  const [isCustom, setIsCustom] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    import('@/core/storage/gateway').then((g) => {
      if (alive) setIsCustom(g.getActiveTripId() !== g.DEFAULT_TRIP_ID);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!isCustom) return null;
  // A-17: a custom trip is always single-leg (core/trips/custom.ts) — same precedent as
  // core/places/model.ts's `inferLegId` (legs.length === 1 → legs[0].id). The static
  // `getActiveTrip` import here adds no weight to Home's First Load JS: this whole component is
  // `dynamic(..., { ssr: false })`'d at app/page.tsx (`CustomTripMyPlaces`), so it's its own
  // chunk and never lands in Home's initial bundle regardless of what it imports statically
  // inside its own module.
  return <MyPlacesSection legId={getActiveTrip().legs[0]?.id ?? 'main'} />;
}

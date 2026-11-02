'use client';

// (Next 15 migration): see app/nepal/sections.tsx — same reason. The
// flights/hotels island, ssr:false, with its sized loading skeleton.
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import SectionSkeleton from '@/components/section-skeleton';

export const FlightsSection = dynamic(() => import('@/components/flights-section'), {
  ssr: false,
  loading: () => <SectionSkeleton height="clamp(30rem, 80vh, 46rem)" />,
});

// Home / Kathmandu / Tokyo wall clocks. Own ssr:false island so it stays off the initial chunk;
// the placeholder is sized for the two rows the three clocks wrap to at 375px.
export const WorldClockStrip = dynamic(() => import('@/components/world-clock-strip'), {
  ssr: false,
  loading: () => <div aria-hidden="true" className="mx-auto mt-2 min-h-[3.5rem] max-w-2xl" />,
});

// The literal default copy: SSR always resolves the default pack (core/storage/gateway.ts), so
// pre-mount / on the default trip this stays the exact visually-baselined string.
const DEFAULT_FLIGHTS_SUBTITLE =
  'Every leg of the journey — flights, layovers, and hotel stays across Nepal and Japan.';

/**
 * #596: the /flights hero subtitle text, same pattern as `app/map/sections.tsx`'s
 * `mapSubtitleFor` — legs' `countryLabel`, joined. Pure and exported for the unit test.
 */
export function flightsSubtitleFor(legs: { countryLabel: string }[], isDefault: boolean): string {
  if (isDefault) return DEFAULT_FLIGHTS_SUBTITLE;
  const places = legs.map((leg) => leg.countryLabel).join(' and ');
  return `Every leg of the journey — flights, layovers, and hotel stays across ${places}.`;
}

/**
 * Renders the default literal until mounted (matching what SSR produced, so there's no
 * hydration mismatch), then swaps in the active trip's own subtitle.
 */
export function FlightsHeroSubtitle() {
  const [subtitle, setSubtitle] = useState(DEFAULT_FLIGHTS_SUBTITLE);
  useEffect(() => {
    let alive = true;
    import('@/core/trips').then(({ getActiveTrip, isDefaultTrip }) => {
      if (!alive) return;
      const defaultTrip = isDefaultTrip();
      if (defaultTrip) return;
      setSubtitle(flightsSubtitleFor(getActiveTrip().legs, defaultTrip));
    });
    return () => {
      alive = false;
    };
  }, []);
  return <>{subtitle}</>;
}

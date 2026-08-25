'use client';

import { useEffect, useState } from 'react';
import PageHeader from '@/components/page-header';
import { isDefaultTrip } from '@/core/trips';

/**
 * RecapHeader — `/recap`'s masthead with trip-aware copy (#270). Same defect class as
 * `packing-header.tsx` (#240): the description named Nepal and Japan unconditionally, even on a
 * custom trip. Mirrors that fix exactly — mount-gated, static `@/core/trips` import (already in
 * the app-wide chunk via `ItineraryProvider`, so no bundle cost here either), SSR/first paint
 * renders the default-pack copy (byte-identical to the inline `PageHeader` call this replaced).
 */
export default function RecapHeader() {
  const [custom, setCustom] = useState(false);
  useEffect(() => setCustom(!isDefaultTrip()), []);

  return (
    <PageHeader
      eyebrow="The whole journey"
      title="Trip Story"
      description={
        custom
          ? 'A day-by-day narrative of your trip — what was planned, what actually happened, what you wrote, and what you spent. Unlocks once the trip wraps.'
          : 'A day-by-day narrative of Nepal and Japan — what was planned, what actually happened, what you wrote, and what you spent. Unlocks once the trip wraps.'
      }
    />
  );
}

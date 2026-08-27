'use client';

import { useEffect, useState } from 'react';
import PageHero from '@/components/page-hero';
import { isDefaultTrip } from '@/core/trips';

/**
 * PlanHero — wraps `PageHero variant="plan"` with a trip-aware subtitle (A-15/#102).
 * Mount-gated with the same two lines as `packing-header.tsx` and `recap-header.tsx`: SSR / first
 * paint renders the default-pack copy, so a client-only `isDefaultTrip()` read never causes a
 * hydration mismatch. All three route mastheads read identically on purpose.
 */
export default function PlanHero() {
  const [custom, setCustom] = useState(false);
  useEffect(() => setCustom(!isDefaultTrip()), []);

  return (
    <PageHero
      variant="plan"
      title="Trip Planner"
      eyebrow="Day by day"
      subtitle={
        custom
          ? 'Add, edit, and reorder every stop of the journey.'
          : 'All 32 days across Nepal and Japan — add, edit, and reorder every stop of the journey.'
      }
    />
  );
}

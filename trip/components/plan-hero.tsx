'use client';

import { useEffect, useState } from 'react';
import PageHero from '@/components/page-hero';
import { isDefaultTrip } from '@/core/trips';

/**
 * PlanHero — wraps `PageHero variant="plan"` with a trip-aware subtitle (A-15/#102).
 * Mount-gated exactly like `hero-section.tsx`'s `custom` flag: SSR/first paint always renders the
 * default-pack copy (byte-identical to the old inline call), so a client-only `isDefaultTrip()`
 * read never causes a hydration mismatch.
 */
export default function PlanHero() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const custom = mounted && !isDefaultTrip();

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

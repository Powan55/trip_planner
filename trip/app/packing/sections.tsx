'use client';

// pattern (Next 15): `ssr:false` dynamic imports are only allowed in a client module —
// see app/journal/sections.tsx / app/safety/sections.tsx for the precedent. The packing
// checklist island is localStorage-only, so it has no meaningful server render.
import dynamic from 'next/dynamic';
import SectionSkeleton from '@/components/section-skeleton';

export const PackingChecklist = dynamic(() => import('@/components/packing-checklist'), {
  ssr: false,
  loading: () => <SectionSkeleton height="40rem" count={3} />,
});

'use client';

// Next 15 pattern: `ssr:false` dynamic imports are only allowed in a client module — see
// app/settings/sections.tsx / app/checklist/sections.tsx for the precedent. The visited-places
// panel is a localStorage store with no remote half at all, so it has no meaningful server render.
import dynamic from 'next/dynamic';
import SectionSkeleton from '@/components/section-skeleton';

export const VisitedPlaces = dynamic(() => import('@/components/visited-places-panel'), {
  ssr: false,
  loading: () => <SectionSkeleton height="28rem" count={2} />,
});

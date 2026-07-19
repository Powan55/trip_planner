'use client';

// pattern (Next 15): `ssr:false` dynamic imports are only allowed in a client module —
// see app/journal/sections.tsx / app/safety/sections.tsx for the precedent. The story recap
// island is a pure read-only DERIVATION over three localStorage domains, so it has no
// meaningful server render.
import dynamic from 'next/dynamic';
import SectionSkeleton from '@/components/section-skeleton';

export const TripStoryRecap = dynamic(() => import('@/components/trip-story-recap'), {
  ssr: false,
  loading: () => <SectionSkeleton height="60vh" count={4} />,
});

// — the "Trip Wrapped" capstone, a SEPARATE lazy island composed below the story (never
// touches trip-story-recap.tsx's internals). Same ssr:false + skeleton idiom.
export const WrappedStory = dynamic(() => import('@/components/wrapped-story'), {
  ssr: false,
  loading: () => <SectionSkeleton height="50vh" count={3} />,
});

'use client';

// (Next 15 migration): see app/nepal/sections.tsx — same reason. Mirror of
// the Nepal islands with the Japan section component.
import dynamic from 'next/dynamic';
import SectionSkeleton from '@/components/section-skeleton';

export const JapanSection = dynamic(() => import('@/components/japan-section'), {
  ssr: false,
  loading: () => <SectionSkeleton />,
});
export const PhotographyGuide = dynamic(() => import('@/components/photography-guide'), {
  ssr: false,
  loading: () => <SectionSkeleton />,
});
export const NightlifeSection = dynamic(() => import('@/components/nightlife-section'), {
  ssr: false,
  loading: () => <SectionSkeleton />,
});
export const CountryEssentials = dynamic(() => import('@/components/country-essentials'), {
  ssr: false,
  loading: () => <SectionSkeleton />,
});
// — the user's imported "My places" for the Japan leg. No `loading:` skeleton: the section
// renders null when this leg has no places (or pre-hydration), so a reserved box would be wrong.
export const MyPlacesSection = dynamic(() => import('@/components/my-places-section'), {
  ssr: false,
});

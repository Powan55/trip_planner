'use client';

// See app/nepal/sections.tsx for why this lives in a client module. Mirror of
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

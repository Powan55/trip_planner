'use client';

// (Next 15 migration): `dynamic({ssr:false})` islands live in this client
// module because the sibling `page.tsx` is a Server Component (exports
// `metadata`) and Next 15 forbids `ssr:false` dynamic imports there. Same
// islands, same anti-CLS SectionSkeletons — only the declaration
// site moved off the server page.
import dynamic from 'next/dynamic';
import SectionSkeleton from '@/components/section-skeleton';

export const NepalSection = dynamic(() => import('@/components/nepal-section'), {
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
// — the user's imported "My places" for the Nepal leg. No `loading:` skeleton: the section
// renders null when this leg has no places (or pre-hydration), so a reserved box would be wrong.
export const MyPlacesSection = dynamic(() => import('@/components/my-places-section'), {
  ssr: false,
});

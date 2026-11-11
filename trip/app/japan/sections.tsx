'use client';

// (Next 15 migration): see app/nepal/sections.tsx — same reason. Mirror of
// the Nepal islands with the Japan section component.
import dynamic from 'next/dynamic';
import LazyVisible from '@/components/lazy-visible';
import SectionSkeleton from '@/components/section-skeleton';

// Lead section is ~15k px tall at desktop (44k at 390px). Its skeleton must be tall enough to
// keep the lazy sections below it outside their observer margin until it lands; a short one
// lets them all mount on first paint. Desktop height, so mobile under-reserves (scroll
// anchoring covers a #hash landing).
export const JapanSection = dynamic(() => import('@/components/japan-section'), {
  ssr: false,
  loading: () => <SectionSkeleton height="15000px" />,
});
// Below-the-fold sections mount on scroll only (no idle mount), so they stay out of the
// initial DOM. The placeholder carries the anchor id for /guides links and #hash nav.
const Photography = dynamic(() => import('@/components/photography-guide'), {
  ssr: false,
  loading: () => <SectionSkeleton />,
});
const Nightlife = dynamic(() => import('@/components/nightlife-section'), {
  ssr: false,
  loading: () => <SectionSkeleton />,
});
const Essentials = dynamic(() => import('@/components/country-essentials'), {
  ssr: false,
  loading: () => <SectionSkeleton />,
});
type CountryProps = { country: string };
export const PhotographyGuide = ({ country }: CountryProps) => (
  <LazyVisible id="photography" component={Photography} props={{ country }} minHeight="5800px" idle={false} />
);
export const NightlifeSection = ({ country }: CountryProps) => (
  <LazyVisible id="nightlife" component={Nightlife} props={{ country }} minHeight="6500px" idle={false} />
);
export const CountryEssentials = ({ country }: CountryProps) => (
  <LazyVisible id="essentials" component={Essentials} props={{ country }} minHeight="1700px" idle={false} />
);
// — the user's imported "My places" for the Japan leg. No `loading:` skeleton: the section
// renders null when this leg has no places (or pre-hydration), so a reserved box would be wrong.
export const MyPlacesSection = dynamic(() => import('@/components/my-places-section'), {
  ssr: false,
});

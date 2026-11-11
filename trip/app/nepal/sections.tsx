'use client';

// (Next 15 migration): `dynamic({ssr:false})` islands live in this client
// module because the sibling `page.tsx` is a Server Component (exports
// `metadata`) and Next 15 forbids `ssr:false` dynamic imports there. Same
// islands, same anti-CLS SectionSkeletons — only the declaration
// site moved off the server page.
import dynamic from 'next/dynamic';
import LazyVisible from '@/components/lazy-visible';
import SectionSkeleton from '@/components/section-skeleton';

// Lead section is ~10.7k px tall at desktop (30k at 390px). Its skeleton must be tall enough to
// keep the lazy sections below it outside their observer margin until it lands; a short one
// lets them all mount on first paint. Desktop height, so mobile under-reserves (scroll
// anchoring covers a #hash landing).
export const NepalSection = dynamic(() => import('@/components/nepal-section'), {
  ssr: false,
  loading: () => <SectionSkeleton height="10000px" />,
});
// Below-the-fold sections mount on scroll only (no idle mount), so they stay out of the
// initial DOM. The placeholder carries the anchor id for /guides links and #hash nav.
const Photography = dynamic(() => import('@/components/photography-guide'), {
  ssr: false,
  loading: () => <SectionSkeleton height="2800px" />,
});
const Nightlife = dynamic(() => import('@/components/nightlife-section'), {
  ssr: false,
  loading: () => <SectionSkeleton height="2000px" />,
});
const Essentials = dynamic(() => import('@/components/country-essentials'), {
  ssr: false,
  loading: () => <SectionSkeleton height="1500px" />,
});
type CountryProps = { country: string };
export const PhotographyGuide = ({ country }: CountryProps) => (
  <LazyVisible id="photography" component={Photography} props={{ country }} minHeight="2800px" idle={false} />
);
export const NightlifeSection = ({ country }: CountryProps) => (
  <LazyVisible id="nightlife" component={Nightlife} props={{ country }} minHeight="2000px" idle={false} />
);
export const CountryEssentials = ({ country }: CountryProps) => (
  <LazyVisible id="essentials" component={Essentials} props={{ country }} minHeight="1500px" idle={false} />
);
// — the user's imported "My places" for the Nepal leg. No `loading:` skeleton: the section
// renders null when this leg has no places (or pre-hydration), so a reserved box would be wrong.
export const MyPlacesSection = dynamic(() => import('@/components/my-places-section'), {
  ssr: false,
});

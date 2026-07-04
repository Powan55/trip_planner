import dynamic from 'next/dynamic';
import PageHero from '@/components/page-hero';
import SectionSkeleton from '@/components/section-skeleton';

// NEPAL: recommendations · photography (Nepal) · nightlife (Nepal) ·
// foods/etiquette/featured (Nepal). Section ids (#nepal/#photography/
// #nightlife/#essentials) are kept for sub-anchors + the command palette.
// SectionSkeletons reserve space while islands load (anti-CLS).
const NepalSection = dynamic(() => import('@/components/nepal-section'), {
  ssr: false,
  loading: () => <SectionSkeleton />,
});
const PhotographyGuide = dynamic(() => import('@/components/photography-guide'), {
  ssr: false,
  loading: () => <SectionSkeleton />,
});
const NightlifeSection = dynamic(() => import('@/components/nightlife-section'), {
  ssr: false,
  loading: () => <SectionSkeleton />,
});
const CountryEssentials = dynamic(() => import('@/components/country-essentials'), {
  ssr: false,
  loading: () => <SectionSkeleton />,
});

export const metadata = {
  title: 'Nepal · Nepal × Japan Journey',
  description: 'Kathmandu Valley guide — temples, markets, photography spots, nightlife, local foods, and cultural etiquette for the Nepal leg (Dec 9–18).',
};

export default function NepalPage() {
  return (
    <main className="min-h-screen bg-navy-900">
      {/* PageHero supplies the page's <h1> (the section components keep their own
          <h2>s, so every route has exactly one top-level heading — a11y win). */}
      <PageHero
        variant="nepal"
        title="Nepal"
        eyebrow="Dec 9 – 18"
        subtitle="Kathmandu Valley — temples, markets, photography spots, nightlife, and local flavors."
      />
      <NepalSection />
      <PhotographyGuide country="Nepal" />
      <NightlifeSection country="Nepal" />
      <CountryEssentials country="Nepal" />
    </main>
  );
}

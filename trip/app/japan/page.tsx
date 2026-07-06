import dynamic from 'next/dynamic';
import PageHero from '@/components/page-hero';
import SectionSkeleton from '@/components/section-skeleton';

// JAPAN: mirror of /nepal/ with country="Japan". Section ids
// (#japan/#photography/#nightlife/#essentials) are kept for sub-anchors + the
// command palette.
// SectionSkeletons reserve space while islands load (anti-CLS).
const JapanSection = dynamic(() => import('@/components/japan-section'), {
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
  title: 'Japan · Nepal × Japan Journey',
  description: 'Winter Japan guide — Tokyo neon, Kyoto temples, photography spots, nightlife, local foods, and etiquette for the Japan leg (Dec 19–Jan 9).',
};

export default function JapanPage() {
  return (
    <main className="min-h-screen bg-navy-900">
      {/* PageHero supplies the page's <h1> (pages previously shipped
          without one — a11y win). Section components keep their own <h2>s. */}
      <PageHero
        variant="japan"
        title="Japan"
        eyebrow="Dec 19 – Jan 9"
        subtitle="Winter Japan — Tokyo neon, Kyoto temples, photo spots, nightlife, and local etiquette."
      />
      <JapanSection />
      <PhotographyGuide country="Japan" />
      <NightlifeSection country="Japan" />
      <CountryEssentials country="Japan" />
    </main>
  );
}

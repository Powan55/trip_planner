import PageHero from '@/components/page-hero';

// JAPAN: mirror of /nepal/ with country="Japan". Section ids
// (#japan/#photography/#nightlife/#essentials) are kept for sub-anchors + the
// command palette.
// (Next 15): ssr:false islands live in./sections (client module); this
// Server Component page exports metadata so can't declare them./ skeletons.
import {
  JapanSection,
  PhotographyGuide,
  NightlifeSection,
  CountryEssentials,
} from './sections';

export const metadata = {
  title: 'Japan · Nepal × Japan Journey',
  description: 'Winter Japan guide — Tokyo neon, Kyoto temples, photography spots, nightlife, local foods, and etiquette for the Japan leg (Dec 19–Jan 9).',
};

export default function JapanPage() {
  return (
    <main className="min-h-screen bg-surface">
      {/* PageHero supplies the page's <h1> ( pages shipped
}          without one — a11y win). Section components keep their own <h2>s. */
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

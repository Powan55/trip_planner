import PageHero from '@/components/page-hero';

// NEPAL: recommendations · photography (Nepal) · nightlife (Nepal)
// · foods/etiquette/featured (Nepal). Section ids (#nepal/#photography/
// #nightlife/#essentials) are kept for sub-anchors + the command palette.
// The `dynamic({ssr:false})` islands live in ./sections (a
// client module) — Next 15 forbids ssr:false dynamic imports in this Server
// Component page (it exports metadata). Same anti-CLS skeletons throughout.
import {
  NepalSection,
  PhotographyGuide,
  NightlifeSection,
  CountryEssentials,
} from './sections';

export const metadata = {
  title: 'Nepal · Nepal × Japan Journey',
  description: 'Kathmandu Valley guide — temples, markets, photography spots, nightlife, local foods, and cultural etiquette for the Nepal leg (Dec 9–18).',
};

export default function NepalPage() {
  return (
    <main className="min-h-screen bg-navy-900">
      {/* PageHero supplies the page's <h1> (earlier pages shipped
          without one — an accessibility fix). Section components keep their own <h2>s. */}
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

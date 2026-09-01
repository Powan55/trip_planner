import PageHero from '@/components/page-hero';
import DefaultTripOnly from '@/components/default-trip-only';

// NEPAL: recommendations · photography (Nepal) · nightlife (Nepal)
// · foods/etiquette/featured (Nepal). Section ids (#nepal/#photography/
// #nightlife/#essentials) are kept for sub-anchors + the command palette.
// (Next 15): the `dynamic({ssr:false})` islands live in./sections (a
// client module) — Next 15 forbids ssr:false dynamic imports in this Server
// Component page (it exports metadata). Same/ anti-CLS skeletons.
import {
  NepalSection,
  PhotographyGuide,
  NightlifeSection,
  CountryEssentials,
  MyPlacesSection,
} from './sections';

export const metadata = {
  title: 'Nepal · Nepal × Japan Journey',
  description: 'Kathmandu Valley guide — temples, markets, photography spots, nightlife, local foods, and cultural etiquette for the Nepal leg (Dec 9–18).',
};

export default function NepalPage() {
  return (
    // The leg channel: one attribute makes every descendant country-aware via --now,
    // which is what replaced the per-route repaint.
    <main data-leg="nepal" className="min-h-screen bg-surface">
      {/* PageHero supplies the page's <h1> ( pages shipped
          without one — a11y win). Section components keep their own <h2>s. */}
      <PageHero
        variant="nepal"
        title="Nepal"
        eyebrow="Dec 9 – 18"
        subtitle="Kathmandu Valley — temples, markets, photography spots, nightlife, and local flavors."
      />
      <DefaultTripOnly>
        <NepalSection />
        <MyPlacesSection legId="nepal" />
        <PhotographyGuide country="Nepal" />
        <NightlifeSection country="Nepal" />
        <CountryEssentials country="Nepal" />
      </DefaultTripOnly>
    </main>
  );
}

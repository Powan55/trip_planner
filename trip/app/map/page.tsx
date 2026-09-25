import PageHero from '@/components/page-hero';

// MAP: the real MapLibre GL map, full-height treatment — the
// flex column stretches the section to fill at least the viewport so the map
// reads as the page's centerpiece (PageHero is a <header>, so the
// [&>section]:flex-1 selector leaves it at natural height).
// (Next 15): the ssr:false MapSection island lives in./sections (client
// module); this Server Component page exports metadata./ skeleton kept.
import { MapSection } from './sections';

// Server Component: getActiveTrip() resolves off a localStorage pointer, always DEFAULT_TRIP_ID
// at build/SSR time (core/storage/gateway.ts), so a per-trip title here would just be wrong on
// custom trips rather than dynamic. Kept trip-neutral instead.
export const metadata = {
  title: 'Map · Trip Journey',
  description: 'Interactive trip map — attractions, food, photo spots, and hotels across your destinations, filterable by category.',
};

export default function MapPage() {
  return (
    <main className="min-h-screen bg-surface flex flex-col [&>section]:flex-1">
      {/* PageHero supplies the page's <h1> ( pages shipped
          without one — a11y win). Section components keep their own <h2>s. */}
      <PageHero
        variant="map"
        title="Trip Map"
        eyebrow="Explore"
        // Visually baselined (e2e/visual.spec.ts "map page hero", 3 viewports, Windows-rendered,
        // CI-refreshed only) — kept literal rather than trip-neutral so the rendered header stays
        // pixel-identical. The (non-rendered) metadata above is neutral; this text is not.
        subtitle="Attractions, food, photo spots, and hotels across Kathmandu and Japan — filter by category or overlay your own itinerary."
      />
      <MapSection />
    </main>
  );
}

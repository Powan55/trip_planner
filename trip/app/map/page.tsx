import PageHero from '@/components/page-hero';

// MAP: the real MapLibre GL map, full-height treatment — the
// flex column stretches the section to fill at least the viewport so the map
// reads as the page's centerpiece (PageHero is a <header>, so the
// [&>section]:flex-1 selector leaves it at natural height).
// The ssr:false MapSection island lives in ./sections (client
// module); this Server Component page exports metadata.
import { MapSection } from './sections';

export const metadata = {
  title: 'Map · Nepal × Japan Journey',
  description: 'Interactive trip map — attractions, food, photo spots, and hotels across Kathmandu and Japan, filterable by category.',
};

export default function MapPage() {
  return (
    <main className="min-h-screen bg-navy-900 flex flex-col [&>section]:flex-1">
      {/* PageHero supplies the page's <h1> (earlier pages shipped
          without one — an accessibility fix). Section components keep their own <h2>s. */}
      <PageHero
        variant="map"
        title="Trip Map"
        eyebrow="Explore"
        subtitle="Attractions, food, photo spots, and hotels across Kathmandu and Japan — filter by category or overlay your own itinerary."
      />
      <MapSection />
    </main>
  );
}

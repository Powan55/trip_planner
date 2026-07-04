import dynamic from 'next/dynamic';
import PageHero from '@/components/page-hero';
import SectionSkeleton from '@/components/section-skeleton';

// MAP: the real MapLibre GL map, full-height treatment — the flex column
// stretches the section to fill at least the viewport so the map reads as the
// page's centerpiece (PageHero is a <header>, so the [&>section]:flex-1 selector
// leaves it at natural height).
// SectionSkeleton reserves space while the island loads (anti-CLS).
const MapSection = dynamic(() => import('@/components/map-section'), {
  ssr: false,
  loading: () => <SectionSkeleton height="60vh" count={2} />,
});

export const metadata = {
  title: 'Map · Nepal × Japan Journey',
  description: 'Interactive trip map — attractions, food, photo spots, and hotels across Kathmandu and Japan, filterable by category.',
};

export default function MapPage() {
  return (
    <main className="min-h-screen bg-navy-900 flex flex-col [&>section]:flex-1">
      {/* PageHero supplies the page's <h1> (the section components keep their own
          <h2>s, so every route has exactly one top-level heading — a11y win). */}
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

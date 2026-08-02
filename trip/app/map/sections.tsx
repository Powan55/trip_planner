'use client';

// (Next 15 migration): see app/nepal/sections.tsx — same reason. The
// MapLibre GL island, ssr:false, with its sized loading skeleton.
import dynamic from 'next/dynamic';
import SectionSkeleton from '@/components/section-skeleton';
import MapIslandBoundary from '@/components/map-island-boundary';

const MapSectionIsland = dynamic(() => import('@/components/map-section'), {
  ssr: false,
  loading: () => <SectionSkeleton height="60vh" count={2} />,
});

// / — one of the 3 call sites `gen-sw.mjs` reports as maplibre-reduced
// ("gen-sw: maplibre withheld from N call site(s)"). Its chunk is deliberately
// absent from the precache, so cold-offline React.lazy throws here; unwrapped, that
// throw reaches app/error.tsx and takes the ENTIRE /map/ route down, hero included.
// The boundary degrades just this pane instead. Guarded by
// e2e/pwa.spec.ts "the excluded maplibre island degrades to a named pane".
export function MapSection() {
  return (
    <MapIslandBoundary label="The interactive trip map">
      <MapSectionIsland />
    </MapIslandBoundary>
  );
}

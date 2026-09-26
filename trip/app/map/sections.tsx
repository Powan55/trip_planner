'use client';

// (Next 15 migration): see app/nepal/sections.tsx — same reason. The
// MapLibre GL island, ssr:false, with its sized loading skeleton.
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import SectionSkeleton from '@/components/section-skeleton';
import MapIslandBoundary from '@/components/map-island-boundary';

// The literal default copy (#617's a375c95): SSR always resolves the default pack
// (core/storage/gateway.ts), so pre-mount / on the default trip this stays the exact
// visually-baselined string.
const DEFAULT_MAP_SUBTITLE =
  'Attractions, food, photo spots, and hotels across Kathmandu and Japan — filter by category or overlay your own itinerary.';

/**
 * #596: the /map hero subtitle text, derived from the active trip the same way #617 derives
 * the footer wordmark — legs' `countryLabel`, joined. Pure and exported so the unit test can
 * check it without mounting the effect below. Default pack short-circuits to the literal
 * (the visual baseline pins that exact string); a custom trip gets its own place names.
 */
export function mapSubtitleFor(legs: { countryLabel: string }[], isDefault: boolean): string {
  if (isDefault) return DEFAULT_MAP_SUBTITLE;
  const places = legs.map((leg) => leg.countryLabel).join(' and ');
  return `Attractions, food, photo spots, and hotels across ${places} — filter by category or overlay your own itinerary.`;
}

/**
 * Renders the default literal until mounted (matching what SSR produced, so there's no
 * hydration mismatch), then swaps in the active trip's own subtitle via `mapSubtitleFor`.
 */
export function MapHeroSubtitle() {
  const [subtitle, setSubtitle] = useState(DEFAULT_MAP_SUBTITLE);
  useEffect(() => {
    let alive = true;
    import('@/core/trips').then(({ getActiveTrip, isDefaultTrip }) => {
      if (!alive) return;
      const defaultTrip = isDefaultTrip();
      if (defaultTrip) return;
      setSubtitle(mapSubtitleFor(getActiveTrip().legs, defaultTrip));
    });
    return () => {
      alive = false;
    };
  }, []);
  return <>{subtitle}</>;
}

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
